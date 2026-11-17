// The library's sidebar: the scopes, folders as a tree, smart shelves, tags and Recently Deleted.

import { CalendarDays, ChevronRight, Folder as FolderIcon, FolderPlus, Hash, Layers, Library as LibraryIcon, Pencil, Plus, Settings as SettingsIcon, Star, Sunrise, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ask, confirm, IconButton, Menu, MenuBreak, MenuRow, type MenuAnchor } from "../design/controls";
import {
  addFolder, moveFolder, moveNotebooks, notify, openCalendar, openSettings, openToday, removeFolder, removeShelf, renameFolder, setScope,
  useApp, type Scope,
} from "../state/app";
import { folderAndDescendants, shelfMatches, type SmartShelf } from "../storage/libraryFiles";
import { t } from "../i18n";
import { beginDrag, dragged, endDrag } from "./drag";
import { folderTree } from "./shelf";
import { ShelfSheet } from "./Sheets";

function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "folder" && b.kind === "folder") return a.id === b.id;
  if (a.kind === "shelf" && b.kind === "shelf") return a.id === b.id;
  if (a.kind === "tag" && b.kind === "tag") return a.tag === b.tag;
  return true;
}

type Accepts = { notebooks?: string | null; folders?: string | null };

export function Sidebar() {
  const manifests = useApp((state) => state.manifests);
  const folders = useApp((state) => state.folders);
  const shelves = useApp((state) => state.shelves);
  const scope = useApp((state) => state.scope);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drop, setDrop] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; folder?: string; shelf?: SmartShelf } | null>(null);
  const [shelfSheet, setShelfSheet] = useState<{ shelf?: SmartShelf } | null>(null);

  const live = useMemo(() => Object.values(manifests).filter((manifest) => manifest.trashedAt === null), [manifests]);
  const counts = useMemo(() => {
    const perFolder = new Map<string, number>();
    const perTag = new Map<string, number>();
    for (const manifest of live) {
      if (manifest.folder) perFolder.set(manifest.folder, (perFolder.get(manifest.folder) ?? 0) + 1);
      for (const tag of manifest.tags) perTag.set(tag, (perTag.get(tag) ?? 0) + 1);
    }
    return { perFolder, perTag, tags: [...perTag].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
  }, [live]);
  const trashCount = useMemo(() => Object.values(manifests).filter((manifest) => manifest.trashedAt !== null).length, [manifests]);
  const rows = useMemo(() => {
    const out: { folder: (typeof folders)[number]; depth: number; hasChildren: boolean }[] = [];
    let hiddenBelow: number | null = null;
    const tree = folderTree(folders);
    tree.forEach((row, index) => {
      if (hiddenBelow !== null && row.depth > hiddenBelow) return;
      hiddenBelow = collapsed.has(row.folder.id) ? row.depth : null;
      out.push({ ...row, hasChildren: (tree[index + 1]?.depth ?? 0) > row.depth });
    });
    return out;
  }, [folders, collapsed]);

  const close = () => setMenu(null);

  /** Drag and drop for a row: what it takes, and the dashed outline while something it takes is over it. */
  const target = (key: string, accepts: Accepts) => ({
    onDragOver: (event: React.DragEvent) => {
      const item = dragged();
      const fits = item && ((item.kind === "notebooks" && accepts.notebooks !== undefined) || (item.kind === "folder" && accepts.folders !== undefined && (accepts.folders === null || !folderAndDescendants(folders, item.id).has(accepts.folders))));
      if (!fits) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (drop !== key) setDrop(key);
    },
    onDragLeave: () => setDrop((now) => (now === key ? null : now)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const item = dragged();
      setDrop(null);
      endDrag();
      if (!item) return;
      if (item.kind === "notebooks" && accepts.notebooks !== undefined) void moveNotebooks(item.ids, accepts.notebooks);
      else if (item.kind === "folder" && accepts.folders !== undefined) {
        void moveFolder(item.id, accepts.folders).then((moved) => { if (!moved) notify(t("A folder can't go inside itself."), "trouble"); });
      }
    },
  });

  const row = (props: { id: string; scope: Scope; icon: ReactNode; label: string; count?: number; accepts?: Accepts; indent?: number; draggableFolder?: string; onContext?: (event: React.MouseEvent) => void; onClick?: () => void }) => (
    <button
      key={props.id}
      type="button"
      className={`sidebar-row${sameScope(scope, props.scope) && !props.onClick ? " on" : ""}${drop === props.id ? " drop" : ""}`}
      style={props.indent ? { paddingLeft: 8 + props.indent * 16 } : undefined}
      onClick={props.onClick ?? (() => setScope(props.scope))}
      onContextMenu={props.onContext}
      draggable={props.draggableFolder !== undefined}
      onDragStart={props.draggableFolder !== undefined ? (event) => beginDrag(event, { kind: "folder", id: props.draggableFolder! }) : undefined}
      onDragEnd={endDrag}
      aria-current={sameScope(scope, props.scope) && !props.onClick ? "page" : undefined}
      data-testid={props.id}
      {...(props.accepts ? target(props.id, props.accepts) : {})}
    >
      {props.icon}
      <span className="truncate">{props.label}</span>
      {props.count !== undefined && props.count > 0 && <span className="count">{props.count}</span>}
    </button>
  );

  const newFolder = async (parent: string | null) => {
    const name = await ask({ title: parent ? t("New Subfolder") : t("New Folder"), confirm: t("Create"), placeholder: t("Folder name") });
    if (name === null) return;
    const made = await addFolder(name, parent);
    if (parent) setCollapsed((now) => { const next = new Set(now); next.delete(parent); return next; });
    setScope({ kind: "folder", id: made.id });
  };

  const folderMenu = menu?.folder ? folders.find((folder) => folder.id === menu.folder) : undefined;

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-head"><h2 className="display" style={{ fontSize: 22 }}>OwlLuna</h2></div>
      <nav className="sidebar-scroll" aria-label={t("Library")}>
        {row({ id: "scope-all", scope: { kind: "all" }, icon: <LibraryIcon />, label: t("All Notebooks"), count: live.length, accepts: { notebooks: null } })}
        {row({ id: "scope-favourites", scope: { kind: "favourites" }, icon: <Star />, label: t("Favourites"), count: live.filter((manifest) => manifest.favourite).length })}
        {row({ id: "scope-today", scope: { kind: "all" }, icon: <Sunrise />, label: t("Today"), onClick: () => void openToday() })}

        <div className={`sidebar-section${drop === "folders-head" ? " drop" : ""}`} {...target("folders-head", { folders: null })}>
          <span className="meta">{t("Folders")}</span>
          <IconButton label={t("New Folder")} onClick={() => void newFolder(null)} testid="folder-add"><Plus /></IconButton>
        </div>
        {rows.length === 0 && <p className="sidebar-note">{t("Folders you add show up here. Drag one onto another to nest it.")}</p>}
        {rows.map(({ folder, depth, hasChildren }) => (
          <div key={folder.id} className="sidebar-line" style={{ paddingLeft: depth * 16 }}>
            <button
              type="button"
              className={`disclosure${hasChildren ? "" : " spacer"}`}
              aria-expanded={hasChildren ? !collapsed.has(folder.id) : undefined}
              aria-label={collapsed.has(folder.id) ? t("Expand {name}", { name: folder.name }) : t("Collapse {name}", { name: folder.name })}
              tabIndex={hasChildren ? 0 : -1}
              onClick={() => setCollapsed((now) => { const next = new Set(now); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}
              data-testid="folder-disclosure"
            >
              <ChevronRight />
            </button>
            {row({ id: `folder-${folder.id}`, scope: { kind: "folder", id: folder.id }, icon: <FolderIcon />, label: folder.name, count: counts.perFolder.get(folder.id), accepts: { notebooks: folder.id, folders: folder.id }, draggableFolder: folder.id, onContext: (event) => { event.preventDefault(); setMenu({ anchor: { x: event.clientX, y: event.clientY }, folder: folder.id }); } })}
          </div>
        ))}

        <div className="sidebar-section">
          <span className="meta">{t("Smart Shelves")}</span>
          <IconButton label={t("New Smart Shelf")} onClick={() => setShelfSheet({})} testid="shelf-add"><Plus /></IconButton>
        </div>
        {shelves.length === 0 && <p className="sidebar-note">{t("A shelf collects notebooks by their tags.")}</p>}
        {shelves.map((shelf) =>
          row({ id: `shelf-${shelf.id}`, scope: { kind: "shelf", id: shelf.id }, icon: <Layers />, label: shelf.name, count: live.filter((manifest) => shelfMatches(shelf, manifest.tags)).length, onContext: (event) => { event.preventDefault(); setMenu({ anchor: { x: event.clientX, y: event.clientY }, shelf }); } }),
        )}

        {counts.tags.length > 0 && (
          <>
            <div className="sidebar-section"><span className="meta">{t("Tags")}</span></div>
            {counts.tags.map(([tag, count]) => row({ id: `tag-${tag}`, scope: { kind: "tag", tag }, icon: <Hash />, label: tag, count })) }
          </>
        )}

        <div className="sidebar-section" />
        {row({ id: "scope-trash", scope: { kind: "trash" }, icon: <Trash2 />, label: t("Recently Deleted"), count: trashCount })}
      </nav>
      <div className="sidebar-foot">
        <button type="button" className="btn flat" onClick={() => openCalendar(true)} data-testid="open-calendar"><CalendarDays /> {t("Calendar")}</button>
        <button type="button" className="btn flat" onClick={() => openSettings(true)} data-testid="open-settings"><SettingsIcon /> {t("Settings")}</button>
      </div>

      {menu?.folder && folderMenu && (
        <Menu anchor={menu.anchor} title={folderMenu.name} onClose={close} testid="folder-menu">
          <MenuRow icon={<FolderPlus />} onClick={() => { close(); void newFolder(folderMenu.id); }} testid="folder-new-sub">{t("New Subfolder…")}</MenuRow>
          <MenuRow
            icon={<Pencil />}
            onClick={async () => {
              close();
              const name = await ask({ title: t("Rename Folder"), confirm: t("Rename"), value: folderMenu.name });
              if (name !== null) await renameFolder(folderMenu.id, name);
            }}
            testid="folder-rename"
          >
            {t("Rename…")}
          </MenuRow>
          {folderMenu.parent !== null && <MenuRow icon={<FolderIcon />} onClick={() => { close(); void moveFolder(folderMenu.id, null); }} testid="folder-unnest">{t("Move to Top Level")}</MenuRow>}
          <MenuBreak />
          <MenuRow
            icon={<Trash2 />}
            destructive
            onClick={async () => {
              close();
              const sure = await confirm({
                title: t("Delete the folder “{name}”?", { name: folderMenu.name }),
                message: t("Folders inside it go too. The notebooks in them are kept and move up a level."),
                confirm: t("Delete Folder"),
                destructive: true,
              });
              if (sure) await removeFolder(folderMenu.id);
            }}
            testid="folder-delete"
          >
            {t("Delete…")}
          </MenuRow>
        </Menu>
      )}

      {menu?.shelf && (
        <Menu anchor={menu.anchor} title={menu.shelf.name} onClose={close} testid="shelf-menu">
          <MenuRow icon={<Pencil />} onClick={() => { const shelf = menu.shelf; close(); setShelfSheet({ shelf }); }} testid="shelf-edit">{t("Edit…")}</MenuRow>
          <MenuRow
            icon={<Trash2 />}
            destructive
            onClick={async () => {
              const shelf = menu.shelf!;
              close();
              const sure = await confirm({ title: t("Delete the shelf “{name}”?", { name: shelf.name }), message: t("Its notebooks stay where they are; only the shelf goes."), confirm: t("Delete Shelf"), destructive: true });
              if (sure) await removeShelf(shelf.id);
            }}
            testid="shelf-delete"
          >
            {t("Delete…")}
          </MenuRow>
        </Menu>
      )}

      {shelfSheet && <ShelfSheet shelf={shelfSheet.shelf} onClose={() => setShelfSheet(null)} />}
    </aside>
  );
}

