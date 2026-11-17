// One file for the whole library, or for some notebooks of it: a zip of the notebook packages and the library's
// own files. Restoring only ever adds: nothing that is already in the library is changed or removed.

import { unzipSync, zipSync, type Zippable } from "fflate";
import { dayKey } from "../model/days";
import { uuid } from "../model/ids";
import { decodeManifest, encodeManifest, type Manifest } from "../model/notebook";
import { bytesOf, listAll, MemoryFS, readText, type FS } from "../platform/fs";
import { loadActivity, loadFolders, loadShelves, mendFolders, saveActivity, saveFolders, saveShelves, type Activity } from "../storage/libraryFiles";
import { isPackageName, PACKAGE_SUFFIX, packageDir } from "../storage/package";
import { t } from "../i18n";

export const BACKUP_SUFFIX = ".owlbackup";

export function backupFileName(date: Date = new Date()): string {
  return `OwlLuna ${dayKey(date)}${BACKUP_SUFFIX}`;
}

export class NotABackup extends Error {}

/** Files that are already compressed gain nothing from a second pass. */
const alreadyCompressed = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "pdf", "mp4", "m4a", "mp3", "aac", "opus", "zip"]);

function level(path: string): 0 | 6 {
  return alreadyCompressed.has(path.split(".").pop()?.toLowerCase() ?? "") ? 0 : 6;
}

/** Whether an entry's path stays inside the library: no `..`, no absolute path, no drive letter. */
export function isSafeEntryPath(path: string): boolean {
  if (!path || path.includes("\u0000")) return false;
  if (/^[\\/]/.test(path) || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}

const bannedInName = /[<>:"/\\|?*\u0000-\u001f]/;

/** Makes a backup of the library, or of the notebooks `ids` (and the library's own files). Locked or not, they go in as they are. */
export async function makeBackup(fs: FS, ids?: string[]): Promise<Uint8Array> {
  const zip: Zippable = {};
  const added: { id: string; title: string }[] = [];
  const wanted = ids ? new Set(ids) : null;
  for (const entry of await fs.list("")) {
    if (!entry.isDir || !isPackageName(entry.name)) continue;
    const id = entry.name.slice(0, -PACKAGE_SUFFIX.length);
    if (wanted && !wanted.has(id)) continue;
    const text = await readText(fs, `${entry.name}/manifest.json`);
    if (text === null) continue;
    let title: string;
    try {
      title = decodeManifest(text).title;
    } catch {
      // A notebook that can't be read is left out rather than backed up as something that can't be restored.
      continue;
    }
    for (const file of await listAll(fs, entry.name)) {
      if (file.includes(".corrupt-")) continue;
      const data = await fs.read(`${entry.name}/${file}`);
      if (data) zip[`notebooks/${entry.name}/${file}`] = [data, { level: level(file) }];
    }
    added.push({ id, title });
  }
  for (const name of ["folders.json", "shelves.json", "activity.json"]) {
    const data = await fs.read(name);
    if (data) zip[name] = data;
  }
  const settings = await readText(fs, "settings.json");
  if (settings !== null) {
    try {
      const parsed = JSON.parse(settings) as Record<string, unknown>;
      // The PIN stays on this PC.
      delete parsed.pinHash;
      delete parsed.pinSalt;
      zip["settings.json"] = bytesOf(JSON.stringify(parsed, null, 1));
    } catch {
      // Settings that can't be read are not worth carrying.
    }
  }
  zip["backup.json"] = bytesOf(JSON.stringify({ version: 1, madeAt: Date.now(), notebooks: added }, null, 1));
  return zipSync(zip);
}

export interface RestoreResult {
  added: number;
  keptBoth: number;
  skipped: number;
}

/** A library file read out of the backup, through the same readers the app uses so it is mended the same way. */
async function readThrough<T>(bytes: Uint8Array | undefined, file: string, load: (fs: FS) => Promise<T>): Promise<T | null> {
  if (!bytes) return null;
  const scratch = new MemoryFS();
  await scratch.write(file, bytes);
  return load(scratch);
}

export async function restoreBackup(fs: FS, data: Uint8Array): Promise<RestoreResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new NotABackup(t("This isn't an OwlLuna backup."));
  }
  // A single path that leaves the library makes the whole file untrustworthy.
  for (const name of Object.keys(entries)) {
    if (!isSafeEntryPath(name)) throw new NotABackup(t("This backup holds files outside the library, so it wasn't opened."));
  }
  try {
    const info = JSON.parse(new TextDecoder().decode(entries["backup.json"]));
    if (!info || info.version !== 1 || !Array.isArray(info.notebooks)) throw new Error("wrong shape");
  } catch {
    throw new NotABackup(t("This isn't an OwlLuna backup."));
  }

  // Group the notebook files by package folder.
  const packages = new Map<string, Map<string, Uint8Array>>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const parts = name.split(/[\\/]/).filter(Boolean);
    if (parts[0] !== "notebooks" || parts.length < 3) continue;
    if (!isPackageName(parts[1]) || bannedInName.test(parts[1])) throw new NotABackup(t("This backup names a notebook in a way that isn't allowed."));
    const id = parts[1].slice(0, -PACKAGE_SUFFIX.length);
    const files = packages.get(id) ?? new Map<string, Uint8Array>();
    files.set(parts.slice(2).join("/"), bytes);
    packages.set(id, files);
  }

  const taken = new Set((await fs.list("")).filter((entry) => entry.isDir).map((entry) => entry.name));
  const result: RestoreResult = { added: 0, keptBoth: 0, skipped: 0 };
  const decoder = new TextDecoder();

  for (const [id, files] of packages) {
    const manifestBytes = files.get("manifest.json");
    let manifest: Manifest;
    try {
      if (!manifestBytes) throw new Error("no manifest");
      manifest = decodeManifest(decoder.decode(manifestBytes));
    } catch {
      result.skipped++;
      continue;
    }
    const dir = packageDir(id);
    const writeFiles = async (target: string) => {
      for (const [file, bytes] of files) {
        if (file === "manifest.json" || file.includes(".corrupt-")) continue;
        await fs.write(`${target}/${file}`, bytes);
      }
    };
    if (!taken.has(dir)) {
      await writeFiles(dir);
      // The manifest goes last: a restore cut short leaves a folder with no manifest, never a notebook missing pages.
      await fs.write(`${dir}/manifest.json`, manifestBytes!);
      taken.add(dir);
      result.added++;
      continue;
    }
    const have = await readText(fs, `${dir}/manifest.json`);
    if (have === decoder.decode(manifestBytes)) {
      result.skipped++;
      continue;
    }
    let copyID = uuid();
    while (taken.has(packageDir(copyID))) copyID = uuid();
    const copy: Manifest = { ...manifest, id: copyID, title: `${manifest.title} (restored)` };
    delete copy.journal;
    await writeFiles(packageDir(copyID));
    await fs.write(`${packageDir(copyID)}/manifest.json`, encodeManifest(copy));
    taken.add(packageDir(copyID));
    result.keptBoth++;
  }

  // Folders and shelves: the library's own win where an ID is in both.
  const folders = await loadFolders(fs);
  const theirFolders = await readThrough(entries["folders.json"], "folders.json", loadFolders);
  if (theirFolders) {
    const have = new Set(folders.map((folder) => folder.id));
    const fresh = theirFolders.filter((folder) => !have.has(folder.id));
    if (fresh.length) await saveFolders(fs, mendFolders([...folders, ...fresh]));
  }
  const shelves = await loadShelves(fs);
  const theirShelves = await readThrough(entries["shelves.json"], "shelves.json", loadShelves);
  if (theirShelves) {
    const have = new Set(shelves.map((shelf) => shelf.id));
    const fresh = theirShelves.filter((shelf) => !have.has(shelf.id));
    if (fresh.length) await saveShelves(fs, [...shelves, ...fresh]);
  }

  // Writing history: the larger count for a day, and every notebook written in it.
  const theirActivity = await readThrough(entries["activity.json"], "activity.json", loadActivity);
  if (theirActivity && Object.keys(theirActivity.days).length) {
    const ours = await loadActivity(fs);
    const days: Activity["days"] = { ...ours.days };
    for (const [key, day] of Object.entries(theirActivity.days)) {
      const mine = days[key];
      days[key] = mine
        ? { strokes: Math.max(mine.strokes, day.strokes), notebooks: [...new Set([...mine.notebooks, ...day.notebooks])] }
        : day;
    }
    await saveActivity(fs, { version: 1, days });
  }
  return result;
}
