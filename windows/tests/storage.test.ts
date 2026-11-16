import { describe, expect, it } from "vitest";
import { MemoryFS, listAll, readText } from "../src/platform/fs";
import { makeStroke } from "../src/model/ink";
import { newManifest } from "../src/model/notebook";
import { addAsset, duplicatePackage, loadInk, loadManifest, packageDir, saveInk, saveManifest, sweepAssets, UnreadableNotebook, loadCards } from "../src/storage/package";
import { NotebookDocument } from "../src/editor/document";
import { folderAndDescendants, folderPath, loadFolders, loadSettings, mendFolders, recordWriting, saveSettings, shelfMatches, defaultSettings, loadActivity } from "../src/storage/libraryFiles";

const stroke = (x = 0) => makeStroke("pen", 0x1b2230ff, 2, [{ x, y: 0 }, { x: x + 10, y: 10 }]);

async function open(fs = new MemoryFS()) {
  const manifest = newManifest({ title: "Test" });
  await saveManifest(fs, manifest);
  const doc = new NotebookDocument(fs, manifest);
  doc.saveDelay = 1_000_000;
  return { fs, doc, first: manifest.pages[0].id };
}

describe("memory files", () => {
  it("lists folders, renames trees and removes them", async () => {
    const fs = new MemoryFS();
    await fs.write("a/b/c.txt", "1");
    await fs.write("a/d.txt", "2");
    expect((await fs.list("a")).map((e) => [e.name, e.isDir])).toEqual([["b", true], ["d.txt", false]]);
    await fs.rename("a", "z");
    expect(await listAll(fs, "z")).toEqual(["b/c.txt", "d.txt"]);
    expect(await fs.read("a/d.txt")).toBeNull();
    await fs.remove("z/b");
    expect(await listAll(fs, "")).toEqual(["z/d.txt"]);
    await expect(fs.read("../x")).rejects.toThrow();
    await expect(fs.remove("")).rejects.toThrow();
    await expect(fs.rename("nope", "x")).rejects.toThrow();
  });
});

describe("packages", () => {
  it("sets an unreadable manifest aside and keeps its bytes", async () => {
    const fs = new MemoryFS();
    await fs.write("X.owlluna/manifest.json", "{ broken");
    await expect(loadManifest(fs, "X")).rejects.toBeInstanceOf(UnreadableNotebook);
    const names = (await fs.list("X.owlluna")).map((e) => e.name);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^manifest\.json\.corrupt-/);
    expect(await readText(fs, "X.owlluna/" + names[0])).toBe("{ broken");
  });
  it("leaves a newer build's manifest where it is", async () => {
    const fs = new MemoryFS();
    await fs.write("X.owlluna/manifest.json", JSON.stringify({ id: "X", pages: [], version: 9 }));
    await expect(loadManifest(fs, "X")).rejects.toThrow(/newer/);
    expect((await fs.list("X.owlluna"))[0].name).toBe("manifest.json");
  });
  it("names a notebook by its folder", async () => {
    const fs = new MemoryFS();
    const manifest = newManifest({ title: "A" });
    await fs.write("COPY.owlluna/manifest.json", JSON.stringify(manifest));
    expect((await loadManifest(fs, "COPY")).id).toBe("COPY");
  });
  it("sets unreadable ink aside and gives an empty page", async () => {
    const fs = new MemoryFS();
    await fs.write("X.owlluna/ink/P.json", "garbage");
    expect(await loadInk(fs, "X", "P")).toEqual([]);
    expect((await fs.list("X.owlluna/ink"))[0].name).toMatch(/corrupt/);
    expect(await loadCards(fs, "X")).toEqual([]);
  });
  it("removes the ink file of an emptied page", async () => {
    const fs = new MemoryFS();
    await saveInk(fs, "X", "P", [stroke()]);
    expect(await loadInk(fs, "X", "P")).toHaveLength(1);
    await saveInk(fs, "X", "P", []);
    expect(await fs.list("X.owlluna/ink")).toEqual([]);
  });
  it("duplicates everything under a new ID", async () => {
    const { fs, doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    await doc.save();
    await addAsset(fs, doc.id, new Uint8Array([1, 2, 3]), "PNG");
    const copy = await duplicatePackage(fs, doc.id, "Test copy");
    expect(copy.id).not.toBe(doc.id);
    expect(copy.title).toBe("Test copy");
    expect(await loadInk(fs, copy.id, first)).toHaveLength(1);
    expect((await fs.list(`${packageDir(copy.id)}/assets`))[0].name).toMatch(/\.png$/);
    expect((await loadManifest(fs, doc.id)).title).toBe("Test");
  });
  it("sweeps only assets nothing uses", async () => {
    const { fs, doc } = await open();
    const kept = await addAsset(fs, doc.id, new Uint8Array([1]), "png");
    await addAsset(fs, doc.id, new Uint8Array([2]), "png");
    expect(await sweepAssets(fs, doc.manifest, new Set([kept]))).toBe(1);
    expect((await fs.list(`${packageDir(doc.id)}/assets`)).map((e) => e.name)).toEqual([kept]);
  });
});

describe("document", () => {
  it("undoes and redoes ink and page changes in one history", async () => {
    const { doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    const second = doc.addPage(first);
    doc.addStrokes(second.id, [stroke(), stroke(5)]);
    expect(doc.manifest.pages).toHaveLength(2);
    expect(doc.undoLabel).toBe("Write");
    doc.undo();
    expect(doc.ink(second.id)).toHaveLength(0);
    doc.undo();
    expect(doc.manifest.pages).toHaveLength(1);
    doc.undo();
    expect(doc.ink(first)).toHaveLength(0);
    expect(doc.canUndo).toBe(false);
    doc.redo(); doc.redo(); doc.redo();
    expect(doc.ink(second.id)).toHaveLength(2);
    expect(doc.canRedo).toBe(false);
  });
  it("a new change clears redo, and a change of nothing leaves no step", async () => {
    const { doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    doc.undo();
    doc.addStrokes(first, [stroke(3)]);
    expect(doc.canRedo).toBe(false);
    const before = doc.version;
    expect(doc.transact("Nothing", (draft) => void draft.manifest.title)).toBe(false);
    doc.removeStrokes(first, new Set());
    expect(doc.version).toBe(before);
  });
  it("writes ink before the manifest, and only pages that changed", async () => {
    const { fs, doc, first } = await open();
    const order: string[] = [];
    const write = fs.write.bind(fs);
    fs.write = async (path, data) => { order.push(path); return write(path, data); };
    const second = doc.addPage(first);
    doc.addStrokes(second.id, [stroke()]);
    await doc.save();
    expect(order).toEqual([`${doc.id}.owlluna/ink/${second.id}.json`, `${doc.id}.owlluna/manifest.json`]);
    expect(doc.saveState).toBe("saved");
    order.length = 0;
    await doc.save();
    expect(order).toEqual([]);
    const reread = await loadManifest(fs, doc.id);
    expect(reread.pages.map((p) => p.id)).toEqual([first, second.id]);
    expect(reread.pages[1].inkHash).toMatch(/^[0-9a-f]{12}$/);
    expect(reread.pages[0].inkHash).toBeUndefined();
  });
  it("keeps everything dirty when a save fails, then saves it", async () => {
    const { fs, doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    fs.failWrites = true;
    await expect(doc.save()).rejects.toThrow("disk full");
    expect(doc.saveState).toBe("failed");
    expect(doc.hasUnsavedChanges).toBe(true);
    fs.failWrites = false;
    await doc.save();
    expect(doc.saveState).toBe("saved");
    expect(await loadInk(fs, doc.id, first)).toHaveLength(1);
  });
  it("deleting pages keeps one, removes ink files, and undo brings both back", async () => {
    const { fs, doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    await doc.save();
    await doc.deletePages([first]);
    expect(doc.manifest.pages).toHaveLength(1);
    expect(doc.manifest.pages[0].id).not.toBe(first);
    await doc.save();
    expect(await fs.list(`${doc.id}.owlluna/ink`)).toEqual([]);
    doc.undo();
    expect(doc.manifest.pages[0].id).toBe(first);
    await doc.save();
    expect(await loadInk(fs, doc.id, first)).toHaveLength(1);
  });
  it("reads ink from disk once and lets ink written meanwhile win", async () => {
    const { fs, doc, first } = await open();
    await saveInk(fs, doc.id, first, [stroke(), stroke(4)]);
    const pending = doc.ensureInk(first);
    doc.addStrokes(first, [stroke(9)]);
    expect(await pending).toHaveLength(1);
    const again = new NotebookDocument(fs, doc.manifest);
    expect(await again.ensureInk(first)).toHaveLength(2);
    expect(again.inkLoaded(first)).toBe(true);
  });
  it("duplicates and moves pages", async () => {
    const { doc, first } = await open();
    doc.addStrokes(first, [stroke()]);
    const copy = (await doc.duplicatePage(first))!;
    expect(doc.pageIndex(copy.id)).toBe(1);
    expect(doc.ink(copy.id)).toHaveLength(1);
    doc.movePage(copy.id, 0);
    expect(doc.manifest.pages[0].id).toBe(copy.id);
    doc.undo();
    expect(doc.manifest.pages[0].id).toBe(first);
  });
  it("adds, changes and removes items undoably, and tells listeners", async () => {
    const { doc, first } = await open();
    let calls = 0;
    const stop = doc.subscribe(() => calls++);
    doc.addItem(first, { id: "t", kind: "tape", color: "sage", x: 10, y: 10, w: 80, h: 20, rotation: 0 });
    doc.updateItem(first, "t", "Move", (item) => { item.x = 50; });
    expect(doc.page(first)!.items[0].x).toBe(50);
    doc.undo();
    expect(doc.page(first)!.items[0].x).toBe(10);
    doc.removeItems(first, new Set(["t"]));
    expect(doc.page(first)!.items).toHaveLength(0);
    expect(calls).toBe(4);
    stop();
    doc.undo();
    expect(calls).toBe(4);
  });
  it("reports writing and saves on close", async () => {
    const { fs, doc, first } = await open();
    const wrote: number[] = [];
    doc.onWrote = (_page, count) => wrote.push(count);
    let saved = 0;
    doc.onSaved = () => saved++;
    doc.addStrokes(first, [stroke(), stroke(2)]);
    await doc.close();
    expect(wrote).toEqual([2]);
    expect(saved).toBe(1);
    expect(await loadInk(fs, doc.id, first)).toHaveLength(2);
  });
});

describe("library files", () => {
  it("fills in settings a file lacks and survives a broken one", async () => {
    const fs = new MemoryFS();
    expect((await loadSettings(fs)).trashDays).toBe(30);
    await fs.write("settings.json", JSON.stringify({ leftHanded: true, pens: [], trashDays: 12 }));
    const settings = await loadSettings(fs);
    expect(settings.leftHanded).toBe(true);
    expect(settings.pens.length).toBeGreaterThan(0);
    expect(settings.trashDays).toBe(30);
    await fs.write("settings.json", "{{");
    expect((await loadSettings(fs)).leftHanded).toBe(false);
    await saveSettings(fs, { ...defaultSettings(), appearance: "dark" });
    expect((await loadSettings(fs)).appearance).toBe("dark");
  });
  it("mends folder loops and orphans", async () => {
    const mended = mendFolders([{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "gone" }, { id: "d", name: "D", parent: "c" }]);
    expect(mended.find((f) => f.id === "c")!.parent).toBeNull();
    expect(mended.filter((f) => f.parent === null).length).toBeGreaterThanOrEqual(2);
    expect(await loadFolders(new MemoryFS())).toEqual([]);
  });
  it("walks folders", () => {
    const folders = [{ id: "a", name: "School", parent: null }, { id: "b", name: "Physics", parent: "a" }, { id: "c", name: "Labs", parent: "b" }, { id: "x", name: "Other", parent: null }];
    expect([...folderAndDescendants(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect(folderPath(folders, "c")).toBe("School › Physics › Labs");
    expect(folderPath(folders, null)).toBe("");
  });
  it("matches smart shelves by all or any tag, whatever the case", () => {
    expect(shelfMatches({ id: "", name: "", tags: ["School", "exam"], match: "all" }, ["school"])).toBe(false);
    expect(shelfMatches({ id: "", name: "", tags: ["School", "exam"], match: "all" }, ["EXAM", "school", "x"])).toBe(true);
    expect(shelfMatches({ id: "", name: "", tags: ["School", "exam"], match: "any" }, ["exam"])).toBe(true);
    expect(shelfMatches({ id: "", name: "", tags: [], match: "any" }, ["exam"])).toBe(false);
  });
  it("counts writing by day and notebook", async () => {
    let activity = await loadActivity(new MemoryFS());
    const day = new Date(2026, 4, 2);
    activity = recordWriting(activity, "A", 3, day);
    activity = recordWriting(activity, "A", 2, day);
    activity = recordWriting(activity, "B", 1, day);
    expect(activity.days["2026-05-02"]).toEqual({ strokes: 6, notebooks: ["A", "B"] });
  });
});
