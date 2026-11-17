// The library: a shelf of notebooks with a sidebar, search, sorting, a list layout and selection.

import {
  BookOpen, Check, Copy, Ellipsis, FileDown, FileInput, FilePlus2, ImagePlus, Flag, FlagOff, Folder as FolderIcon, FolderInput, LayoutGrid, List, Lock, LockOpen, NotebookPen, PanelLeft, Palette,
  Pencil, PenLine, Plus, Presentation, Star, SquareCheck, Sunrise, Tags, Trash2, Undo2, ArrowUpDown, SquareArrowOutUpRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { anchorBelow, ask, confirm, EmptyPlate, IconButton, Menu, MenuBreak, MenuRow, SearchField, Segmented, Sheet, type MenuAnchor } from "../design/controls";
import { OneNoteImport } from "./OneNoteImport";
import "../design/library.css";
import { t, tp } from "../i18n";
import { familyName, pageSizeName, paperColorName, swatchName, templateName } from "../i18n/names";
import { shortDate } from "../model/days";
import { clothColors, clothHex, risoPairs, type ClothColor, type CoverStyle, type Manifest } from "../model/notebook";
import {
  familyTemplates, paperColors, paperCSS, paperFamilies, pageSizes,
  type PageSize, type PaperColor, type PaperTemplate,
} from "../model/paper";
import { safeFileName, saveFile } from "../platform/host";
import { lockNotebook, unlockNotebook } from "../services/lock";
import { BACKUP_SUFFIX, makeBackup } from "../services/backup";
import { librarySearch, type SearchResults as Results } from "../services/search";
import {
  changeNotebook, createNotebook, deleteForever, documentIfOpen, duplicateNotebook, emptyTrash, moveNotebooks, notify, openNotebook, openToday, quickNote,
  renameNotebook, restoreNotebooks, setScope, trashNotebooks, updateSettings, useApp,
} from "../state/app";
import { folderPath } from "../storage/libraryFiles";
import { importDropped, pickAndImportPdf, pickAndImportPictures } from "../editor/importFiles";
import { Cover } from "./Cover";
import { beginDrag, dragged, endDrag } from "./drag";
import { Glance } from "./Glance";
import { StudyCard } from "../study/StudyCard";
import { SearchResults } from "./SearchResults";
import { daysLeft, folderTree, inScope, scopeTitle, sortNames, sortNotebooks, type SortKey } from "./shelf";
import { Sidebar } from "./Sidebar";
import { CoverSheet, TagsSheet } from "./Sheets";

type Menus =
  | { kind: "new"; anchor: MenuAnchor }
  | { kind: "sort"; anchor: MenuAnchor }
  | { kind: "book"; anchor: MenuAnchor; id: string }
  | { kind: "move"; anchor: MenuAnchor; ids: string[] };

type Dialog = { kind: "tags"; ids: string[] } | { kind: "cover"; id: string };

export function Library() {
  const manifests = useApp((state) => state.manifests);
  const scope = useApp((state) => state.scope);
  const folders = useApp((state) => state.folders);
  const shelves = useApp((state) => state.shelves);
  const settings = useApp((state) => state.settings);
  const unreadable = useApp((state) => state.unreadable);
  const fs = useApp((state) => state.fs);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [menu, setMenu] = useState<Menus | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [making, setMaking] = useState(false);
  const [oneNote, setOneNote] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const trash = scope.kind === "trash";
  const searching = query.trim() !== "";
  const layout = trash ? "list" : settings.libraryLayout;

  const shown = useMemo(
    () => sortNotebooks(Object.values(manifests).filter((manifest) => inScope(manifest, scope, shelves)), settings.librarySort),
    [manifests, scope, shelves, settings.librarySort],
  );
  const subfolders = useMemo(() => (scope.kind === "folder" ? folderTree(folders.filter((folder) => folder.parent === scope.id)).map((row) => row.folder) : []), [folders, scope]);

  // The index is built on the first search and brought up to date as notebooks change.
  useEffect(() => {
    if (!searching) {
      setResults(null);
      return;
    }
    let live = true;
    setResults(null);
    const timer = setTimeout(() => {
      void librarySearch.refresh(fs, manifests).then(() => { if (live) setResults(librarySearch.search(query)); }, () => { if (live) setResults({ notebooks: [], pages: [] }); });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [query, manifests, fs, searching]);

  // Leaving the scope, or the shelf changing under it, ends a selection of notebooks no longer in view.
  useEffect(() => {
    setSelected((now) => {
      const keep = new Set([...now].filter((id) => manifests[id] && inScope(manifests[id], scope, shelves)));
      return keep.size === now.size ? now : keep;
    });
  }, [manifests, scope, shelves]);
  useEffect(() => { if (trash) setSelecting(false); }, [trash]);

  const close = () => setMenu(null);
  const endSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const toggle = (id: string) => setSelected((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const chosen = [...selected];

  const whiteboard = async () => {
    const made = await createNotebook({ title: t("Whiteboard"), kind: "whiteboard", defaults: { template: "dotted", paperColor: "white", pageSize: "letter" } });
    await openNotebook(made.id);
  };

  const dragIDs = (id: string) => (selecting && selected.has(id) ? chosen : [id]);

  const cellProps = (manifest: Manifest) => ({
    manifest,
    selecting,
    selected: selected.has(manifest.id),
    onMenu: (anchor: MenuAnchor) => setMenu({ kind: "book", anchor, id: manifest.id }),
    onOpen: () => { if (selecting) toggle(manifest.id); else if (!trash) void openNotebook(manifest.id); },
    dragIDs: () => dragIDs(manifest.id),
  });

  const emptyTitle = searching ? t("Nothing matches")
    : trash ? t("Nothing deleted")
    : scope.kind === "favourites" ? t("No favourites yet")
    : scope.kind === "folder" ? t("This folder is empty")
    : scope.kind === "shelf" || scope.kind === "tag" ? t("No notebooks here")
    : t("No notebooks yet");
  const emptyText = trash ? t("Notebooks you delete wait here before they are removed for good.")
    : scope.kind === "favourites" ? t("Flag a notebook from its menu and it shows up here.")
    : scope.kind === "folder" ? t("Drag notebooks onto the folder in the sidebar, or press New to start one here.")
    : scope.kind === "shelf" ? t("No notebook has the tags this shelf looks for.")
    : scope.kind === "tag" ? t("No notebook has this tag any more.")
    : t("Press New to start your first one.");

  return (
    <div className="library" data-testid="library">
      {settings.sidebarOpen && <Sidebar />}

      <main
        className="library-main"
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void importDropped([...event.dataTransfer.files]);
        }}
      >
        <div className="library-bar">
          <IconButton label={settings.sidebarOpen ? t("Hide sidebar") : t("Show sidebar")} on={settings.sidebarOpen} onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })} testid="sidebar-toggle">
            <PanelLeft />
          </IconButton>
          <SearchField value={query} onChange={setQuery} placeholder={t("Search notebooks, tags and words")} onEscape={() => setQuery("")} testid="library-search" />
          <button type="button" className="btn primary" onClick={(event) => setMenu({ kind: "new", anchor: anchorBelow(event.currentTarget, "end") })} data-testid="new-button">
            <Plus /> {t("New")}
          </button>
        </div>

        <div className="library-scroll">
          {searching ? (
            <>
              <h1 data-testid="library-title">{t("Search")}</h1>
              <SearchResults results={results} query={query} />
            </>
          ) : (
            <>
              <div className="title-row">
                <div style={{ marginRight: "auto", minWidth: 0 }}>
                  {scope.kind === "folder" && folders.find((folder) => folder.id === scope.id)?.parent && (
                    <div className="meta">{folderPath(folders, folders.find((folder) => folder.id === scope.id)!.parent)}</div>
                  )}
                  <h1 data-testid="library-title" className="truncate">{scopeTitle(scope, folders, shelves)}</h1>
                </div>
                {trash ? (
                  shown.length > 0 && (
                    <button
                      type="button"
                      className="btn destructive"
                      data-testid="trash-empty"
                      onClick={async () => {
                        const sure = await confirm({
                          title: shown.length === 1 ? t("Delete this notebook forever?") : t("Delete all {count} notebooks forever?", { count: shown.length }),
                          message: t("This empties Recently Deleted. It can't be undone."),
                          confirm: t("Empty"),
                          destructive: true,
                        });
                        if (sure) await emptyTrash();
                      }}
                    >
                      <Trash2 /> {t("Empty")}
                    </button>
                  )
                ) : (
                  <>
                    <button
                      type="button"
                      className={`btn${selecting ? " primary" : ""}`}
                      aria-pressed={selecting}
                      onClick={() => (selecting ? endSelecting() : setSelecting(true))}
                      data-testid="select-toggle"
                    >
                      <SquareCheck /> {selecting ? t("Done") : t("Select")}
                    </button>
                    <button type="button" className="btn" onClick={(event) => setMenu({ kind: "sort", anchor: anchorBelow(event.currentTarget, "end") })} data-testid="sort-button">
                      <ArrowUpDown /> {t(sortNames[settings.librarySort])}
                    </button>
                    <Segmented<"shelf" | "list">
                      label={t("Layout")}
                      value={settings.libraryLayout}
                      onChange={(libraryLayout) => updateSettings({ libraryLayout })}
                      options={[
                        { value: "shelf", label: <span data-testid="layout-shelf" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><LayoutGrid size={15} /> {t("Shelf")}</span> },
                        { value: "list", label: <span data-testid="layout-list" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><List size={15} /> {t("List")}</span> },
                      ]}
                    />
                  </>
                )}
              </div>

              {selecting && (
                <div className="selection-bar plate" data-testid="selection-bar" role="toolbar" aria-label={t("Selected notebooks")}>
                  <span className="count" data-testid="selection-count">{selected.size === 0 ? t("Choose notebooks") : t("{count} selected", { count: selected.size })}</span>
                  <button type="button" className="btn small" disabled={selected.size === 0} onClick={(event) => setMenu({ kind: "move", anchor: anchorBelow(event.currentTarget), ids: chosen })} data-testid="bulk-move"><FolderInput /> {t("Move to Folder…")}</button>
                  <button type="button" className="btn small" disabled={selected.size === 0} onClick={() => setDialog({ kind: "tags", ids: chosen })} data-testid="bulk-tags"><Tags /> {t("Add Tags…")}</button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={selected.size === 0}
                    onClick={async () => {
                      const all = chosen.every((id) => manifests[id]?.favourite);
                      for (const id of chosen) await changeNotebook(id, (draft) => { draft.favourite = !all; });
                    }}
                    data-testid="bulk-favourite"
                  >
                    <Flag /> {t("Favourite")}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={selected.size === 0}
                    onClick={async () => { for (const id of chosen) await duplicateNotebook(id); endSelecting(); }}
                    data-testid="bulk-duplicate"
                  >
                    <Copy /> {t("Duplicate")}
                  </button>
                  <button
                    type="button"
                    className="btn small destructive"
                    disabled={selected.size === 0}
                    onClick={async () => { const ids = chosen; endSelecting(); await trashNotebooks(ids); }}
                    data-testid="bulk-delete"
                  >
                    <Trash2 /> {t("Delete")}
                  </button>
                </div>
              )}

              {scope.kind === "all" && unreadable.length > 0 && (
                <section className="plate unreadable" data-testid="unreadable" role="alert">
                  <h2>{unreadable.length === 1 ? t("A notebook can't be read") : t("{count} notebooks can't be read", { count: unreadable.length })}</h2>
                  <ul>
                    {unreadable.map((entry) => <li key={entry.id}><strong>{entry.id}</strong>: {entry.message} {t("The files are still in your library folder.")}</li>)}
                  </ul>
                </section>
              )}

              {scope.kind === "all" && !selecting && <StudyCard />}
              {scope.kind === "all" && !selecting && <Glance />}

              {subfolders.length > 0 && (
                <div className="folder-row" data-testid="folder-tiles">
                  {subfolders.map((folder) => <FolderTile key={folder.id} id={folder.id} name={folder.name} count={Object.values(manifests).filter((manifest) => manifest.folder === folder.id && manifest.trashedAt === null).length} />)}
                </div>
              )}

              {shown.length === 0 ? (
                subfolders.length === 0 && <EmptyPlate icon={trash ? <Trash2 /> : scope.kind === "favourites" ? <Star /> : <NotebookPen />} title={emptyTitle}>{emptyText}</EmptyPlate>
              ) : layout === "shelf" ? (
                <div className="shelf" data-testid="shelf">
                  {shown.map((manifest) => <BookCell key={manifest.id} {...cellProps(manifest)} />)}
                </div>
              ) : (
                <div style={{ paddingTop: 16 }} data-testid="catalogue">
                  {shown.map((manifest) => <CatalogueRow key={manifest.id} {...cellProps(manifest)} trash={trash} />)}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {menu?.kind === "new" && (
        <Menu anchor={menu.anchor} title={t("New")} onClose={close} testid="new-menu">
          <MenuRow icon={<FilePlus2 />} onClick={() => { close(); setMaking(true); }} testid="new-notebook">{t("New Notebook…")}</MenuRow>
          <MenuRow icon={<Presentation />} onClick={() => { close(); void whiteboard(); }} testid="new-whiteboard">{t("New Whiteboard")}</MenuRow>
          <MenuBreak />
          <MenuRow icon={<FileInput />} onClick={() => { close(); void pickAndImportPdf(); }} testid="new-import-pdf">{t("Import PDF…")}</MenuRow>
          <MenuRow icon={<ImagePlus />} onClick={() => { close(); void pickAndImportPictures(); }} testid="new-import-pictures">{t("Import Pictures as Notebook…")}</MenuRow>
          <MenuRow icon={<FileInput />} onClick={() => { close(); setOneNote(true); }} testid="new-import-onenote">{t("Import from OneNote…")}</MenuRow>
          <MenuBreak />
          <MenuRow icon={<PenLine />} keys="Ctrl+Shift+N" onClick={() => { close(); void quickNote(); }} testid="new-quick-note">{t("Quick Note")}</MenuRow>
          <MenuRow icon={<Sunrise />} keys="Ctrl+T" onClick={() => { close(); void openToday(); }} testid="new-today">{t("Today's Page")}</MenuRow>
        </Menu>
      )}

      {menu?.kind === "sort" && (
        <Menu anchor={menu.anchor} title={t("Sort By")} onClose={close} testid="sort-menu">
          {(Object.keys(sortNames) as SortKey[]).map((key) => (
            <MenuRow key={key} chosen={settings.librarySort === key} onClick={() => { close(); updateSettings({ librarySort: key }); }} testid={`sort-${key}`}>{t(sortNames[key])}</MenuRow>
          ))}
        </Menu>
      )}

      {menu?.kind === "move" && (
        <MoveMenu anchor={menu.anchor} ids={menu.ids} onClose={close} onMoved={() => { if (selecting) endSelecting(); }} />
      )}

      {menu?.kind === "book" && manifests[menu.id] && (
        <BookMenu
          manifest={manifests[menu.id]}
          anchor={menu.anchor}
          onClose={close}
          onDialog={(next) => { close(); setDialog(next); }}
          onMove={() => setMenu({ kind: "move", anchor: menu.anchor, ids: [menu.id] })}
        />
      )}

      {dialog?.kind === "tags" && <TagsSheet ids={dialog.ids} onClose={() => { setDialog(null); }} />}
      {dialog?.kind === "cover" && <CoverSheet id={dialog.id} onClose={() => setDialog(null)} />}
      {making && <NewNotebookSheet onClose={() => setMaking(false)} />}
      {oneNote && <OneNoteImport onClose={() => setOneNote(false)} />}
    </div>
  );
}

function FolderTile(props: { id: string; name: string; count: number }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      className={`folder-tile${over ? " drop" : ""}`}
      onClick={() => setScope({ kind: "folder", id: props.id })}
      onDragOver={(event) => { if (dragged()?.kind === "notebooks") { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const item = dragged();
        endDrag();
        if (item?.kind === "notebooks") void moveNotebooks(item.ids, props.id);
      }}
      data-testid="folder-tile"
    >
      <FolderIcon />
      <span className="truncate">{props.name}</span>
      {props.count > 0 && <span className="meta">{props.count}</span>}
    </button>
  );
}

interface CellProps {
  manifest: Manifest;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  dragIDs: () => string[];
}

function pagesText(manifest: Manifest): string {
  return manifest.kind === "whiteboard" ? t("Whiteboard") : tp(manifest.pages.length, "{count} page", "{count} pages");
}

function BookCell(props: CellProps) {
  const { manifest } = props;
  return (
    <div className="book-cell" onContextMenu={(event) => { event.preventDefault(); props.onMenu({ x: event.clientX, y: event.clientY }); }}>
      <button
        type="button"
        className={`book${props.selected ? " selected" : ""}`}
        onClick={props.onOpen}
        draggable
        onDragStart={(event) => beginDrag(event, { kind: "notebooks", ids: props.dragIDs() })}
        onDragEnd={endDrag}
        aria-pressed={props.selecting ? props.selected : undefined}
        data-testid="book"
        data-notebook={manifest.id}
        title={manifest.title}
      >
        <div className="cover-wrap">
          <Cover title={manifest.title} cover={manifest.cover} whiteboard={manifest.kind === "whiteboard"} manifest={manifest} locked={manifest.locked} />
          {manifest.favourite && <span className="flag" data-testid="favourite-flag"><Flag /></span>}
          {props.selected && <span className="sel-check" data-testid="selected-check"><Check /></span>}
        </div>
        <span className="truncate" style={{ fontWeight: 600 }}>{manifest.title}</span>
        <span className="meta">{manifest.locked ? t("Locked") : pagesText(manifest)}</span>
      </button>
      {!props.selecting && (
        <button type="button" className="icon-btn book-more" aria-label={t("More for {name}", { name: manifest.title })} title={t("More")} data-testid="book-more" onClick={(event) => props.onMenu(anchorBelow(event.currentTarget, "end"))}>
          <Ellipsis />
        </button>
      )}
    </div>
  );
}

function CatalogueRow(props: CellProps & { trash: boolean }) {
  const { manifest } = props;
  const folders = useApp((state) => state.folders);
  const trashDays = useApp((state) => state.settings.trashDays);
  const path = folderPath(folders, manifest.folder);
  const left = manifest.trashedAt !== null ? daysLeft(manifest.trashedAt, trashDays) : 0;
  return (
    <div
      className={`catalogue-row${props.selected ? " selected" : ""}`}
      onContextMenu={(event) => { event.preventDefault(); props.onMenu({ x: event.clientX, y: event.clientY }); }}
      draggable={!props.trash}
      onDragStart={(event) => beginDrag(event, { kind: "notebooks", ids: props.dragIDs() })}
      onDragEnd={endDrag}
      data-testid="catalogue-row"
      data-notebook={manifest.id}
    >
      <button type="button" className="catalogue-main" onClick={props.onOpen} aria-pressed={props.selecting ? props.selected : undefined} data-testid="book" data-notebook={manifest.id}>
        {props.selected && <span className="sel-check" style={{ left: 2, top: 2 }} data-testid="selected-check"><Check /></span>}
        <Cover title={manifest.title} cover={manifest.cover} whiteboard={manifest.kind === "whiteboard"} manifest={manifest} locked={manifest.locked} />
        <span className="text">
          <span className="title">
            <span className="truncate">{manifest.title}</span>
            {manifest.favourite && <span className="flag-mark" data-testid="favourite-flag" title={t("Favourite")}><Flag /></span>}
            {manifest.locked && <Lock className="lock-mark" aria-label={t("Locked")} />}
          </span>
          <span className="meta">{props.trash ? tp(left, "{count} day left", "{count} days left") : [pagesText(manifest), path].filter(Boolean).join(" · ")}</span>
          {manifest.tags.length > 0 && (
            <span className="labels">{manifest.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</span>
          )}
        </span>
        {!props.trash && <span className="when">{shortDate(new Date(manifest.modifiedAt))}</span>}
      </button>
      {props.trash ? (
        <>
          <button type="button" className="btn small" onClick={() => void restoreNotebooks([manifest.id])} data-testid="book-put-back"><Undo2 /> {t("Put Back")}</button>
          <button
            type="button"
            className="btn small destructive"
            onClick={async () => {
              const sure = await confirm({ title: t("Delete “{name}” forever?", { name: manifest.title }), message: t("This can't be undone."), confirm: t("Delete Forever"), destructive: true });
              if (sure) await deleteForever([manifest.id]);
            }}
            data-testid="book-delete-forever"
          >
            <Trash2 /> {t("Delete Forever")}
          </button>
        </>
      ) : (
        !props.selecting && <IconButton label={t("More for {name}", { name: manifest.title })} onClick={(event) => props.onMenu(anchorBelow(event.currentTarget, "end"))} testid="book-more"><Ellipsis /></IconButton>
      )}
    </div>
  );
}

/** The folder tree as a menu: indented in tree order, with the top shelf first. */
function MoveMenu(props: { anchor: MenuAnchor; ids: string[]; onClose: () => void; onMoved: () => void }) {
  const folders = useApp((state) => state.folders);
  const manifests = useApp((state) => state.manifests);
  const current = props.ids.length === 1 ? manifests[props.ids[0]]?.folder ?? null : undefined;
  const move = async (folder: string | null) => {
    props.onClose();
    await moveNotebooks(props.ids, folder);
    props.onMoved();
  };
  return (
    <Menu anchor={props.anchor} title={t("Move to Folder")} onClose={props.onClose} testid="move-menu">
      <MenuRow icon={<FolderIcon />} chosen={current === null} onClick={() => void move(null)} testid="move-top">{t("No Folder")}</MenuRow>
      {folderTree(folders).map(({ folder, depth }) => (
        <MenuRow key={folder.id} icon={<FolderIcon />} chosen={current === folder.id} onClick={() => void move(folder.id)} testid={`move-${folder.id}`}>
          {" ".repeat(depth) + folder.name}
        </MenuRow>
      ))}
      {folders.length === 0 && <div className="sidebar-note">{t("No folders yet. Add one from the sidebar.")}</div>}
    </Menu>
  );
}

function BookMenu(props: { manifest: Manifest; anchor: MenuAnchor; onClose: () => void; onDialog: (dialog: Dialog) => void; onMove: () => void }) {
  const { manifest, onClose } = props;
  const trashed = manifest.trashedAt !== null;

  const exportBackup = async () => {
    onClose();
    try {
      await documentIfOpen(manifest.id)?.save();
      const data = await makeBackup(useApp.getState().fs, [manifest.id]);
      if (await saveFile(`${safeFileName(manifest.title)}${BACKUP_SUFFIX}`, data, { name: "OwlLuna backup", extensions: [BACKUP_SUFFIX.slice(1)] })) notify(t("Backup saved."));
    } catch (error) {
      notify(t("Couldn't make the backup: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
    }
  };

  return (
    <Menu anchor={props.anchor} title={manifest.title} onClose={onClose} testid="book-menu">
      {trashed ? (
        <>
          <MenuRow icon={<Undo2 />} onClick={() => { onClose(); void restoreNotebooks([manifest.id]); }} testid="book-put-back">{t("Put Back")}</MenuRow>
          <MenuRow
            icon={<Trash2 />}
            destructive
            onClick={async () => {
              onClose();
              const sure = await confirm({ title: t("Delete “{name}” forever?", { name: manifest.title }), message: t("This can't be undone."), confirm: t("Delete Forever"), destructive: true });
              if (sure) await deleteForever([manifest.id]);
            }}
            testid="book-delete-forever"
          >
            {t("Delete Forever")}
          </MenuRow>
        </>
      ) : (
        <>
          <MenuRow icon={<BookOpen />} onClick={() => { onClose(); void openNotebook(manifest.id); }} testid="book-open">{t("Open")}</MenuRow>
          <MenuRow icon={<SquareArrowOutUpRight />} onClick={() => { onClose(); void openNotebook(manifest.id); }} testid="book-open-tab">{t("Open in New Tab")}</MenuRow>
          <MenuBreak />
          <MenuRow
            icon={<Pencil />}
            onClick={async () => {
              onClose();
              const title = await ask({ title: t("Rename Notebook"), confirm: t("Rename"), value: manifest.title });
              if (title !== null && title.trim()) await renameNotebook(manifest.id, title);
            }}
            testid="book-rename"
          >
            {t("Rename…")}
          </MenuRow>
          <MenuRow
            icon={manifest.favourite ? <FlagOff /> : <Flag />}
            onClick={() => { onClose(); void changeNotebook(manifest.id, (draft) => { draft.favourite = !draft.favourite; }); }}
            testid="book-favourite"
          >
            {manifest.favourite ? t("Unfavourite") : t("Favourite")}
          </MenuRow>
          <MenuRow icon={<Tags />} onClick={() => props.onDialog({ kind: "tags", ids: [manifest.id] })} testid="book-tags">{t("Tags…")}</MenuRow>
          <MenuRow icon={<FolderInput />} onClick={props.onMove} testid="book-move">{t("Move to Folder…")}</MenuRow>
          <MenuRow icon={<Palette />} onClick={() => props.onDialog({ kind: "cover", id: manifest.id })} testid="book-cover">{t("Cover…")}</MenuRow>
          <MenuRow
            icon={manifest.locked ? <LockOpen /> : <Lock />}
            onClick={() => { onClose(); void (manifest.locked ? unlockNotebook(manifest.id) : lockNotebook(manifest.id)); }}
            testid="book-lock"
          >
            {manifest.locked ? t("Unlock") : t("Lock")}
          </MenuRow>
          <MenuBreak />
          <MenuRow icon={<Copy />} onClick={() => { onClose(); void duplicateNotebook(manifest.id); }} testid="book-duplicate">{t("Duplicate")}</MenuRow>
          <MenuRow icon={<FileDown />} onClick={() => void exportBackup()} testid="book-export">{t("Export Backup of This Notebook…")}</MenuRow>
          <MenuBreak />
          <MenuRow icon={<Trash2 />} destructive onClick={() => { onClose(); void trashNotebooks([manifest.id]); }} testid="book-trash">{t("Move to Recently Deleted")}</MenuRow>
        </>
      )}
    </Menu>
  );
}

function NewNotebookSheet(props: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<PaperTemplate>("narrowRuled");
  const [paperColor, setPaperColor] = useState<PaperColor>("white");
  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [style, setStyle] = useState<CoverStyle>("cloth");
  const [cloth, setCloth] = useState<ClothColor>("navy");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cover = style === "print" ? { style, inks: risoPairs[Math.floor(Math.random() * risoPairs.length)] } : { style, cloth };
      const made = await createNotebook({ title, defaults: { template, paperColor, pageSize }, cover });
      props.onClose();
      await openNotebook(made.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={t("New Notebook")}
      onClose={props.onClose}
      testid="new-notebook-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="new-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => void create()} disabled={busy} data-testid="new-create">{t("Create")}</button>
        </>
      }
    >
      <div>
        <label className="label" htmlFor="new-title">{t("Title")}</label>
        <input
          id="new-title"
          className="field"
          autoFocus
          value={title}
          placeholder={t("Untitled")}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
          data-testid="new-title"
        />
      </div>
      <div>
        <label className="label" htmlFor="new-template">{t("Paper")}</label>
        <select id="new-template" className="field" value={template} onChange={(event) => setTemplate(event.target.value as PaperTemplate)} data-testid="new-template">
          {paperFamilies.map((family) => (
            <optgroup key={family} label={familyName(family)}>
              {familyTemplates[family].map((name) => <option key={name} value={name}>{templateName(name)}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <span className="label">{t("Paper Colour")}</span>
        <div className="swatches" role="group" aria-label={t("Paper colour")}>
          {paperColors.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch${color === paperColor ? " on" : ""}`}
              style={{ background: paperCSS(color) }}
              title={paperColorName(color)}
              aria-label={paperColorName(color)}
              aria-pressed={color === paperColor}
              onClick={() => setPaperColor(color)}
              data-testid={`new-paper-${color}`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="new-size">{t("Page Size")}</label>
        <select id="new-size" className="field" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSize)} data-testid="new-size">
          {pageSizes.map((size) => <option key={size} value={size}>{pageSizeName(size)}</option>)}
        </select>
      </div>
      <div>
        <span className="label">{t("Cover")}</span>
        <Segmented<CoverStyle> label={t("Cover style")} value={style} onChange={setStyle} options={[{ value: "cloth", label: t("Cloth") }, { value: "print", label: t("Print") }]} />
      </div>
      {style === "cloth" && (
        <div>
          <span className="label">{t("Cloth Colour")}</span>
          <div className="swatches" role="group" aria-label={t("Cloth colour")}>
            {clothColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${color === cloth ? " on" : ""}`}
                style={{ background: clothHex[color] }}
                title={swatchName(color)}
                aria-label={swatchName(color)}
                aria-pressed={color === cloth}
                onClick={() => setCloth(color)}
                data-testid={`new-cloth-${color}`}
              />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
