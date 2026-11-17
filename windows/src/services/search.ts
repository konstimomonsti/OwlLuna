// Search across the library: titles, tags, typed text, link labels, picture text and the recognised words of
// every notebook that is neither in the trash nor locked. The index is built on the first search and kept.

import MiniSearch from "minisearch";
import { textLines } from "../canvas/textLayout";
import type { Manifest, Page } from "../model/notebook";
import type { FS } from "../platform/fs";
import { loadWords, type PageWords } from "../storage/package";

/** Lower case and without accents, one character out for each in, so a position in one is a position in the other. */
export function normalise(text: string): string {
  let out = "";
  for (const char of text) {
    if (char.length !== 1) {
      out += char;
      continue;
    }
    const plain = char.normalize("NFD")[0].toLowerCase();
    out += plain.length === 1 ? plain : char;
  }
  return out;
}

const wordPattern = /[\p{L}\p{N}]+/gu;

/** The words of a query, normalised. */
export function queryTerms(query: string): string[] {
  return normalise(query).match(wordPattern) ?? [];
}

export interface IndexDoc {
  id: string;
  notebook: string;
  /** The page's ID; empty on a notebook's own entry. */
  page: string;
  pageNumber: number;
  kind: "notebook" | "page";
  title: string;
  tags: string;
}

/** Everything on a page that can be read as words. */
export function pageText(page: Page, words?: { text: string }): string {
  const parts: string[] = [];
  for (const item of page.items) {
    if (item.kind === "text") parts.push(textLines(item).map((line) => line.text).join(" "));
    else if (item.kind === "link") parts.push(item.label);
    else if (item.kind === "image" && item.text) parts.push(item.text);
  }
  for (const mark of page.marks ?? []) parts.push(mark.text);
  if (page.notes) parts.push(page.notes);
  if (words?.text) parts.push(words.text);
  return parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
}

/** The index entries of a notebook, with each page's text; pages with no words get none. */
export function documentsOf(manifest: Manifest, words: PageWords | null): { docs: IndexDoc[]; texts: Map<string, string> } {
  const docs: IndexDoc[] = [{
    id: `n:${manifest.id}`, notebook: manifest.id, page: "", pageNumber: 0, kind: "notebook", title: manifest.title, tags: manifest.tags.join(" "),
  }];
  const texts = new Map<string, string>();
  manifest.pages.forEach((page, index) => {
    const text = pageText(page, words?.pages[page.id]);
    if (!text) return;
    const id = `p:${manifest.id}:${page.id}`;
    docs.push({ id, notebook: manifest.id, page: page.id, pageNumber: index + 1, kind: "page", title: "", tags: "" });
    texts.set(id, text);
  });
  return { docs, texts };
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** A short run of `text` around the first place a term shows up, with that word split out so it can be marked. */
export function makeSnippet(text: string, terms: string[], radius = 44): Snippet {
  const flat = text.replace(/\s+/g, " ").trim();
  const plain = normalise(flat);
  let at = -1, length = 0;
  for (const term of terms) {
    const found = plain.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) {
      at = found;
      length = term.length;
    }
  }
  if (at === -1) return { before: "", match: "", after: flat.length > radius * 2 ? flat.slice(0, radius * 2).trimEnd() + "…" : flat };
  // A prefix match marks the whole word.
  let end = at + length;
  while (end < flat.length && /[\p{L}\p{N}]/u.test(flat[end])) end++;
  let start = Math.max(0, at - radius);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  let stop = Math.min(flat.length, end + radius);
  if (stop < flat.length) {
    const space = flat.lastIndexOf(" ", stop);
    if (space > end) stop = space;
  }
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, at),
    match: flat.slice(at, end),
    after: flat.slice(end, stop) + (stop < flat.length ? "…" : ""),
  };
}

export interface NotebookHit {
  id: string;
  title: string;
}

export interface PageHit {
  notebook: string;
  title: string;
  page: string;
  pageNumber: number;
  snippet: Snippet;
}

export interface SearchResults {
  notebooks: NotebookHit[];
  pages: PageHit[];
}

export const emptyResults: SearchResults = { notebooks: [], pages: [] };

/** Notebooks that may be searched: not in the trash, not locked. */
export function searchable(manifest: Manifest): boolean {
  return manifest.trashedAt === null && !manifest.locked;
}

export class LibrarySearch {
  private index = this.fresh();
  private texts = new Map<string, string>();
  private titles = new Map<string, string>();
  private known = new Map<string, { modifiedAt: number; ids: string[] }>();
  private fs: FS | null = null;

  private fresh() {
    return new MiniSearch<IndexDoc>({
      fields: ["title", "tags", "text"],
      storeFields: ["notebook", "page", "pageNumber", "kind"],
      extractField: (doc, field) => (field === "text" ? this.texts.get(doc.id) ?? "" : (doc as unknown as Record<string, string>)[field]),
      processTerm: (term) => normalise(term),
    });
  }

  private forget(id: string): void {
    const entry = this.known.get(id);
    if (!entry) return;
    for (const doc of entry.ids) {
      this.index.discard(doc);
      this.texts.delete(doc);
    }
    this.known.delete(id);
    this.titles.delete(id);
  }

  /** Brings the index up to date with the notebooks: new ones added, changed ones read again, gone and locked ones dropped. */
  async refresh(fs: FS, manifests: Record<string, Manifest>): Promise<void> {
    if (this.fs !== fs) {
      this.index = this.fresh();
      this.texts.clear();
      this.titles.clear();
      this.known.clear();
      this.fs = fs;
    }
    for (const id of [...this.known.keys()]) if (!manifests[id] || !searchable(manifests[id])) this.forget(id);
    const stale = Object.values(manifests).filter((manifest) => searchable(manifest) && this.known.get(manifest.id)?.modifiedAt !== manifest.modifiedAt);
    for (let from = 0; from < stale.length; from += 8) {
      const group = stale.slice(from, from + 8);
      const words = await Promise.all(group.map((manifest) => loadWords(fs, manifest.id).catch(() => null)));
      group.forEach((manifest, index) => {
        this.forget(manifest.id);
        const { docs, texts } = documentsOf(manifest, words[index]);
        for (const [id, text] of texts) this.texts.set(id, text);
        this.index.addAll(docs);
        this.titles.set(manifest.id, manifest.title);
        this.known.set(manifest.id, { modifiedAt: manifest.modifiedAt, ids: docs.map((doc) => doc.id) });
      });
    }
  }

  search(query: string, limit = 80): SearchResults {
    const terms = queryTerms(query);
    if (terms.length === 0) return emptyResults;
    const found = this.index.search(terms.join(" "), { prefix: true, fuzzy: 0.2, combineWith: "AND" });
    const notebooks: NotebookHit[] = [];
    const pages: PageHit[] = [];
    for (const hit of found) {
      const title = this.titles.get(hit.notebook) ?? "";
      if (hit.kind === "notebook") notebooks.push({ id: hit.notebook, title });
      else if (pages.length < limit) {
        pages.push({ notebook: hit.notebook, title, page: hit.page, pageNumber: hit.pageNumber, snippet: makeSnippet(this.texts.get(hit.id) ?? "", terms) });
      }
    }
    return { notebooks, pages };
  }
}

export const librarySearch = new LibrarySearch();
