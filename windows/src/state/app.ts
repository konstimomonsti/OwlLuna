// The app's state: the library's notebooks, folders and settings, the notebooks that are open, and which is shown.

import { create } from "zustand";
import { NotebookDocument } from "../editor/document";
import { dayKey } from "../model/days";
import { defaultCover, newManifest, newPage, type CoverSpec, type Manifest, type PageDefaults } from "../model/notebook";
import type { FS } from "../platform/fs";
import { libraryFS } from "../platform/host";
import {
  defaultSettings, folderAndDescendants, loadActivity, loadFolders, loadSettings, loadShelves, newFolder, recordWriting,
  saveActivity, saveFolders, saveSettings, saveShelves, type Activity, type Folder, type Settings, type SmartShelf,
} from "../storage/libraryFiles";
import { deletePackage, duplicatePackage, isPackageName, loadManifest, PACKAGE_SUFFIX, saveManifest } from "../storage/package";
import { backdrops } from "../canvas/backdrops";
import { uuid } from "../model/ids";

export type Scope =
  | { kind: "all" }
  | { kind: "favourites" }
  | { kind: "folder"; id: string }
  | { kind: "shelf"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "trash" };

export interface Notice {
  id: string;
  message: string;
  tone: "info" | "trouble";
  action?: { label: string; run: () => void };
}

export interface AppState {
  ready: boolean;
  fs: FS;
  settings: Settings;
  manifests: Record<string, Manifest>;
  unreadable: { id: string; message: string }[];
  folders: Folder[];
  shelves: SmartShelf[];
  activity: Activity;
  /** Open notebooks, in tab order. */
  tabs: string[];
  /** The notebook shown, or null for the library. */
  active: string | null;
  /** A second notebook shown beside the first. */
  split: string | null;
  scope: Scope;
  /** Locked notebooks opened in this sitting. */
  unlocked: string[];
  notices: Notice[];
  /** Where to land in a notebook that is about to open. */
  jump: { notebook: string; page: string } | null;
  /** The Settings sheet and the writing calendar are opened from the library, the editor and the keyboard alike. */
  settingsOpen: boolean;
  calendarOpen: boolean;
}

export const useApp = create<AppState>(() => ({
  ready: false,
  fs: libraryFS(),
  settings: defaultSettings(),
  manifests: {},
  unreadable: [],
  folders: [],
  shelves: [],
  activity: { version: 1, days: {} },
  tabs: [],
  active: null,
  split: null,
  scope: { kind: "all" },
  unlocked: [],
  notices: [],
  jump: null,
  settingsOpen: false,
  calendarOpen: false,
}));

const get = useApp.getState;
const set = useApp.setState;

const documents = new Map<string, NotebookDocument>();
const opening = new Map<string, Promise<NotebookDocument>>();

export function notify(message: string, tone: Notice["tone"] = "info", action?: Notice["action"]): void {
  const notice: Notice = { id: uuid(), message, tone, action };
  set((state) => ({ notices: [...state.notices.slice(-3), notice] }));
  setTimeout(() => dismissNotice(notice.id), tone === "trouble" ? 9000 : 4500);
}

export function dismissNotice(id: string): void {
  set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
}

function trouble(error: unknown, doing: string): void {
  notify(`${doing}: ${error instanceof Error ? error.message : String(error)}`, "trouble");
}

/** Reads the library. Called once at launch, and again after a restore or a change of library folder. */
export async function loadLibrary(fs: FS = libraryFS()): Promise<void> {
  const [settings, folders, shelves, activity] = await Promise.all([loadSettings(fs), loadFolders(fs), loadShelves(fs), loadActivity(fs)]);
  const manifests: Record<string, Manifest> = {};
  const unreadable: AppState["unreadable"] = [];
  for (const entry of await fs.list("")) {
    if (!entry.isDir || !isPackageName(entry.name)) continue;
    const id = entry.name.slice(0, -PACKAGE_SUFFIX.length);
    try {
      manifests[id] = await loadManifest(fs, id);
    } catch (error) {
      unreadable.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const known = new Set(folders.map((folder) => folder.id));
  for (const manifest of Object.values(manifests)) if (manifest.folder && !known.has(manifest.folder)) manifests[manifest.id] = { ...manifest, folder: null };
  set({ ready: true, fs, settings, folders, shelves, activity, manifests, unreadable });
  await purgeExpiredTrash();
}

// Settings

let settingsTimer: ReturnType<typeof setTimeout> | null = null;

export function updateSettings(patch: Partial<Settings>): void {
  set((state) => ({ settings: { ...state.settings, ...patch } }));
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => void saveSettings(get().fs, get().settings).catch((error) => trouble(error, "Couldn't save settings")), 300);
}

export async function flushSettings(): Promise<void> {
  if (settingsTimer) {
    clearTimeout(settingsTimer);
    settingsTimer = null;
    await saveSettings(get().fs, get().settings);
  }
}

// Documents

function adopt(manifest: Manifest): void {
  set((state) => ({ manifests: { ...state.manifests, [manifest.id]: manifest } }));
}

let activityTimer: ReturnType<typeof setTimeout> | null = null;

function wrote(notebookID: string, strokes: number): void {
  if (!get().settings.writingHistory) return;
  set((state) => ({ activity: recordWriting(state.activity, notebookID, strokes) }));
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(() => void saveActivity(get().fs, get().activity).catch(() => {}), 2000);
}

/** The one document of a notebook, opened if it isn't yet. Every view of the notebook shares it. */
export function openDocument(id: string): Promise<NotebookDocument> {
  const have = documents.get(id);
  if (have) return Promise.resolve(have);
  let pending = opening.get(id);
  if (!pending) {
    pending = loadManifest(get().fs, id).then((manifest) => {
      const doc = new NotebookDocument(get().fs, manifest);
      doc.onSaved = adopt;
      doc.onWrote = (_page, strokes) => wrote(id, strokes);
      documents.set(id, doc);
      opening.delete(id);
      adopt(manifest);
      return doc;
    }, (error) => {
      opening.delete(id);
      throw error;
    });
    opening.set(id, pending);
  }
  return pending;
}

export function documentIfOpen(id: string): NotebookDocument | undefined {
  return documents.get(id);
}

/** Saves and lets go of a notebook. Throws if the last save fails, and keeps it open. */
async function releaseDocument(id: string): Promise<void> {
  const doc = documents.get(id);
  if (!doc) return;
  await doc.close();
  documents.delete(id);
  backdrops.forget(id);
}

/** Changes a notebook's manifest, through its document if it is open so the two never disagree. */
export async function changeNotebook(id: string, work: (manifest: Manifest) => void): Promise<void> {
  const doc = documents.get(id);
  if (doc) {
    doc.touch(work);
    adopt(doc.manifest);
    return;
  }
  const manifest = structuredClone(get().manifests[id] ?? (await loadManifest(get().fs, id)));
  work(manifest);
  manifest.modifiedAt = Date.now();
  await saveManifest(get().fs, manifest);
  adopt(manifest);
}

// Navigation

/** Asks the user to prove who they are. Registered by the lock service, so this file doesn't depend on it. */
type Authenticator = (reason: string) => Promise<boolean>;
let authenticator: Authenticator | null = null;

export function setAuthenticator(next: Authenticator | null): void {
  authenticator = next;
}

export async function openNotebook(id: string, pageID?: string): Promise<boolean> {
  const manifest = get().manifests[id];
  if (!manifest || manifest.trashedAt !== null) return false;
  // Every way in, links and search results included, comes through here, so the lock can't be walked around.
  if (manifest.locked && !get().unlocked.includes(id)) {
    if (!authenticator || !(await authenticator(`Open “${manifest.title}”`))) return false;
    unlock(id);
  }
  try {
    await openDocument(id);
  } catch (error) {
    trouble(error, "Couldn't open the notebook");
    return false;
  }
  set((state) => ({
    tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id],
    active: state.split === id ? state.active ?? id : id,
    jump: pageID ? { notebook: id, page: pageID } : state.jump,
  }));
  updateSettings({ lastOpened: id });
  return true;
}

export function showLibrary(): void {
  set({ active: null });
  for (const doc of documents.values()) void doc.save().catch(() => {});
}

export function showTab(id: string): void {
  if (get().tabs.includes(id)) set((state) => ({ active: id, split: state.split === id ? null : state.split }));
}

export function setSplit(id: string | null): void {
  set((state) => ({ split: id && id !== state.active && state.tabs.includes(id) ? id : null }));
}

export async function closeTab(id: string): Promise<boolean> {
  try {
    await releaseDocument(id);
  } catch (error) {
    trouble(error, "The notebook couldn't be saved, so it stays open");
    return false;
  }
  set((state) => {
    const index = state.tabs.indexOf(id);
    const tabs = state.tabs.filter((tab) => tab !== id);
    const split = state.split === id ? null : state.split;
    let active = state.active;
    if (active === id) active = split ?? tabs[Math.min(index, tabs.length - 1)] ?? null;
    return { tabs, active, split: split === active ? null : split, unlocked: state.unlocked.filter((open) => open !== id) };
  });
  return true;
}

/** Closes a notebook's tab if it has one. False only when it could not be saved. */
export async function closeTabIfOpen(id: string): Promise<boolean> {
  return get().tabs.includes(id) ? closeTab(id) : true;
}

export function clearJump(): void {
  set({ jump: null });
}

export function setScope(scope: Scope): void {
  set({ scope });
}

export function openSettings(open = true): void {
  set({ settingsOpen: open });
}

export function openCalendar(open = true): void {
  set({ calendarOpen: open });
}

export function unlock(id: string): void {
  set((state) => ({ unlocked: state.unlocked.includes(id) ? state.unlocked : [...state.unlocked, id] }));
}

// Notebooks

export interface NewNotebookOptions {
  title: string;
  kind?: "notebook" | "whiteboard";
  defaults?: PageDefaults;
  cover?: Partial<CoverSpec>;
  folder?: string | null;
  tags?: string[];
  journal?: boolean;
}

export async function createNotebook(options: NewNotebookOptions): Promise<Manifest> {
  const scope = get().scope;
  const manifest = newManifest({
    ...options,
    title: options.title.trim() || "Untitled",
    folder: options.folder !== undefined ? options.folder : scope.kind === "folder" ? scope.id : null,
    tags: options.tags ?? (scope.kind === "tag" ? [scope.tag] : []),
  });
  await saveManifest(get().fs, manifest);
  adopt(manifest);
  return manifest;
}

/** "Quick Note 3 Oct, 14:05": a notebook to write in at once. */
export async function quickNote(): Promise<Manifest> {
  const now = new Date();
  const title = `Quick Note ${now.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  const manifest = await createNotebook({ title, defaults: { template: "blank", paperColor: "white", pageSize: "letter" }, folder: null, tags: [] });
  await openNotebook(manifest.id);
  return manifest;
}

/** The daily journal's notebook and today's page in it, both made if they aren't there. */
export async function openToday(date: Date = new Date()): Promise<{ notebook: string; page: string } | null> {
  let journal = Object.values(get().manifests).find((manifest) => manifest.journal && manifest.trashedAt === null);
  if (!journal) journal = await createNotebook({ title: "Journal", journal: true, folder: null, tags: [], cover: { ...defaultCover("journal"), cloth: "navy" } });
  const key = dayKey(date);
  let doc: NotebookDocument;
  try {
    doc = await openDocument(journal.id);
  } catch (error) {
    trouble(error, "Couldn't open the journal");
    return null;
  }
  let page = doc.manifest.pages.find((candidate) => candidate.date === key);
  if (!page) {
    const blank = doc.manifest.pages.length === 1 && !doc.manifest.pages[0].date && (await doc.ensureInk(doc.manifest.pages[0].id)).length === 0 && doc.manifest.pages[0].items.length === 0;
    if (blank) {
      const first = doc.manifest.pages[0].id;
      doc.touch((manifest) => { manifest.pages[0].date = key; });
      page = doc.page(first)!;
    } else {
      // Days stay in order, whichever is written first.
      const fresh = newPage(doc.manifest.defaults, { date: key });
      const later = doc.manifest.pages.findIndex((candidate) => candidate.date !== undefined && candidate.date > key);
      doc.touch((manifest) => void manifest.pages.splice(later === -1 ? manifest.pages.length : later, 0, fresh));
      page = fresh;
    }
    adopt(doc.manifest);
  }
  await openNotebook(journal.id, page.id);
  return { notebook: journal.id, page: page.id };
}

export async function renameNotebook(id: string, title: string): Promise<void> {
  const cleaned = title.trim();
  if (cleaned) await changeNotebook(id, (manifest) => { manifest.title = cleaned; });
}

export async function trashNotebooks(ids: string[]): Promise<void> {
  const now = Date.now();
  for (const id of ids) {
    if (get().tabs.includes(id) && !(await closeTab(id))) continue;
    await changeNotebook(id, (manifest) => { manifest.trashedAt = now; manifest.favourite = false; });
  }
  notify(ids.length === 1 ? "Moved to Recently Deleted" : `${ids.length} notebooks moved to Recently Deleted`, "info", {
    label: "Undo", run: () => void restoreNotebooks(ids),
  });
}

export async function restoreNotebooks(ids: string[]): Promise<void> {
  const folders = new Set(get().folders.map((folder) => folder.id));
  for (const id of ids) {
    await changeNotebook(id, (manifest) => {
      manifest.trashedAt = null;
      if (manifest.folder && !folders.has(manifest.folder)) manifest.folder = null;
    });
  }
}

export async function deleteForever(ids: string[]): Promise<void> {
  for (const id of ids) {
    if (documents.has(id)) continue;
    await deletePackage(get().fs, id);
    set((state) => {
      const { [id]: _gone, ...rest } = state.manifests;
      return { manifests: rest };
    });
  }
}

/** Empties Recently Deleted of what has been there longer than Settings allows. */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const limit = get().settings.trashDays * 86_400_000;
  const expired = Object.values(get().manifests).filter((manifest) => manifest.trashedAt !== null && now - manifest.trashedAt > limit).map((manifest) => manifest.id);
  await deleteForever(expired);
  return expired.length;
}

/** Empties Recently Deleted at once. */
export async function emptyTrash(): Promise<void> {
  await deleteForever(Object.values(get().manifests).filter((manifest) => manifest.trashedAt !== null).map((manifest) => manifest.id));
}

export async function duplicateNotebook(id: string): Promise<Manifest | null> {
  const source = get().manifests[id];
  if (!source) return null;
  await documents.get(id)?.save();
  const titles = new Set(Object.values(get().manifests).map((manifest) => manifest.title));
  let title = `${source.title} copy`;
  for (let n = 2; titles.has(title); n++) title = `${source.title} copy ${n}`;
  const copy = await duplicatePackage(get().fs, id, title);
  adopt(copy);
  return copy;
}

export async function moveNotebooks(ids: string[], folder: string | null): Promise<void> {
  for (const id of ids) await changeNotebook(id, (manifest) => { manifest.folder = folder; });
}

// Folders and shelves

async function writeFolders(folders: Folder[]): Promise<void> {
  set({ folders });
  await saveFolders(get().fs, folders);
}

export async function addFolder(name: string, parent: string | null): Promise<Folder> {
  const folder = newFolder(name, parent);
  await writeFolders([...get().folders, folder]);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const cleaned = name.trim();
  if (cleaned) await writeFolders(get().folders.map((folder) => (folder.id === id ? { ...folder, name: cleaned } : folder)));
}

/** Moves a folder under another. Refused when that would put it inside itself. */
export async function moveFolder(id: string, parent: string | null): Promise<boolean> {
  if (parent !== null && folderAndDescendants(get().folders, id).has(parent)) return false;
  await writeFolders(get().folders.map((folder) => (folder.id === id ? { ...folder, parent } : folder)));
  return true;
}

/** Removes a folder and those inside it. Their notebooks move up to where the folder was. */
export async function removeFolder(id: string): Promise<void> {
  const gone = folderAndDescendants(get().folders, id);
  const parent = get().folders.find((folder) => folder.id === id)?.parent ?? null;
  for (const manifest of Object.values(get().manifests)) {
    if (manifest.folder && gone.has(manifest.folder)) await changeNotebook(manifest.id, (draft) => { draft.folder = parent; });
  }
  await writeFolders(get().folders.filter((folder) => !gone.has(folder.id)));
  const scope = get().scope;
  if (scope.kind === "folder" && gone.has(scope.id)) set({ scope: { kind: "all" } });
}

export async function saveShelf(shelf: SmartShelf): Promise<void> {
  const others = get().shelves.filter((candidate) => candidate.id !== shelf.id);
  const shelves = get().shelves.some((candidate) => candidate.id === shelf.id) ? get().shelves.map((candidate) => (candidate.id === shelf.id ? shelf : candidate)) : [...others, shelf];
  set({ shelves });
  await saveShelves(get().fs, shelves);
}

export async function removeShelf(id: string): Promise<void> {
  const shelves = get().shelves.filter((shelf) => shelf.id !== id);
  set({ shelves });
  await saveShelves(get().fs, shelves);
  const scope = get().scope;
  if (scope.kind === "shelf" && scope.id === id) set({ scope: { kind: "all" } });
}

export async function clearWritingHistory(): Promise<void> {
  const activity: Activity = { version: 1, days: {} };
  set({ activity });
  await saveActivity(get().fs, activity);
}

/** Saves everything, before the window closes. */
export async function saveAll(): Promise<void> {
  await flushSettings();
  for (const doc of documents.values()) await doc.save();
  if (activityTimer) {
    clearTimeout(activityTimer);
    activityTimer = null;
    await saveActivity(get().fs, get().activity);
  }
}

/** Lets go of everything in memory, for tests and for switching library folders. */
export async function resetApp(fs: FS): Promise<void> {
  for (const id of [...documents.keys()]) {
    try { await releaseDocument(id); } catch { documents.delete(id); }
  }
  opening.clear();
  set({ ready: false, fs, manifests: {}, unreadable: [], folders: [], shelves: [], tabs: [], active: null, split: null, scope: { kind: "all" }, unlocked: [], notices: [], jump: null, settings: defaultSettings(), activity: { version: 1, days: {} } });
}

/** Every tag in use, most used first. */
export function allTags(manifests: Record<string, Manifest>): string[] {
  const counts = new Map<string, number>();
  for (const manifest of Object.values(manifests)) {
    if (manifest.trashedAt !== null) continue;
    for (const tag of manifest.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}
