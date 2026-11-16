// One package per notebook: `<id>.owlluna/` holding `manifest.json`, one ink file per page, and assets.
// A file that can't be read is set aside as `.corrupt`, never overwritten.

import { decodeInk, encodeInk, type Stroke } from "../model/ink";
import { decodeManifest, encodeManifest, inkPath, type Manifest } from "../model/notebook";
import { decodeCards, encodeCards, type Flashcard } from "../model/flashcard";
import { uuid } from "../model/ids";
import { listAll, readText, type FS } from "../platform/fs";

export const PACKAGE_SUFFIX = ".owlluna";

export function packageDir(id: string): string {
  return id + PACKAGE_SUFFIX;
}

export function isPackageName(name: string): boolean {
  return name.endsWith(PACKAGE_SUFFIX) && name.length > PACKAGE_SUFFIX.length;
}

async function setAside(fs: FS, path: string): Promise<void> {
  try {
    await fs.rename(path, `${path}.corrupt-${Date.now()}`);
  } catch {
    // Left where it is; the caller still treats it as unreadable.
  }
}

export class UnreadableNotebook extends Error {
  constructor(public id: string, message: string) {
    super(message);
  }
}

export async function loadManifest(fs: FS, id: string): Promise<Manifest> {
  const path = `${packageDir(id)}/manifest.json`;
  const text = await readText(fs, path);
  if (text === null) throw new UnreadableNotebook(id, "The notebook has no manifest.");
  try {
    const manifest = decodeManifest(text);
    // The folder names the notebook: a copied folder must not answer to another's ID.
    return manifest.id === id ? manifest : { ...manifest, id };
  } catch (error) {
    if (!String(error).includes("newer OwlLuna")) await setAside(fs, path);
    throw new UnreadableNotebook(id, error instanceof Error ? error.message : String(error));
  }
}

export async function saveManifest(fs: FS, manifest: Manifest): Promise<void> {
  await fs.write(`${packageDir(manifest.id)}/manifest.json`, encodeManifest(manifest));
}

/** A page's ink. A page never written on has no file; a file that can't be read is set aside and the page comes back empty. */
export async function loadInk(fs: FS, id: string, pageID: string): Promise<Stroke[]> {
  const path = `${packageDir(id)}/${inkPath(pageID)}`;
  const text = await readText(fs, path);
  if (text === null) return [];
  try {
    return decodeInk(text);
  } catch {
    await setAside(fs, path);
    return [];
  }
}

export async function saveInk(fs: FS, id: string, pageID: string, strokes: Stroke[]): Promise<void> {
  const path = `${packageDir(id)}/${inkPath(pageID)}`;
  if (strokes.length === 0) await fs.remove(path);
  else await fs.write(path, encodeInk(strokes));
}

export function assetPath(id: string, file: string): string {
  return `${packageDir(id)}/assets/${file}`;
}

/** Keeps a file in the notebook under a new name with the same extension, and returns that name. */
export async function addAsset(fs: FS, id: string, data: Uint8Array, extension: string): Promise<string> {
  const name = `${uuid()}.${extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;
  await fs.write(assetPath(id, name), data);
  return name;
}

export async function loadCards(fs: FS, id: string): Promise<Flashcard[]> {
  const path = `${packageDir(id)}/cards.json`;
  const text = await readText(fs, path);
  if (text === null) return [];
  try {
    return decodeCards(text);
  } catch {
    await setAside(fs, path);
    return [];
  }
}

export async function saveCards(fs: FS, id: string, cards: Flashcard[]): Promise<void> {
  await fs.write(`${packageDir(id)}/cards.json`, encodeCards(cards));
}

/** The words recognised on each page, by page ID: handwriting, PDF text and scans. A cache, rebuilt when it is missing. */
export interface PageWords {
  version: 1;
  pages: Record<string, { key: string; text: string }>;
}

export async function loadWords(fs: FS, id: string): Promise<PageWords> {
  const text = await readText(fs, `${packageDir(id)}/words.json`);
  if (text !== null) {
    try {
      const parsed = JSON.parse(text) as PageWords;
      if (parsed && typeof parsed.pages === "object" && parsed.pages) return { version: 1, pages: parsed.pages };
    } catch {
      // A cache: start again.
    }
  }
  return { version: 1, pages: {} };
}

export async function saveWords(fs: FS, id: string, words: PageWords): Promise<void> {
  await fs.write(`${packageDir(id)}/words.json`, JSON.stringify(words));
}

export async function deletePackage(fs: FS, id: string): Promise<void> {
  await fs.remove(packageDir(id));
}

/** A whole copy under a new ID, pages and items keeping theirs so links inside it still land. */
export async function duplicatePackage(fs: FS, id: string, title: string, now = Date.now()): Promise<Manifest> {
  const manifest = await loadManifest(fs, id);
  const copyID = uuid();
  for (const file of await listAll(fs, packageDir(id))) {
    if (file === "manifest.json" || file.includes(".corrupt-")) continue;
    const data = await fs.read(`${packageDir(id)}/${file}`);
    if (data) await fs.write(`${packageDir(copyID)}/${file}`, data);
  }
  const copy: Manifest = { ...manifest, id: copyID, title, createdAt: now, modifiedAt: now, favourite: false, trashedAt: null };
  delete copy.journal;
  await saveManifest(fs, copy);
  return copy;
}

/** Removes assets no page uses any more. Called when a notebook closes, never while it may still be undone. */
export async function sweepAssets(fs: FS, manifest: Manifest, used: Set<string>): Promise<number> {
  let removed = 0;
  for (const entry of await fs.list(`${packageDir(manifest.id)}/assets`)) {
    if (!entry.isDir && !used.has(entry.name)) {
      await fs.remove(assetPath(manifest.id, entry.name));
      removed++;
    }
  }
  return removed;
}
