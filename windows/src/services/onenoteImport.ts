// Importing from OneNote: the orchestration. The Rust side reads OneNote (read-only); `onenote.ts` decides what
// things become; this walks the chosen sections one at a time and writes them with the storage layer.
//
// Safety: a section's pages and files are written first and its manifest last, so a section is never half
// registered. Cancelling stops after the current page and saves what was done. Importing again never duplicates:
// a section is found by its OneNote ID and updated in place (see `decideReimport`).

import { openPdf } from "../canvas/backdrops";
import { t } from "../i18n";
import { uuid } from "../model/ids";
import { newManifest, newPage, type Manifest, type Page, type TextItem } from "../model/notebook";
import { invoke } from "../platform/host";
import type { FS } from "../platform/fs";
import { addAsset, loadInk, loadWords, saveInk, saveManifest, saveWords } from "../storage/package";
import {
  bytesFromBase64, convertPage, decideReimport, needsPdfCopy, nearestCloth, pageHash, splitTall,
  type ConvertedPage, type ONGroup, type ONNotebook, type ONPageContent, type ONPageRef, type ONSection, type PageOrigin,
} from "./onenote";
import { importPdf, pdfPages } from "./pdfImport";
import { wordsKey } from "./words";

export interface ImportOptions {
  mode: "editable" | "exact";
  /** Publish pages that did not convert fully to PDF and add the PDF after the converted page. */
  keepPdfCopies: boolean;
  includeDeleted: boolean;
}

export interface SectionJob {
  notebookID: string;
  notebook: string;
  /** The notebook's section group names, outermost first. */
  groups: string[];
  section: ONSection;
}

/** What the importer needs from OneNote. The app's is `tauriApi`; tests give fixtures. */
export interface OneNoteApi {
  page(id: string): Promise<ONPageContent>;
  publishPdf(id: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  cleanup(): Promise<void>;
}

export interface ImportEnv {
  fs: FS;
  api: OneNoteApi;
  findExisting(sectionID: string): Manifest | null;
  /** A notebook open in an editor tab is not written behind its back. */
  isOpen(id: string): boolean;
  ensureFolder(path: string[]): Promise<string | null>;
  pdfSizes(data: Uint8Array): Promise<{ w: number; h: number }[]>;
  /** Told of each manifest written, so the shelf can show it. */
  written?(manifest: Manifest): void;
}

export interface ImportProgress {
  fraction: number;
  notebook: string;
  section: string;
  page: string;
  sectionIndex: number;
  sectionCount: number;
  pageIndex: number;
  pageCount: number;
}

export interface ImportSummary {
  notebooks: number;
  sections: number;
  pagesImported: number;
  pagesUpdated: number;
  /** Pages the user had changed too: OneNote's version was added beside them. */
  pagesKeptBoth: number;
  pagesUnchanged: number;
  pdfCopies: number;
  skipped: { name: string; reason: string }[];
  warnings: { where: string; message: string }[];
  cancelled: boolean;
}

export function emptySummary(): ImportSummary {
  return { notebooks: 0, sections: 0, pagesImported: 0, pagesUpdated: 0, pagesKeptBoth: 0, pagesUnchanged: 0, pdfCopies: 0, skipped: [], warnings: [], cancelled: false };
}

// ---- Choosing -------------------------------------------------------------------------------------------------------

function wantedPages(section: ONSection, includeDeleted: boolean): ONPageRef[] {
  return section.pages.filter((page) => includeDeleted || !page.isInRecycleBin);
}

/** Whether a section can be imported at all, and if not, why. */
export function sectionProblem(section: ONSection, includeDeleted: boolean): string | null {
  if (section.locked || section.encrypted) return t("Password protected: unlock it in OneNote first.");
  if (!includeDeleted && (section.isInRecycleBin || section.isDeletedPages)) return t("Deleted pages");
  return null;
}

function walkGroup(group: ONGroup, notebook: ONNotebook, path: string[], includeDeleted: boolean, out: SectionJob[]): void {
  if (group.isRecycleBin && !includeDeleted) return;
  const here = [...path, group.name];
  for (const section of group.sections) out.push({ notebookID: notebook.id, notebook: notebook.name, groups: here, section });
  for (const inner of group.groups) walkGroup(inner, notebook, here, includeDeleted, out);
}

/** Every section of the notebooks, in OneNote's order, with the section groups it sits in. */
export function allSections(notebooks: ONNotebook[], includeDeleted: boolean): SectionJob[] {
  const out: SectionJob[] = [];
  for (const notebook of notebooks) {
    for (const section of notebook.sections) out.push({ notebookID: notebook.id, notebook: notebook.name, groups: [], section });
    for (const group of notebook.groups) walkGroup(group, notebook, [], includeDeleted, out);
  }
  return out;
}

// ---- Real implementations -------------------------------------------------------------------------------------------

export const tauriApi: OneNoteApi = {
  page: (id) => invoke<ONPageContent>("onenote_page", { pageId: id }),
  publishPdf: (id) => invoke<string>("onenote_publish_pdf", { id }),
  readFile: async (path) => new Uint8Array(await invoke<ArrayBuffer>("read_external", { path })),
  cleanup: async () => { await invoke("onenote_cleanup"); },
};

export async function pdfSizesOf(data: Uint8Array): Promise<{ w: number; h: number }[]> {
  const pdf = await openPdf(data);
  try {
    const sizes: { w: number; h: number }[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const view = (await pdf.getPage(index)).getViewport({ scale: 1 });
      sizes.push({ w: view.width, h: view.height });
    }
    return sizes;
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}

// ---- Pages ----------------------------------------------------------------------------------------------------------

type WithOrigin = Page & { oneNote?: PageOrigin };

const originOf = (page: Page): PageOrigin | undefined => (page as WithOrigin).oneNote;

function textNote(string: string, width: number): TextItem {
  const h = 10 * 1.35 + 4;
  return { id: uuid(), kind: "text", x: 36 + width / 2, y: 12 + h / 2, w: width, h, rotation: 0, string, fontSize: 10, italic: true };
}

/** Writes a converted page's pictures and ink; returns the page. Nothing is registered until the manifest is saved. */
async function writePage(env: ImportEnv, manifestID: string, converted: ConvertedPage, origin: Omit<PageOrigin, "importedHash">, id?: string): Promise<Page> {
  for (const asset of converted.assets) {
    asset.item.file = await addAsset(env.fs, manifestID, bytesFromBase64(asset.data), asset.ext);
  }
  const page = newPage({ template: converted.template, paperColor: converted.paperColor, pageSize: "letter" }, {
    ...(id ? { id } : {}),
    size: converted.size,
    items: converted.items,
  });
  await saveInk(env.fs, manifestID, page.id, converted.strokes);
  (page as WithOrigin).oneNote = { ...origin, importedHash: pageHash(page.items, converted.strokes) };
  return page;
}

/** The PDF of a OneNote page, as pages that follow the converted one. */
async function pdfCopy(env: ImportEnv, manifestID: string, ref: ONPageRef): Promise<Page[]> {
  const path = await env.api.publishPdf(ref.id);
  const data = await env.api.readFile(path);
  const sizes = await env.pdfSizes(data);
  const file = await addAsset(env.fs, manifestID, data, "pdf");
  const pages = pdfPages(file, sizes);
  pages.forEach((page, index) => {
    (page as WithOrigin).oneNote = { pageID: ref.id, lastModified: ref.lastModified, importedHash: "", pdfCopy: true };
    if (index === 0) page.items.push(textNote(t("As shown in OneNote"), 160));
  });
  return pages;
}

export interface SectionResult {
  manifest: Manifest | null;
  imported: number;
  updated: number;
  keptBoth: number;
  unchanged: number;
  pdfCopies: number;
  warnings: { where: string; message: string }[];
  skipped?: string;
  cancelled: boolean;
}

export interface Signal { cancelled: boolean }

function blankResult(): SectionResult {
  return { manifest: null, imported: 0, updated: 0, keptBoth: 0, unchanged: 0, pdfCopies: 0, warnings: [], cancelled: false };
}

type Report = (page: string, pageIndex: number) => void;

async function importEditable(env: ImportEnv, job: SectionJob, options: ImportOptions, report: Report, signal: Signal): Promise<SectionResult> {
  const result = blankResult();
  const { section } = job;
  const existing = env.findExisting(section.id);
  if (existing && env.isOpen(existing.id)) {
    result.skipped = t("Open in a tab. Close it and import again.");
    return result;
  }
  const folder = await env.ensureFolder([job.notebook, ...job.groups]);
  const manifest: Manifest = existing
    ? structuredClone(existing)
    : newManifest({ title: section.name || t("Untitled"), cover: { style: "cloth", cloth: nearestCloth(section.color) }, folder, tags: [job.notebook], pages: [] });
  (manifest as unknown as Record<string, unknown>).oneNote = {
    notebookID: job.notebookID, sectionID: section.id, notebookName: job.notebook, sectionPath: [...job.groups, section.name].join(" › "),
  };
  const words = await loadWords(env.fs, manifest.id);
  const refs = wantedPages(section, options.includeDeleted);
  let cursor = 0;

  const fold = (found: number): number => {
    // Past the page and the copies and PDF pages that belong to it.
    let at = found + 1;
    const id = originOf(manifest.pages[found])?.pageID;
    while (at < manifest.pages.length) {
      const origin = originOf(manifest.pages[at]);
      if (origin && origin.pageID === id && (origin.copy || origin.pdfCopy || origin.part)) at++;
      else break;
    }
    return at;
  };

  for (const [index, ref] of refs.entries()) {
    report(ref.name, index);
    if (signal.cancelled) {
      result.cancelled = true;
      break;
    }
    const where = `${job.notebook} › ${section.name} › ${ref.name || t("Untitled")}`;
    try {
      const found = manifest.pages.findIndex((page) => {
        const origin = originOf(page);
        return origin?.pageID === ref.id && !origin.copy && !origin.pdfCopy;
      });
      let decision = decideReimport(null, ref.lastModified);
      if (found !== -1) {
        const origin = originOf(manifest.pages[found])!;
        // The hash is only worked out when OneNote's copy changed: it needs the page's ink.
        let currentHash = origin.importedHash;
        if (origin.lastModified !== ref.lastModified) {
          currentHash = pageHash(manifest.pages[found].items, await loadInk(env.fs, manifest.id, manifest.pages[found].id));
        }
        decision = decideReimport({ origin, currentHash }, ref.lastModified);
      }
      if (decision === "unchanged") {
        result.unchanged++;
        cursor = fold(found);
        continue;
      }
      let converted: ConvertedPage | null = null;
      let failure: string | null = null;
      try {
        converted = convertPage(await env.api.page(ref.id), decision === "keepBoth" ? { titleSuffix: ` ${t("(updated in OneNote)")}` } : {});
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        result.warnings.push({ where, message: failure });
      }
      const origin = { pageID: ref.id, lastModified: ref.lastModified };
      const fresh: Page[] = [];
      if (converted) {
        for (const warning of converted.warnings) result.warnings.push({ where, message: warning });
        for (const item of converted.unsupported) result.warnings.push({ where, message: t("Not converted: {kind}", { kind: item.name ? `${item.kind} (${item.name})` : item.kind }) });
        const keepId = decision === "replace" ? manifest.pages[found].id : undefined;
        for (const [n, part] of splitTall(converted).entries()) {
          const mark = n === 0 ? origin : { ...origin, part: n + 1 };
          const page = await writePage(env, manifest.id, part, decision === "keepBoth" ? { ...mark, copy: true } : mark, n === 0 ? keepId : undefined);
          fresh.push(page);
          if (part.words) words.pages[page.id] = { key: wordsKey(page), text: part.words, scan: part.words };
        }
      }
      // A page that could not be read now keeps what it had.
      if (!converted && found !== -1) continue;
      if (failure !== null || needsPdfCopy(converted!, options.keepPdfCopies)) {
        if (options.keepPdfCopies) {
          try {
            const copies = await pdfCopy(env, manifest.id, ref);
            // A copy is a page of its own after the converted one; where the page failed it stands in for it.
            fresh.push(...copies);
            result.pdfCopies += copies.length;
          } catch (error) {
            result.warnings.push({ where, message: t("No PDF copy: {reason}", { reason: error instanceof Error ? error.message : String(error) }) });
          }
        }
      }
      if (fresh.length === 0) continue;
      if (decision === "replace") {
        const old = manifest.pages[found];
        const [first, ...rest] = fresh;
        const next: Page = { ...old, ...first, id: old.id, ...(old.bookmark ? { bookmark: true } : {}) };
        (next as WithOrigin).oneNote = originOf(first);
        // The PDF copies and parts made before go, unless the user wrote on them.
        const stale: number[] = [];
        for (let at = found + 1; at < manifest.pages.length; at++) {
          const o = originOf(manifest.pages[at]);
          if (o && o.pageID === ref.id && (o.pdfCopy || o.part) && (await loadInk(env.fs, manifest.id, manifest.pages[at].id)).length === 0) stale.push(at);
          else if (!(o && o.pageID === ref.id && (o.copy || o.pdfCopy || o.part))) break;
        }
        manifest.pages[found] = next;
        for (const at of stale.reverse()) manifest.pages.splice(at, 1);
        manifest.pages.splice(found + 1, 0, ...rest);
        result.updated++;
        cursor = fold(found);
      } else if (decision === "keepBoth") {
        // The user's page stays; it now matches OneNote's time so the next import doesn't add another copy.
        const kept = manifest.pages[found];
        (kept as WithOrigin).oneNote = { ...originOf(kept)!, lastModified: ref.lastModified };
        const at = fold(found);
        manifest.pages.splice(at, 0, ...fresh);
        result.keptBoth++;
        cursor = at + fresh.length;
      } else {
        manifest.pages.splice(cursor, 0, ...fresh);
        cursor += fresh.length;
        result.imported++;
      }
    } catch (error) {
      result.warnings.push({ where, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (manifest.pages.length === 0) manifest.pages.push(newPage(manifest.defaults));
  manifest.modifiedAt = Date.now();
  const known = new Set(manifest.pages.map((page) => page.id));
  for (const id of Object.keys(words.pages)) if (!known.has(id)) delete words.pages[id];
  await saveWords(env.fs, manifest.id, words);
  // The manifest goes last: until it is there the section is not in the library.
  await saveManifest(env.fs, manifest);
  env.written?.(manifest);
  result.manifest = manifest;
  return result;
}

/** "Exact copy": the section as OneNote prints it, one PDF. Not updated on a second import. */
async function importExact(env: ImportEnv, job: SectionJob, report: Report): Promise<SectionResult> {
  const result = blankResult();
  const { section } = job;
  if (env.findExisting(section.id)) {
    result.skipped = t("Already imported. Exact copies are not updated.");
    return result;
  }
  report(section.name, 0);
  const path = await env.api.publishPdf(section.id);
  const data = await env.api.readFile(path);
  const manifest = await importPdf(env.fs, data, `${section.name || "Section"}.pdf`);
  manifest.title = section.name || manifest.title;
  manifest.cover = { ...manifest.cover, style: "cloth", cloth: nearestCloth(section.color) };
  manifest.tags = [job.notebook];
  manifest.folder = await env.ensureFolder([job.notebook, ...job.groups]);
  (manifest as unknown as Record<string, unknown>).oneNote = {
    notebookID: job.notebookID, sectionID: section.id, notebookName: job.notebook, sectionPath: [...job.groups, section.name].join(" › "), exact: true,
  };
  await saveManifest(env.fs, manifest);
  env.written?.(manifest);
  result.manifest = manifest;
  result.imported = manifest.pages.length;
  return result;
}

/** Imports the sections one after another. Never throws for one section's trouble: it is reported and the rest go on. */
export async function importSections(
  env: ImportEnv, jobs: SectionJob[], options: ImportOptions, onProgress: (progress: ImportProgress) => void = () => {}, signal: Signal = { cancelled: false },
): Promise<ImportSummary> {
  const summary = emptySummary();
  const total = Math.max(jobs.reduce((sum, job) => sum + Math.max(wantedPages(job.section, options.includeDeleted).length, 1), 0), 1);
  let done = 0;
  const notebooks = new Set<string>();
  try {
    for (const [sectionIndex, job] of jobs.entries()) {
      if (signal.cancelled) {
        summary.cancelled = true;
        break;
      }
      const name = `${job.notebook} › ${[...job.groups, job.section.name].join(" › ")}`;
      const problem = sectionProblem(job.section, options.includeDeleted);
      const pageCount = Math.max(wantedPages(job.section, options.includeDeleted).length, 1);
      if (problem) {
        summary.skipped.push({ name, reason: problem });
        done += pageCount;
        continue;
      }
      const report: Report = (page, pageIndex) => onProgress({
        fraction: Math.min((done + pageIndex) / total, 1), notebook: job.notebook, section: job.section.name, page,
        sectionIndex, sectionCount: jobs.length, pageIndex, pageCount,
      });
      report("", 0);
      try {
        const result = options.mode === "exact" ? await importExact(env, job, report) : await importEditable(env, job, options, report, signal);
        if (result.skipped) summary.skipped.push({ name, reason: result.skipped });
        if (result.manifest) {
          summary.sections++;
          notebooks.add(job.notebookID);
        }
        summary.pagesImported += result.imported;
        summary.pagesUpdated += result.updated;
        summary.pagesKeptBoth += result.keptBoth;
        summary.pagesUnchanged += result.unchanged;
        summary.pdfCopies += result.pdfCopies;
        summary.warnings.push(...result.warnings);
        if (result.cancelled) {
          summary.cancelled = true;
          break;
        }
      } catch (error) {
        summary.skipped.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
      done += pageCount;
      onProgress({ fraction: Math.min(done / total, 1), notebook: job.notebook, section: job.section.name, page: "", sectionIndex, sectionCount: jobs.length, pageIndex: pageCount, pageCount });
    }
  } finally {
    await env.api.cleanup().catch(() => {});
  }
  summary.notebooks = notebooks.size;
  return summary;
}
