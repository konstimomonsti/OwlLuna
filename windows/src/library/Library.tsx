// The library: a shelf of notebooks. A first, compact version: scopes, search, making new ones, and a menu on each.

import { BookOpen, Copy, Ellipsis, FilePlus2, Flag, FlagOff, Library as LibraryIcon, NotebookPen, PenLine, Plus, Presentation, RotateCcw, Star, Sunrise, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { anchorBelow, ask, confirm, EmptyPlate, Menu, MenuBreak, MenuRow, SearchField, Segmented, Sheet, type MenuAnchor } from "../design/controls";
import { clothColors, clothHex, risoPairs, type ClothColor, type CoverStyle, type Manifest } from "../model/notebook";
import {
  familyNames, familyTemplates, paperColorNames, paperColors, paperCSS, paperFamilies, pageSizeNames, pageSizes, templateNames,
  type PageSize, type PaperColor, type PaperTemplate,
} from "../model/paper";
import {
  changeNotebook, createNotebook, deleteForever, duplicateNotebook, openNotebook, openToday, quickNote, renameNotebook, restoreNotebooks,
  setScope, trashNotebooks, useApp, type Scope,
} from "../state/app";
import { Cover } from "./Cover";

const scopeTitle = (scope: Scope): string => (scope.kind === "favourites" ? "Favourites" : scope.kind === "trash" ? "Recently Deleted" : "All Notebooks");

export function Library() {
  const manifests = useApp((state) => state.manifests);
  const scope = useApp((state) => state.scope);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ kind: "new"; anchor: MenuAnchor } | { kind: "book"; anchor: MenuAnchor; id: string } | null>(null);
  const [making, setMaking] = useState(false);

  const all = useMemo(() => Object.values(manifests), [manifests]);
  const counts = useMemo(() => ({
    all: all.filter((manifest) => manifest.trashedAt === null).length,
    favourites: all.filter((manifest) => manifest.trashedAt === null && manifest.favourite).length,
    trash: all.filter((manifest) => manifest.trashedAt !== null).length,
  }), [all]);

  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return all
      .filter((manifest) => (scope.kind === "trash" ? manifest.trashedAt !== null : manifest.trashedAt === null))
      .filter((manifest) => scope.kind !== "favourites" || manifest.favourite)
      .filter((manifest) => !wanted || manifest.title.toLowerCase().includes(wanted))
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  }, [all, scope, query]);

  const trash = scope.kind === "trash";
  const close = () => setMenu(null);

  const rows: { scope: Scope; label: string; icon: React.ReactNode; count: number; id: string }[] = [
    { scope: { kind: "all" }, label: "All Notebooks", icon: <LibraryIcon />, count: counts.all, id: "all" },
    { scope: { kind: "favourites" }, label: "Favourites", icon: <Star />, count: counts.favourites, id: "favourites" },
    { scope: { kind: "trash" }, label: "Recently Deleted", icon: <Trash2 />, count: counts.trash, id: "trash" },
  ];

  const whiteboard = async () => {
    const made = await createNotebook({ title: "Whiteboard", kind: "whiteboard", defaults: { template: "dotted", paperColor: "white", pageSize: "letter" } });
    await openNotebook(made.id);
  };

  return (
    <div className="library" data-testid="library">
      <aside className="sidebar" data-testid="sidebar">
        <div className="sidebar-head"><h2 className="display" style={{ fontSize: 22 }}>OwlLuna</h2></div>
        <nav className="sidebar-scroll">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`sidebar-row${scope.kind === row.scope.kind ? " on" : ""}`}
              onClick={() => setScope(row.scope)}
              data-testid={`scope-${row.id}`}
            >
              {row.icon}
              <span className="truncate">{row.label}</span>
              {row.count > 0 && <span className="count">{row.count}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="library-main">
        <div className="library-bar">
          <SearchField value={query} onChange={setQuery} placeholder="Search notebooks" onEscape={() => setQuery("")} testid="library-search" />
          <button type="button" className="btn primary" onClick={(event) => setMenu({ kind: "new", anchor: anchorBelow(event.currentTarget, "end") })} data-testid="new-button">
            <Plus /> New
          </button>
        </div>

        <div className="library-scroll">
          <h1 data-testid="library-title">{scopeTitle(scope)}</h1>
          {shown.length === 0 ? (
            <EmptyPlate
              icon={query ? <BookOpen /> : trash ? <Trash2 /> : scope.kind === "favourites" ? <Star /> : <NotebookPen />}
              title={query ? "Nothing matches" : trash ? "Nothing deleted" : scope.kind === "favourites" ? "No favourites yet" : "No notebooks yet"}
            >
              {query ? "Try another word from the title." : trash ? "Notebooks you delete wait here before they are removed for good." : scope.kind === "favourites" ? "Flag a notebook from its menu and it shows up here." : "Press New to start your first one."}
            </EmptyPlate>
          ) : (
            <div className="shelf" data-testid="shelf">
              {shown.map((manifest) => (
                <BookCell
                  key={manifest.id}
                  manifest={manifest}
                  onMenu={(anchor) => setMenu({ kind: "book", anchor, id: manifest.id })}
                  onOpen={() => { if (!trash) void openNotebook(manifest.id); }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {menu?.kind === "new" && (
        <Menu anchor={menu.anchor} title="New" onClose={close} testid="new-menu">
          <MenuRow icon={<FilePlus2 />} onClick={() => { close(); setMaking(true); }} testid="new-notebook">New Notebook…</MenuRow>
          <MenuRow icon={<Presentation />} onClick={() => { close(); void whiteboard(); }} testid="new-whiteboard">New Whiteboard</MenuRow>
          <MenuBreak />
          <MenuRow icon={<PenLine />} keys="Ctrl+Shift+N" onClick={() => { close(); void quickNote(); }} testid="new-quick-note">Quick Note</MenuRow>
          <MenuRow icon={<Sunrise />} keys="Ctrl+T" onClick={() => { close(); void openToday(); }} testid="new-today">Today's Page</MenuRow>
        </Menu>
      )}

      {menu?.kind === "book" && manifests[menu.id] && (
        <BookMenu manifest={manifests[menu.id]} anchor={menu.anchor} onClose={close} />
      )}

      {making && <NewNotebookSheet onClose={() => setMaking(false)} />}
    </div>
  );
}

function BookCell(props: { manifest: Manifest; onOpen: () => void; onMenu: (anchor: MenuAnchor) => void }) {
  const { manifest } = props;
  const whiteboard = manifest.kind === "whiteboard";
  return (
    <div className="book-cell" onContextMenu={(event) => { event.preventDefault(); props.onMenu({ x: event.clientX, y: event.clientY }); }}>
      <button type="button" className="book" onClick={props.onOpen} data-testid="book" data-notebook={manifest.id} title={manifest.title}>
        <div className="cover-wrap">
          <Cover title={manifest.title} cover={manifest.cover} whiteboard={whiteboard} />
          {manifest.favourite && <span className="flag" data-testid="favourite-flag"><Flag /></span>}
        </div>
        <span className="truncate" style={{ fontWeight: 600 }}>{manifest.title}</span>
        <span className="meta">{whiteboard ? "Whiteboard" : `${manifest.pages.length} ${manifest.pages.length === 1 ? "page" : "pages"}`}</span>
      </button>
      <button
        type="button"
        className="icon-btn book-more"
        aria-label={`More for ${manifest.title}`}
        title="More"
        data-testid="book-more"
        onClick={(event) => props.onMenu(anchorBelow(event.currentTarget, "end"))}
      >
        <Ellipsis />
      </button>
    </div>
  );
}

function BookMenu(props: { manifest: Manifest; anchor: MenuAnchor; onClose: () => void }) {
  const { manifest, onClose } = props;
  const trashed = manifest.trashedAt !== null;
  return (
    <Menu anchor={props.anchor} title={manifest.title} onClose={onClose} testid="book-menu">
      {trashed ? (
        <>
          <MenuRow icon={<Undo2 />} onClick={() => { onClose(); void restoreNotebooks([manifest.id]); }} testid="book-put-back">Put Back</MenuRow>
          <MenuRow
            icon={<Trash2 />}
            destructive
            onClick={async () => {
              onClose();
              const sure = await confirm({ title: `Delete “${manifest.title}” forever?`, message: "This can't be undone.", confirm: "Delete Forever", destructive: true });
              if (sure) await deleteForever([manifest.id]);
            }}
            testid="book-delete-forever"
          >
            Delete Forever
          </MenuRow>
        </>
      ) : (
        <>
          <MenuRow icon={<BookOpen />} onClick={() => { onClose(); void openNotebook(manifest.id); }} testid="book-open">Open</MenuRow>
          <MenuRow
            icon={<NotebookPen />}
            onClick={async () => {
              onClose();
              const title = await ask({ title: "Rename Notebook", confirm: "Rename", value: manifest.title });
              if (title !== null && title.trim()) await renameNotebook(manifest.id, title);
            }}
            testid="book-rename"
          >
            Rename…
          </MenuRow>
          <MenuRow
            icon={manifest.favourite ? <FlagOff /> : <Flag />}
            onClick={() => { onClose(); void changeNotebook(manifest.id, (draft) => { draft.favourite = !draft.favourite; }); }}
            testid="book-favourite"
          >
            {manifest.favourite ? "Unfavourite" : "Favourite"}
          </MenuRow>
          <MenuRow icon={<Copy />} onClick={() => { onClose(); void duplicateNotebook(manifest.id); }} testid="book-duplicate">Duplicate</MenuRow>
          <MenuBreak />
          <MenuRow icon={<RotateCcw />} destructive onClick={() => { onClose(); void trashNotebooks([manifest.id]); }} testid="book-trash">Move to Recently Deleted</MenuRow>
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
      title="New Notebook"
      onClose={props.onClose}
      testid="new-notebook-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="new-cancel">Cancel</button>
          <button type="button" className="btn primary" onClick={() => void create()} disabled={busy} data-testid="new-create">Create</button>
        </>
      }
    >
      <div>
        <label className="label" htmlFor="new-title">Title</label>
        <input
          id="new-title"
          className="field"
          autoFocus
          value={title}
          placeholder="Untitled"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
          data-testid="new-title"
        />
      </div>
      <div>
        <label className="label" htmlFor="new-template">Paper</label>
        <select id="new-template" className="field" value={template} onChange={(event) => setTemplate(event.target.value as PaperTemplate)} data-testid="new-template">
          {paperFamilies.map((family) => (
            <optgroup key={family} label={familyNames[family]}>
              {familyTemplates[family].map((name) => <option key={name} value={name}>{templateNames[name]}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <span className="label">Paper Colour</span>
        <div className="swatches" role="group" aria-label="Paper colour">
          {paperColors.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch${color === paperColor ? " on" : ""}`}
              style={{ background: paperCSS(color) }}
              title={paperColorNames[color]}
              aria-label={paperColorNames[color]}
              aria-pressed={color === paperColor}
              onClick={() => setPaperColor(color)}
              data-testid={`new-paper-${color}`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="new-size">Page Size</label>
        <select id="new-size" className="field" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSize)} data-testid="new-size">
          {pageSizes.map((size) => <option key={size} value={size}>{pageSizeNames[size]}</option>)}
        </select>
      </div>
      <div>
        <span className="label">Cover</span>
        <Segmented<CoverStyle> label="Cover style" value={style} onChange={setStyle} options={[{ value: "cloth", label: "Cloth" }, { value: "print", label: "Print" }]} />
      </div>
      {style === "cloth" && (
        <div>
          <span className="label">Cloth Colour</span>
          <div className="swatches" role="group" aria-label="Cloth colour">
            {clothColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${color === cloth ? " on" : ""}`}
                style={{ background: clothHex[color] }}
                title={color}
                aria-label={color}
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
