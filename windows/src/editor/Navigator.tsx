// The page navigator: a column of page thumbnails down the left. Click to go, drag to reorder, right-click for more.

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { pageThumbnailURL, thumbnailKey } from "../canvas/thumbnail";
import { confirm, IconButton, Menu, MenuBreak, MenuRow, type MenuAnchor } from "../design/controls";
import { newPage, type Page } from "../model/notebook";
import { notify } from "../state/app";
import type { NotebookDocument } from "./document";
import { dropIndex } from "./pageOrder";
import { copyPages, hasHeldPages, pastePages } from "./pageClipboard";
import { goToPage, type Session } from "./session";

const WIDTH = 220;

function Thumb(props: {
  doc: NotebookDocument; page: Page; number: number; current: boolean; selected: boolean; dropBefore: boolean;
  onClick: (event: React.MouseEvent) => void; onMenu: (event: React.MouseEvent) => void;
  onDragStart: (event: React.DragEvent) => void; onDragOver: (event: React.DragEvent) => void; onDragEnd: () => void; onDrop: (event: React.DragEvent) => void;
}) {
  const { doc, page } = props;
  const box = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  const [url, setURL] = useState<string | null>(null);
  const inkVersion = doc.inkVersion(page.id);
  const look = thumbnailKey(doc.id, page, WIDTH, inkVersion);

  // Pages are drawn only when they have been scrolled near.
  useEffect(() => {
    const element = box.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setSeen(true); }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    void pageThumbnailURL(doc, page.id, WIDTH).then((found) => { if (live && found) setURL(found); });
    return () => { live = false; };
  }, [seen, doc, page.id, look]);

  const aspect = page.size.w / page.size.h;
  return (
    <button
      ref={box}
      type="button"
      className={`thumb${props.current ? " on" : ""}${props.selected ? " picked" : ""}${props.dropBefore ? " drop-before" : ""}`}
      data-thumb={page.id}
      data-testid="thumb"
      draggable
      onClick={props.onClick}
      onContextMenu={props.onMenu}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      aria-label={`Page ${props.number}`}
      aria-current={props.current}
    >
      {url ? <img className="thumb-face" src={url} alt="" draggable={false} /> : <div className="thumb-face" style={{ aspectRatio: String(aspect) }} />}
      <span className="number">{props.number}</span>
      {page.bookmark && <span className="ribbon" data-testid="thumb-ribbon" />}
      {page.date && <span className="thumb-date">{formatDay(page.date)}</span>}
    </button>
  );
}

function formatDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function Navigator(props: { doc: NotebookDocument; session: Session; version: number }) {
  const { doc, session } = props;
  const state = useStore(session);
  const pages = doc.manifest.pages;
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; ids: string[] } | null>(null);
  const [drag, setDrag] = useState<{ ids: string[]; before: number | null } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const order = useMemo(() => pages.map((page) => page.id), [pages]);

  // The current page is kept in sight.
  useEffect(() => {
    body.current?.querySelector(`[data-thumb="${CSS.escape(state.currentPage)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [state.currentPage]);

  // Selected pages that are gone are forgotten.
  useEffect(() => {
    setSelected((now) => (now.every((id) => order.includes(id)) ? now : now.filter((id) => order.includes(id))));
  }, [order]);

  const click = (page: Page, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setSelected((now) => (now.includes(page.id) ? now.filter((id) => id !== page.id) : [...now, page.id]));
      setAnchor(page.id);
      return;
    }
    if (event.shiftKey && anchor) {
      const a = order.indexOf(anchor), b = order.indexOf(page.id);
      setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
      return;
    }
    setSelected([]);
    setAnchor(page.id);
    goToPage(session, page.id);
  };

  const addAt = (index: number): Page => {
    if (index > 0) return doc.addPage(pages[index - 1].id);
    const model = pages[0];
    const fresh = newPage(doc.manifest.defaults, model && !model.edgeless
      ? { background: model.background.kind === "template" ? model.background : { kind: "template", template: doc.manifest.defaults.template }, paperColor: model.paperColor, size: { ...model.size } }
      : {});
    doc.insertPages(0, [fresh], new Map(), "Add Page");
    return fresh;
  };

  const drop = (moving: string[], before: number) => {
    const at = dropIndex(order, moving, before);
    if (moving.length === 1) {
      doc.movePage(moving[0], at);
    } else {
      const set = new Set(moving);
      doc.transact("Move Pages", (draft) => {
        const all = draft.manifest.pages;
        const taken = all.filter((page) => set.has(page.id));
        const rest = all.filter((page) => !set.has(page.id));
        rest.splice(at, 0, ...taken);
        draft.manifest.pages = rest;
      });
    }
  };

  const remove = async (ids: string[]) => {
    let busy = false;
    for (const id of ids) {
      const page = doc.page(id);
      if (!page) continue;
      if (page.items.length > 0 || (await doc.ensureInk(id)).length > 0) busy = true;
    }
    if (busy) {
      const sure = await confirm({
        title: ids.length === 1 ? "Delete this page?" : `Delete ${ids.length} pages?`,
        message: "Its writing and items go with it. You can undo this.",
        confirm: "Delete",
        destructive: true,
      });
      if (!sure) return;
    }
    await doc.deletePages(ids);
    setSelected([]);
  };

  const menuIds = menu?.ids ?? [];
  const firstIndex = menuIds.length ? Math.min(...menuIds.map((id) => order.indexOf(id))) : 0;
  const lastIndex = menuIds.length ? Math.max(...menuIds.map((id) => order.indexOf(id))) : 0;
  const bookmarked = menuIds.length > 0 && menuIds.every((id) => doc.page(id)?.bookmark);

  return (
    <aside className="side-panel navigator" data-testid="navigator">
      <div className="side-head">
        <h3 className="display grow" style={{ fontSize: 16 }}>Pages</h3>
        <IconButton label="Add Page After This One" onClick={() => { const added = doc.addPage(state.currentPage); goToPage(session, added.id); }} testid="navigator-add"><Plus /></IconButton>
        <IconButton label="Close" onClick={() => session.setState({ panel: null })} testid="navigator-close"><X /></IconButton>
      </div>
      <div
        className="side-body"
        ref={body}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrag((now) => (now ? { ...now, before: null } : now)); }}
      >
        {pages.map((page, index) => (
          <Thumb
            key={page.id}
            doc={doc}
            page={page}
            number={index + 1}
            current={page.id === state.currentPage}
            selected={selected.includes(page.id)}
            dropBefore={drag?.before === index}
            onClick={(event) => click(page, event)}
            onMenu={(event) => {
              event.preventDefault();
              setMenu({ anchor: { x: event.clientX, y: event.clientY }, ids: selected.includes(page.id) ? order.filter((id) => selected.includes(id)) : [page.id] });
            }}
            onDragStart={(event) => {
              const ids = selected.includes(page.id) ? order.filter((id) => selected.includes(id)) : [page.id];
              event.dataTransfer.setData("text/plain", page.id);
              event.dataTransfer.effectAllowed = "move";
              setDrag({ ids, before: null });
            }}
            onDragOver={(event) => {
              if (!drag) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              const before = event.clientY < box.top + box.height / 2 ? index : index + 1;
              if (drag.before !== before) setDrag({ ...drag, before });
            }}
            onDragEnd={() => setDrag(null)}
            onDrop={(event) => {
              event.preventDefault();
              if (drag && drag.before !== null) drop(drag.ids, drag.before);
              setDrag(null);
            }}
          />
        ))}
        <div className={`thumb-tail${drag?.before === pages.length ? " drop-before" : ""}`} />
      </div>

      {menu && (
        <Menu anchor={menu.anchor} title={menu.ids.length > 1 ? `${menu.ids.length} Pages` : `Page ${firstIndex + 1}`} onClose={() => setMenu(null)} testid="navigator-menu">
          <MenuRow onClick={() => { setMenu(null); const added = addAt(firstIndex); goToPage(session, added.id); }} testid="page-add-before">Add Page Before</MenuRow>
          <MenuRow onClick={() => { setMenu(null); const added = doc.addPage(pages[lastIndex].id); goToPage(session, added.id); }} testid="page-add-after">Add Page After</MenuRow>
          <MenuRow onClick={() => { setMenu(null); void (async () => { for (const id of [...menuIds].reverse()) await doc.duplicatePage(id); })(); }} testid="page-duplicate">Duplicate</MenuRow>
          <MenuRow
            chosen={bookmarked}
            onClick={() => { setMenu(null); for (const id of menuIds) doc.updatePage(id, bookmarked ? "Remove Bookmark" : "Bookmark", (draft) => { if (bookmarked) delete draft.bookmark; else draft.bookmark = true; }); }}
            testid="page-bookmark"
          >
            Bookmark
          </MenuRow>
          <MenuBreak />
          <MenuRow onClick={() => { setMenu(null); void copyPages(doc, menuIds).then((count) => notify(count === 1 ? "Page copied." : `${count} pages copied.`)); }} testid="page-copy">Copy Page</MenuRow>
          <MenuRow
            disabled={!hasHeldPages()}
            onClick={() => { setMenu(null); void pastePages(doc, pages[lastIndex].id).then((made) => { if (made[0]) goToPage(session, made[0].id); }).catch(() => notify("Those pages couldn't be pasted.", "trouble")); }}
            testid="page-paste"
          >
            Paste Page
          </MenuRow>
          <MenuBreak />
          <MenuRow destructive onClick={() => { const ids = menuIds; setMenu(null); void remove(ids); }} testid="page-delete">Delete</MenuRow>
        </Menu>
      )}
    </aside>
  );
}
