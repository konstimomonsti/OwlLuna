// What the shelf shows for a scope, in what order. Pure, so the rules are testable apart from the screen.

import { locale, t, tn } from "../i18n";
import type { Manifest } from "../model/notebook";
import { shelfMatches, type Folder, type Settings, type SmartShelf } from "../storage/libraryFiles";
import type { Scope } from "../state/app";

export type SortKey = Settings["librarySort"];

export const sortNames: Record<SortKey, string> = { modified: tn("Date Modified"), created: tn("Date Created"), title: tn("Title") };

export function inScope(manifest: Manifest, scope: Scope, shelves: SmartShelf[]): boolean {
  if (scope.kind === "trash") return manifest.trashedAt !== null;
  if (manifest.trashedAt !== null) return false;
  switch (scope.kind) {
    case "all": return true;
    case "favourites": return manifest.favourite;
    case "folder": return manifest.folder === scope.id;
    case "tag": return manifest.tags.some((tag) => tag.toLowerCase() === scope.tag.toLowerCase());
    case "shelf": {
      const shelf = shelves.find((candidate) => candidate.id === scope.id);
      return shelf ? shelfMatches(shelf, manifest.tags) : false;
    }
  }
}

export function sortNotebooks(list: Manifest[], key: SortKey): Manifest[] {
  const out = [...list];
  if (key === "title") out.sort((a, b) => a.title.localeCompare(b.title, locale(), { sensitivity: "base", numeric: true }));
  else if (key === "created") out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}

export function scopeTitle(scope: Scope, folders: Folder[], shelves: SmartShelf[]): string {
  switch (scope.kind) {
    case "all": return t("All Notebooks");
    case "favourites": return t("Favourites");
    case "trash": return t("Recently Deleted");
    case "tag": return `#${scope.tag}`;
    case "folder": return folders.find((folder) => folder.id === scope.id)?.name ?? t("Folder");
    case "shelf": return shelves.find((shelf) => shelf.id === scope.id)?.name ?? t("Smart Shelf");
  }
}

/** Whole days left before a deleted notebook is removed, never less than zero. */
export function daysLeft(trashedAt: number, trashDays: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((trashedAt + trashDays * 86_400_000 - now) / 86_400_000));
}

/** Folders in tree order, each with its depth, for menus and the sidebar. Children sort by name. */
export function folderTree(folders: Folder[]): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const children = (parent: string | null) => folders.filter((folder) => folder.parent === parent).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const folder of children(parent)) {
      if (seen.has(folder.id)) continue;
      out.push({ folder, depth });
      walk(folder.id, depth + 1, new Set([...seen, folder.id]));
    }
  };
  walk(null, 0, new Set());
  return out;
}
