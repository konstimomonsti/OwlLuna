// One document per notebook: the manifest, the ink of the pages that are loaded, one undo history, and saving.
// Saves write only changed pages, then the manifest last, one save at a time.

import { fnv1a } from "../model/ids";
import { encodeInk, type Stroke } from "../model/ink";
import { duplicatedPage, newPage, usedAssets, type Manifest, type Page, type PageItem } from "../model/notebook";
import type { FS } from "../platform/fs";
import { loadInk, saveInk, saveManifest, sweepAssets } from "../storage/package";

interface Step {
  label: string;
  manifestBefore?: Manifest;
  manifestAfter?: Manifest;
  inkBefore: Map<string, Stroke[]>;
  inkAfter: Map<string, Stroke[]>;
}

export interface Draft {
  /** The manifest to change. Reading it marks it changed. */
  readonly manifest: Manifest;
  ink(pageID: string): Stroke[];
  setInk(pageID: string, strokes: Stroke[]): void;
}

export type SaveState = "saved" | "unsaved" | "saving" | "failed";

const UNDO_LIMIT = 200;

export class NotebookDocument {
  manifest: Manifest;
  private inks = new Map<string, Stroke[]>();
  private loading = new Map<string, Promise<Stroke[]>>();
  private dirtyInk = new Set<string>();
  private manifestDirty = false;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  /** Counts every change, so views can tell there was one. */
  version = 0;
  /** Counts each page's ink changes. */
  private inkVersions = new Map<string, number>();
  saveState: SaveState = "saved";
  saveError: string | null = null;
  /** Called after each save that wrote the manifest, with what was written. */
  onSaved: ((manifest: Manifest) => void) | null = null;
  /** Called when ink is added by writing, for the writing history. */
  onWrote: ((pageID: string, strokes: number) => void) | null = null;
  saveDelay = 700;

  constructor(readonly fs: FS, manifest: Manifest) {
    this.manifest = manifest;
  }

  get id(): string {
    return this.manifest.id;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }

  inkVersion(pageID: string): number {
    return this.inkVersions.get(pageID) ?? 0;
  }

  page(pageID: string): Page | undefined {
    return this.manifest.pages.find((page) => page.id === pageID);
  }

  pageIndex(pageID: string): number {
    return this.manifest.pages.findIndex((page) => page.id === pageID);
  }

  /** The page's ink if it has been loaded, else nothing yet. */
  ink(pageID: string): Stroke[] {
    return this.inks.get(pageID) ?? [];
  }

  inkLoaded(pageID: string): boolean {
    return this.inks.has(pageID);
  }

  async ensureInk(pageID: string): Promise<Stroke[]> {
    const have = this.inks.get(pageID);
    if (have) return have;
    let pending = this.loading.get(pageID);
    if (!pending) {
      pending = loadInk(this.fs, this.id, pageID).then((strokes) => {
        this.loading.delete(pageID);
        // Ink written while the file was being read wins.
        if (!this.inks.has(pageID)) {
          this.inks.set(pageID, strokes);
          this.inkVersions.set(pageID, this.inkVersion(pageID) + 1);
          this.changed();
        }
        return this.inks.get(pageID)!;
      });
      this.loading.set(pageID, pending);
    }
    return pending;
  }

  /** Every page's ink, for export and search. */
  async allInk(): Promise<Map<string, Stroke[]>> {
    const out = new Map<string, Stroke[]>();
    for (const page of this.manifest.pages) out.set(page.id, await this.ensureInk(page.id));
    return out;
  }

  // Changes

  /**
   * Makes one undoable change. Ink is replaced page by page; the manifest is copied the first time it is read.
   * A change that touches nothing leaves no step.
   */
  transact(label: string, work: (draft: Draft) => void): boolean {
    let manifestCopy: Manifest | undefined;
    const inkAfter = new Map<string, Stroke[]>();
    const self = this;
    const draft: Draft = {
      get manifest() {
        if (!manifestCopy) manifestCopy = structuredClone(self.manifest);
        return manifestCopy;
      },
      ink: (pageID) => inkAfter.get(pageID) ?? self.ink(pageID),
      setInk: (pageID, strokes) => void inkAfter.set(pageID, strokes),
    };
    work(draft);
    const step: Step = { label, inkBefore: new Map(), inkAfter: new Map() };
    for (const [pageID, strokes] of inkAfter) {
      const before = this.ink(pageID);
      if (before === strokes || (before.length === 0 && strokes.length === 0)) continue;
      step.inkBefore.set(pageID, before);
      step.inkAfter.set(pageID, strokes);
    }
    if (manifestCopy && JSON.stringify(manifestCopy) !== JSON.stringify(this.manifest)) {
      step.manifestBefore = this.manifest;
      step.manifestAfter = manifestCopy;
    }
    if (!step.manifestAfter && step.inkAfter.size === 0) return false;
    this.apply(step.manifestAfter, step.inkAfter);
    this.undoStack.push(step);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
    return true;
  }

  private apply(manifest: Manifest | undefined, inks: Map<string, Stroke[]>): void {
    if (manifest) {
      this.manifest = manifest;
      this.manifestDirty = true;
    }
    for (const [pageID, strokes] of inks) {
      this.inks.set(pageID, strokes);
      this.dirtyInk.add(pageID);
      this.inkVersions.set(pageID, this.inkVersion(pageID) + 1);
    }
    this.scheduleSave();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.apply(step.manifestBefore, step.inkBefore);
    this.redoStack.push(step);
    this.changed();
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    this.apply(step.manifestAfter, step.inkAfter);
    this.undoStack.push(step);
    this.changed();
    return true;
  }

  /** Changes that aren't undone: the page last open, a rename from the library. */
  touch(work: (manifest: Manifest) => void): void {
    const copy = structuredClone(this.manifest);
    work(copy);
    this.manifest = copy;
    this.manifestDirty = true;
    this.scheduleSave();
    this.changed();
  }

  // Ink

  addStrokes(pageID: string, strokes: Stroke[], label = "Write"): void {
    if (strokes.length === 0) return;
    this.transact(label, (draft) => draft.setInk(pageID, [...draft.ink(pageID), ...strokes]));
    this.onWrote?.(pageID, strokes.length);
  }

  removeStrokes(pageID: string, ids: Set<string>, label = "Erase"): void {
    if (ids.size === 0) return;
    this.transact(label, (draft) => draft.setInk(pageID, draft.ink(pageID).filter((stroke) => !ids.has(stroke.id))));
  }

  replaceInk(pageID: string, strokes: Stroke[], label: string): void {
    this.transact(label, (draft) => draft.setInk(pageID, strokes));
  }

  // Pages

  /** Adds a page after `afterID` (or at the end), like the page before it unless one is given. */
  addPage(afterID: string | null, page?: Page, label = "Add Page"): Page {
    const index = afterID ? this.pageIndex(afterID) : this.manifest.pages.length - 1;
    const model = this.manifest.pages[Math.max(index, 0)];
    const added = page ?? newPage(this.manifest.defaults, model && !model.edgeless
      ? { background: model.background.kind === "template" ? model.background : { kind: "template", template: this.manifest.defaults.template }, paperColor: model.paperColor, size: { ...model.size } }
      : {});
    this.transact(label, (draft) => void draft.manifest.pages.splice(index + 1, 0, added));
    return added;
  }

  insertPages(at: number, pages: Page[], inks: Map<string, Stroke[]> = new Map(), label = "Add Pages"): void {
    this.transact(label, (draft) => {
      draft.manifest.pages.splice(Math.min(Math.max(at, 0), draft.manifest.pages.length), 0, ...pages);
      for (const [pageID, strokes] of inks) draft.setInk(pageID, strokes);
    });
  }

  /** Deletes pages. A notebook always keeps one, so deleting the last leaves a fresh page. */
  async deletePages(ids: string[]): Promise<void> {
    const doomed = new Set(ids);
    // Their ink is loaded first, so undo can bring it back and the save removes the files.
    for (const id of doomed) await this.ensureInk(id);
    this.transact(doomed.size === 1 ? "Delete Page" : "Delete Pages", (draft) => {
      const manifest = draft.manifest;
      manifest.pages = manifest.pages.filter((page) => !doomed.has(page.id));
      if (manifest.pages.length === 0) manifest.pages.push(newPage(manifest.defaults, manifest.kind === "whiteboard" ? { edgeless: true } : {}));
      for (const id of doomed) draft.setInk(id, []);
    });
  }

  async duplicatePage(pageID: string): Promise<Page | null> {
    const source = this.page(pageID);
    if (!source) return null;
    const ink = await this.ensureInk(pageID);
    const copy = duplicatedPage(source);
    this.transact("Duplicate Page", (draft) => {
      draft.manifest.pages.splice(this.pageIndex(pageID) + 1, 0, copy);
      draft.setInk(copy.id, ink.map((stroke) => ({ ...stroke })));
    });
    return copy;
  }

  movePage(pageID: string, toIndex: number): void {
    this.transact("Move Page", (draft) => {
      const pages = draft.manifest.pages;
      const from = pages.findIndex((page) => page.id === pageID);
      if (from === -1) return;
      const [page] = pages.splice(from, 1);
      pages.splice(Math.min(Math.max(toIndex, 0), pages.length), 0, page);
    });
  }

  updatePage(pageID: string, label: string, work: (page: Page) => void): void {
    this.transact(label, (draft) => {
      const page = draft.manifest.pages.find((candidate) => candidate.id === pageID);
      if (page) work(page);
    });
  }

  // Items

  addItem(pageID: string, item: PageItem, label = "Add"): void {
    this.updatePage(pageID, label, (page) => void page.items.push(item));
  }

  updateItem(pageID: string, itemID: string, label: string, work: (item: PageItem) => void): void {
    this.updatePage(pageID, label, (page) => {
      const item = page.items.find((candidate) => candidate.id === itemID);
      if (item) work(item);
    });
  }

  removeItems(pageID: string, ids: Set<string>, label = "Delete"): void {
    this.updatePage(pageID, label, (page) => {
      page.items = page.items.filter((item) => !ids.has(item.id));
    });
  }

  // Saving

  get hasUnsavedChanges(): boolean {
    return this.manifestDirty || this.dirtyInk.size > 0;
  }

  private scheduleSave(): void {
    this.saveState = "unsaved";
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save().catch(() => {}), this.saveDelay);
  }

  /** Writes what has changed. Saves queue behind one another; a failed save keeps everything dirty for the next. */
  save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const run = this.saving.then(() => this.saveNow());
    this.saving = run.catch(() => {});
    return run;
  }

  private async saveNow(): Promise<void> {
    if (!this.hasUnsavedChanges) return;
    this.saveState = "saving";
    this.changed();
    const pages = [...this.dirtyInk];
    const manifestWasDirty = this.manifestDirty;
    this.dirtyInk.clear();
    this.manifestDirty = false;
    try {
      const hashes = new Map<string, string | undefined>();
      for (const pageID of pages) {
        const strokes = this.ink(pageID);
        await saveInk(this.fs, this.id, pageID, strokes);
        hashes.set(pageID, strokes.length ? fnv1a(encodeInk(strokes)).slice(0, 12) : undefined);
      }
      // The manifest goes last, so it never names ink that isn't on disk yet.
      const live = new Set(this.manifest.pages.map((page) => page.id));
      const needsHash = [...hashes].some(([pageID, hash]) => live.has(pageID) && this.page(pageID)?.inkHash !== hash);
      if (manifestWasDirty || needsHash || pages.length > 0) {
        const next: Manifest = {
          ...this.manifest,
          modifiedAt: Date.now(),
          pages: this.manifest.pages.map((page) => {
            if (!hashes.has(page.id)) return page;
            const hash = hashes.get(page.id);
            const { inkHash: _old, ...rest } = page;
            return hash ? { ...rest, inkHash: hash } : rest;
          }),
        };
        await saveManifest(this.fs, next);
        this.manifest = next;
        this.onSaved?.(next);
      }
      this.saveState = this.hasUnsavedChanges ? "unsaved" : "saved";
      this.saveError = null;
    } catch (error) {
      for (const pageID of pages) this.dirtyInk.add(pageID);
      this.manifestDirty = this.manifestDirty || manifestWasDirty;
      this.saveState = "failed";
      this.saveError = error instanceof Error ? error.message : String(error);
      this.changed();
      throw error;
    }
    this.changed();
  }

  /** The last save before the notebook closes. Rejects if it fails, so the editor can stay open. */
  async close(): Promise<void> {
    await this.save();
    if (this.hasUnsavedChanges) await this.save();
    try {
      await sweepAssets(this.fs, this.manifest, usedAssets(this.manifest));
    } catch {
      // Unused files cost only space.
    }
  }
}
