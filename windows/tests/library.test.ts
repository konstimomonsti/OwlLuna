import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { onThisDay } from "../src/library/journal";
import { daysLeft, folderTree, inScope, sortNotebooks } from "../src/library/shelf";
import { MemoryFS, readText } from "../src/platform/fs";
import { newManifest, newPage, type Manifest } from "../src/model/notebook";
import { backupFileName, isSafeEntryPath, makeBackup, NotABackup, restoreBackup } from "../src/services/backup";
import { hashPin, newSalt, pinMatches, validPin } from "../src/services/pin";
import { documentsOf, LibrarySearch, makeSnippet, normalise, pageText, queryTerms } from "../src/services/search";
import { defaultSettings, loadActivity, loadFolders, loadShelves, saveActivity, saveFolders, saveSettings, saveShelves } from "../src/storage/libraryFiles";
import { loadManifest, saveManifest, saveWords } from "../src/storage/package";

const text = (value: string) => new TextEncoder().encode(value);
const defaults = { template: "blank", paperColor: "white", pageSize: "letter" } as const;

describe("pin", () => {
  it("accepts four or more digits only", () => {
    expect(validPin("1234")).toBe(true);
    expect(validPin("123")).toBe(false);
    expect(validPin("12a4")).toBe(false);
    expect(validPin("")).toBe(false);
  });

  it("hashes with a salt and compares", async () => {
    const salt = newSalt();
    const hash = await hashPin("2468", salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await pinMatches("2468", hash, salt)).toBe(true);
    expect(await pinMatches("2469", hash, salt)).toBe(false);
    expect(await hashPin("2468", newSalt())).not.toBe(hash);
    expect(await pinMatches("2468", null, null)).toBe(false);
  });
});

describe("search text", () => {
  it("folds case and accents without changing length", () => {
    expect(normalise("Crème Brûlée ÅNGSTRÖM")).toBe("creme brulee angstrom");
    expect(normalise("Straße 😀 İ").length).toBe("Straße 😀 İ".length);
    expect(queryTerms("  Café, au-lait! ")).toEqual(["cafe", "au", "lait"]);
  });

  it("marks the first match and the rest of its word", () => {
    const snippet = makeSnippet("The quick brown fox jumps over the lazy dog and keeps running far away from home", ["jump"], 12);
    expect(snippet.match).toBe("jumps");
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
    expect(makeSnippet("Résumé notes", ["resume"]).match).toBe("Résumé");
    expect(makeSnippet("nothing here", ["zebra"])).toEqual({ before: "", match: "", after: "nothing here" });
  });

  it("reads typed text, links, picture text and recognised words from a page", () => {
    const page = newPage(defaults);
    const base = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    page.items = [
      { id: "1", kind: "text", ...base, string: "Hello\nworld", fontSize: 17 },
      { id: "2", kind: "link", ...base, label: "Physics notes", target: { to: "web", url: "https://x.org" } },
      { id: "3", kind: "image", ...base, file: "a.png", text: "whiteboard scan" },
      { id: "4", kind: "tape", ...base, color: "rose" },
    ];
    const read = pageText(page, { text: "scribbled words" });
    for (const part of ["Hello world", "Physics notes", "whiteboard scan", "scribbled words"]) expect(read).toContain(part);
    const manifest = newManifest({ title: "Maths", tags: ["school"], pages: [page, newPage(defaults)] });
    expect(documentsOf(manifest, null).docs.map((doc) => doc.kind)).toEqual(["notebook", "page"]);
  });
});

describe("library search", () => {
  async function library() {
    const fs = new MemoryFS();
    const physics = newManifest({ title: "Physique", tags: ["école"] });
    physics.pages[0].items.push({ id: "t", kind: "text", x: 0, y: 0, w: 10, h: 10, rotation: 0, string: "Newton second law of motion", fontSize: 17 });
    const garden = newManifest({ title: "Garden" });
    await saveManifest(fs, physics);
    await saveManifest(fs, garden);
    await saveWords(fs, garden.id, { version: 1, pages: { [garden.pages[0].id]: { key: "k", text: "plant tomatoes in april" } } });
    return { fs, physics, garden, manifests: { [physics.id]: physics, [garden.id]: garden } };
  }

  it("finds titles, tags, typed text and recognised words, ignoring accents, with prefixes and typos", async () => {
    const { fs, physics, garden, manifests } = await library();
    const search = new LibrarySearch();
    await search.refresh(fs, manifests);
    expect(search.search("physique").notebooks.map((hit) => hit.id)).toEqual([physics.id]);
    expect(search.search("ecole").notebooks.map((hit) => hit.id)).toEqual([physics.id]);
    const typed = search.search("motio");
    expect(typed.pages).toHaveLength(1);
    expect(typed.pages[0]).toMatchObject({ notebook: physics.id, pageNumber: 1 });
    expect(typed.pages[0].snippet.match).toBe("motion");
    expect(search.search("tomatos").pages[0].notebook).toBe(garden.id);
    expect(search.search("zzzz")).toEqual({ notebooks: [], pages: [] });
  });

  it("leaves out locked and deleted notebooks and picks up changes", async () => {
    const { fs, physics, garden, manifests } = await library();
    const search = new LibrarySearch();
    await search.refresh(fs, manifests);
    const locked = { ...physics, locked: true, modifiedAt: physics.modifiedAt + 1 };
    const trashed = { ...garden, trashedAt: 5, modifiedAt: garden.modifiedAt + 1 };
    await search.refresh(fs, { [physics.id]: locked, [garden.id]: trashed });
    expect(search.search("newton").pages).toEqual([]);
    expect(search.search("garden").notebooks).toEqual([]);
    const renamed = { ...physics, title: "Mechanics", modifiedAt: physics.modifiedAt + 2 };
    await search.refresh(fs, { [physics.id]: renamed, [garden.id]: garden });
    expect(search.search("mechanics").notebooks).toHaveLength(1);
    expect(search.search("physique").notebooks).toHaveLength(0);
    expect(search.search("newton").pages).toHaveLength(1);
  });
});

describe("shelf rules", () => {
  const make = (title: string, extra: Partial<Manifest> = {}): Manifest => ({ ...newManifest({ title }), ...extra });

  it("scopes and sorts", () => {
    const a = make("b notebook", { createdAt: 1, modifiedAt: 30, tags: ["x"], favourite: true });
    const b = make("A notebook", { createdAt: 3, modifiedAt: 10, folder: "f" });
    const c = make("gone", { trashedAt: 9 });
    const shelves = [{ id: "s", name: "S", tags: ["x"], match: "all" as const }];
    expect([a, b, c].filter((m) => inScope(m, { kind: "all" }, shelves))).toEqual([a, b]);
    expect([a, b, c].filter((m) => inScope(m, { kind: "trash" }, shelves))).toEqual([c]);
    expect([a, b].filter((m) => inScope(m, { kind: "folder", id: "f" }, shelves))).toEqual([b]);
    expect([a, b].filter((m) => inScope(m, { kind: "shelf", id: "s" }, shelves))).toEqual([a]);
    expect(sortNotebooks([a, b], "title")).toEqual([b, a]);
    expect(sortNotebooks([a, b], "created")).toEqual([b, a]);
    expect(sortNotebooks([a, b], "modified")).toEqual([a, b]);
  });

  it("counts the days left in the trash and orders folders as a tree", () => {
    const day = 86_400_000;
    expect(daysLeft(0, 30, 29 * day + 1)).toBe(1);
    expect(daysLeft(0, 30, 40 * day)).toBe(0);
    const tree = folderTree([{ id: "c", name: "Child", parent: "p" }, { id: "p", name: "Parent", parent: null }, { id: "a", name: "Apple", parent: null }]);
    expect(tree.map((row) => [row.folder.id, row.depth])).toEqual([["a", 0], ["p", 0], ["c", 1]]);
  });
});

describe("on this day", () => {
  it("finds earlier years, a week ago and a month ago", () => {
    const journal = newManifest({ title: "Journal", journal: true });
    const dates = ["2025-11-16", "2024-11-16", "2026-11-09", "2026-10-16", "2026-11-10", "2026-11-16"];
    journal.pages = dates.map((date) => newPage(journal.defaults, { date }));
    const found = onThisDay(journal, new Date(2026, 10, 16));
    expect(found.map((memory) => memory.label)).toEqual(["A week ago", "A month ago", "A year ago", "2 years ago"]);
    expect(onThisDay({ ...journal, locked: true }, new Date(2026, 10, 16))).toEqual([]);
  });
});

describe("backup", () => {
  async function seeded() {
    const fs = new MemoryFS();
    const book = newManifest({ title: "Maths" });
    await saveManifest(fs, book);
    await fs.write(`${book.id}.owlluna/ink/${book.pages[0].id}.json`, "[]");
    await fs.write(`${book.id}.owlluna/assets/a.png`, new Uint8Array([1, 2, 3]));
    await saveFolders(fs, [{ id: "f1", name: "School", parent: null }]);
    await saveShelves(fs, [{ id: "s1", name: "Study", tags: ["x"], match: "any" }]);
    await saveActivity(fs, { version: 1, days: { "2026-01-02": { strokes: 10, notebooks: [book.id] } } });
    await saveSettings(fs, { ...defaultSettings(), pinHash: "abc", pinSalt: "def" });
    return { fs, book };
  }

  it("names the file by day and keeps the PIN out", async () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe("OwlLuna 2026-01-05.owlbackup");
    const { fs } = await seeded();
    const files = unzipSync(await makeBackup(fs));
    expect(Object.keys(files)).toContain("backup.json");
    expect(new TextDecoder().decode(files["settings.json"])).not.toContain("pinHash");
    expect(JSON.parse(new TextDecoder().decode(files["backup.json"])).notebooks).toHaveLength(1);
  });

  it("restores into an empty library and never restores settings", async () => {
    const { fs, book } = await seeded();
    const empty = new MemoryFS();
    expect(await restoreBackup(empty, await makeBackup(fs))).toEqual({ added: 1, keptBoth: 0, skipped: 0 });
    expect((await loadManifest(empty, book.id)).title).toBe("Maths");
    expect(await empty.read(`${book.id}.owlluna/assets/a.png`)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await loadFolders(empty)).toHaveLength(1);
    expect(await loadShelves(empty)).toHaveLength(1);
    expect((await loadActivity(empty)).days["2026-01-02"].strokes).toBe(10);
    expect(await empty.read("settings.json")).toBeNull();
  });

  it("skips what is identical and keeps both of what differs", async () => {
    const { fs, book } = await seeded();
    const backup = await makeBackup(fs);
    expect(await restoreBackup(fs, backup)).toEqual({ added: 0, keptBoth: 0, skipped: 1 });
    await saveManifest(fs, { ...(await loadManifest(fs, book.id)), title: "Maths, edited" });
    expect(await restoreBackup(fs, backup)).toEqual({ added: 0, keptBoth: 1, skipped: 0 });
    expect((await loadManifest(fs, book.id)).title).toBe("Maths, edited");
    const dirs = (await fs.list("")).filter((entry) => entry.isDir && entry.name.endsWith(".owlluna"));
    expect(dirs).toHaveLength(2);
    const copy = dirs.find((entry) => entry.name !== `${book.id}.owlluna`)!;
    expect((await loadManifest(fs, copy.name.replace(".owlluna", ""))).title).toBe("Maths (restored)");
    expect(await fs.read(`${copy.name}/assets/a.png`)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("merges folders, shelves and activity without overwriting", async () => {
    const { fs } = await seeded();
    const backup = await makeBackup(fs);
    await saveFolders(fs, [{ id: "f1", name: "Renamed here", parent: null }, { id: "f2", name: "Mine", parent: null }]);
    await saveShelves(fs, []);
    await saveActivity(fs, { version: 1, days: { "2026-01-02": { strokes: 99, notebooks: ["other"] } } });
    await restoreBackup(fs, backup);
    const folders = await loadFolders(fs);
    expect(folders.find((folder) => folder.id === "f1")!.name).toBe("Renamed here");
    expect(folders).toHaveLength(2);
    expect(await loadShelves(fs)).toHaveLength(1);
    const day = (await loadActivity(fs)).days["2026-01-02"];
    expect(day.strokes).toBe(99);
    expect(day.notebooks).toHaveLength(2);
    expect(await readText(fs, "settings.json")).toContain("pinHash");
  });

  it("backs up only the notebooks asked for", async () => {
    const { fs, book } = await seeded();
    const other = newManifest({ title: "Other" });
    await saveManifest(fs, other);
    const empty = new MemoryFS();
    await restoreBackup(empty, await makeBackup(fs, [other.id]));
    const names = (await empty.list("")).map((entry) => entry.name);
    expect(names).not.toContain(`${book.id}.owlluna`);
    expect(names).toContain(`${other.id}.owlluna`);
  });

  it("rejects files that are not backups and paths that leave the library", async () => {
    const fs = new MemoryFS();
    await expect(restoreBackup(fs, text("hello"))).rejects.toThrow(NotABackup);
    await expect(restoreBackup(fs, zipSync({ "readme.txt": text("hi") }))).rejects.toThrow(NotABackup);
    const info = text(JSON.stringify({ version: 1, madeAt: 1, notebooks: [] }));
    for (const bad of ["../evil.txt", "notebooks/../../evil.txt", "/abs.txt", "C:/win.txt", "C:\\win.txt", "notebooks\\..\\x"]) {
      expect(isSafeEntryPath(bad)).toBe(false);
      await expect(restoreBackup(fs, zipSync({ "backup.json": info, [bad]: text("x") }))).rejects.toThrow(NotABackup);
    }
    expect(isSafeEntryPath("notebooks/A.owlluna/ink/p.json")).toBe(true);
    expect(await fs.list("")).toEqual([]);
  });
});
