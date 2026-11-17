// Import from OneNote: pick notebooks and sections, choose how, watch it run, read what came of it.

import { ChevronDown, ChevronRight, FileInput, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyPlate, Segmented, Sheet, Slab, Thread } from "../design/controls";
import "../design/onenote.css";
import { t, tp } from "../i18n";
import { invoke, isTauri, pickFiles } from "../platform/host";
import type { ONGroup, ONLocalNotebook, ONNotebook, ONSection } from "../services/onenote";
import { appEnv } from "../services/onenoteApp";
import { allSections, emptySummary, importSections, sectionProblem, type ImportOptions, type ImportProgress, type ImportSummary, type Signal } from "../services/onenoteImport";
import { importPdf } from "../services/pdfImport";
import { loadLibrary, notify, registerManifest, useApp } from "../state/app";

type Phase = "choose" | "running" | "done";

function sectionsIn(group: { sections: ONSection[]; groups: ONGroup[] }, includeDeleted: boolean): ONSection[] {
  const own = group.sections;
  const inner = group.groups.filter((g) => includeDeleted || !g.isRecycleBin).flatMap((g) => sectionsIn(g, includeDeleted));
  return [...own, ...inner];
}

const pageCount = (sections: ONSection[], includeDeleted: boolean) =>
  sections.reduce((n, s) => n + s.pages.filter((p) => includeDeleted || !p.isInRecycleBin).length, 0);

export function OneNoteImport(props: { onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [notebooks, setNotebooks] = useState<ONNotebook[] | null>(null);
  const [locals, setLocals] = useState<ONLocalNotebook[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportOptions["mode"]>("editable");
  const [keepPdf, setKeepPdf] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [phase, setPhase] = useState<Phase>("choose");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [details, setDetails] = useState(false);
  const signal = useRef<Signal>({ cancelled: false });
  const fs = useApp((state) => state.fs);

  async function load(keepSelection = false) {
    setProblem(null);
    try {
      const books = await invoke<ONNotebook[]>("onenote_hierarchy");
      setNotebooks(books);
      setLocals(await invoke<ONLocalNotebook[]>("onenote_local_notebooks").catch(() => []));
      if (!keepSelection) {
        setSelected(new Set(allSections(books, false).filter((job) => !sectionProblem(job.section, false)).map((job) => job.section.id)));
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setNotebooks([]);
    }
  }

  useEffect(() => {
    let live = true;
    void (async () => {
      const ok = isTauri ? await invoke<boolean>("onenote_available").catch(() => false) : false;
      if (!live) return;
      setAvailable(ok);
      if (ok) await load();
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobs = useMemo(() => (notebooks ? allSections(notebooks, includeDeleted).filter((job) => selected.has(job.section.id) && !sectionProblem(job.section, includeDeleted)) : []), [notebooks, selected, includeDeleted]);

  function toggle(sections: ONSection[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const section of sections) {
        if (sectionProblem(section, includeDeleted)) continue;
        if (on) next.add(section.id);
        else next.delete(section.id);
      }
      return next;
    });
  }

  function everything(on: boolean) {
    toggle(allSections(notebooks ?? [], includeDeleted).map((job) => job.section), on);
  }

  async function run() {
    signal.current = { cancelled: false };
    setPhase("running");
    setSummary(null);
    try {
      const result = await importSections(appEnv(), jobs, { mode, keepPdfCopies: keepPdf, includeDeleted }, setProgress, signal.current);
      setSummary(result);
    } catch (error) {
      setSummary({ ...emptySummary(), skipped: [{ name: "OneNote", reason: error instanceof Error ? error.message : String(error) }] });
    } finally {
      await invoke("onenote_release").catch(() => {});
      await loadLibrary(fs).catch(() => {});
      setPhase("done");
    }
  }

  async function openAndInclude(local: ONLocalNotebook) {
    setOpening(local.path);
    try {
      await invoke("onenote_open_notebook", { path: local.path });
      await load(true);
      notify(t("Opened “{name}” in OneNote.", { name: local.name }));
    } catch (error) {
      notify(t("Couldn't open the notebook: {reason}", { reason: error instanceof Error ? error.message : String(error) }), "trouble");
    } finally {
      setOpening(null);
    }
  }

  async function importPdfInstead() {
    const [file] = await pickFiles([{ name: "PDF", extensions: ["pdf"] }]).catch(() => []);
    if (!file) return;
    try {
      registerManifest(await importPdf(fs, file.data, file.name));
      notify(t("Imported “{name}”.", { name: file.name }));
      props.onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "trouble");
    }
  }

  const running = phase === "running";
  const close = () => { if (!running) props.onClose(); };

  // ---- Not available ----------------------------------------------------------------------------------------------
  if (available === false) {
    return (
      <Sheet title={t("Import from OneNote")} onClose={close} wide testid="onenote-sheet" foot={<button type="button" className="btn flat" onClick={close} data-testid="onenote-close">{t("Close")}</button>}>
        <div className="onenote-body">
          <EmptyPlate icon={<FileInput />} title={t("OneNote can't be reached")}>
            {isTauri
              ? t("Importing needs OneNote for Microsoft 365 or OneNote 2016 on this PC. The OneNote app from the Microsoft Store has no import interface.")
              : t("Importing from OneNote needs the Windows app.")}
          </EmptyPlate>
          <p className="secondary">{t("You can still bring notebooks in as PDFs: in OneNote choose File > Export > PDF, then import the file here.")}</p>
          <button type="button" className="btn primary" onClick={() => void importPdfInstead()} data-testid="onenote-import-pdf">{t("Import PDF…")}</button>
        </div>
      </Sheet>
    );
  }

  // ---- Running and done -------------------------------------------------------------------------------------------
  if (phase !== "choose") {
    return (
      <Sheet
        title={t("Import from OneNote")}
        onClose={close}
        wide
        testid="onenote-sheet"
        foot={running
          ? <button type="button" className="btn flat" onClick={() => { signal.current.cancelled = true; }} data-testid="onenote-cancel">{t("Cancel")}</button>
          : <button type="button" className="btn primary" onClick={props.onClose} data-testid="onenote-done">{t("Done")}</button>}
      >
        <div className="onenote-body">
          {running && progress && (
            <>
              <Thread value={progress.fraction} label={t("Import progress")} />
              <p className="onenote-now" data-testid="onenote-now">{progress.notebook} › {progress.section}{progress.page ? ` › ${progress.page}` : ""}</p>
              <p className="meta">{t("Section {n} of {total}", { n: progress.sectionIndex + 1, total: progress.sectionCount })} · {t("page {n} of {total}", { n: Math.min(progress.pageIndex + 1, progress.pageCount), total: progress.pageCount })}</p>
              <p className="secondary">{t("Pages with a lot of handwriting can take a while. Cancel stops after the current page and keeps what is done.")}</p>
            </>
          )}
          {running && !progress && <p className="secondary">{t("Asking OneNote…")}</p>}
          {summary && <Summary summary={summary} details={details} onDetails={() => setDetails((v) => !v)} />}
        </div>
      </Sheet>
    );
  }

  // ---- Choosing ---------------------------------------------------------------------------------------------------
  const importable = allSections(notebooks ?? [], includeDeleted).filter((job) => !sectionProblem(job.section, includeDeleted));
  return (
    <Sheet
      title={t("Import from OneNote")}
      onClose={close}
      wide
      testid="onenote-sheet"
      foot={(
        <>
          <button type="button" className="btn flat" onClick={close} data-testid="onenote-cancel-choose">{t("Cancel")}</button>
          <button type="button" className="btn primary" disabled={jobs.length === 0} onClick={() => void run()} data-testid="onenote-import">
            {tp(jobs.length, "Import {count} Section", "Import {count} Sections")}
          </button>
        </>
      )}
    >
      <div className="onenote-body">
        {(available === null || notebooks === null) && <p className="secondary" data-testid="onenote-loading">{t("Asking OneNote… the first time it can take a few seconds.")}</p>}
        {problem && <p className="onenote-problem" role="alert">{problem}</p>}
        {notebooks && notebooks.length === 0 && !problem && <p className="secondary">{t("OneNote has no open notebooks.")}</p>}
        {notebooks && notebooks.length > 0 && (
          <>
            <div className="onenote-bar">
              <span className="meta grow">{tp(importable.length, "{count} section can be imported", "{count} sections can be imported")} · {tp(pageCount(importable.map((j) => j.section), includeDeleted), "{count} page", "{count} pages")}</span>
              <button type="button" className="btn small flat" onClick={() => everything(true)} data-testid="onenote-all">{t("Select all")}</button>
              <button type="button" className="btn small flat" onClick={() => everything(false)} data-testid="onenote-none">{t("Select none")}</button>
            </div>
            <div className="onenote-tree" data-testid="onenote-tree">
              {notebooks.map((notebook) => (
                <NodeRow
                  key={notebook.id}
                  id={notebook.id}
                  name={notebook.name}
                  node={notebook}
                  depth={0}
                  selected={selected}
                  collapsed={collapsed}
                  setCollapsed={setCollapsed}
                  toggle={toggle}
                  includeDeleted={includeDeleted}
                />
              ))}
            </div>
          </>
        )}
        {locals.some((l) => !l.isOpen) && (
          <div className="onenote-local">
            <h3>{t("On this PC, not open in OneNote")}</h3>
            <p className="secondary">{t("Opening one adds it to OneNote's notebook list so it can be read. Nothing in the notebook is changed.")}</p>
            {locals.filter((l) => !l.isOpen).map((local) => (
              <div className="onenote-row" key={local.path}>
                <span className="grow truncate" title={local.path}>{local.name}</span>
                <button type="button" className="btn small" disabled={opening !== null} onClick={() => void openAndInclude(local)} data-testid={`onenote-open-${local.name}`}>
                  {opening === local.path ? t("Opening…") : t("Open in OneNote and include")}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="onenote-options">
          <Segmented
            label={t("How to import")}
            value={mode}
            onChange={setMode}
            options={[{ value: "editable", label: t("Editable ink and text (recommended)") }, { value: "exact", label: t("Exact copy as PDF pages") }]}
          />
          <p className="meta">{mode === "editable"
            ? t("Handwriting becomes ink you can still change, text stays text. Importing again updates the notebooks without duplicating them.")
            : t("Every section is printed to PDF by OneNote, so pages look exactly as in OneNote, but the ink can't be edited.")}</p>
          <div className="ledger-row">
            <span className="grow">{t("Keep a PDF copy of pages that don't convert fully")}</span>
            <Slab checked={keepPdf} onChange={setKeepPdf} label={t("Keep a PDF copy of pages that don't convert fully")} disabled={mode === "exact"} />
          </div>
          <div className="ledger-row">
            <span className="grow">{t("Include deleted pages")}</span>
            <Slab checked={includeDeleted} onChange={setIncludeDeleted} label={t("Include deleted pages")} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

type Node = ONNotebook | ONGroup;

function NodeRow(props: {
  id: string; name: string; node: Node; depth: number; selected: Set<string>; collapsed: Set<string>;
  setCollapsed: (next: Set<string>) => void; toggle: (sections: ONSection[], on: boolean) => void; includeDeleted: boolean;
}) {
  const { node, depth, selected, collapsed, includeDeleted } = props;
  const all = sectionsIn(node, includeDeleted).filter((s) => !sectionProblem(s, includeDeleted));
  const ticked = all.filter((s) => selected.has(s.id)).length;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = ticked > 0 && ticked < all.length; }, [ticked, all.length]);
  const isCollapsed = collapsed.has(props.id);
  const flip = () => {
    const next = new Set(collapsed);
    if (isCollapsed) next.delete(props.id);
    else next.add(props.id);
    props.setCollapsed(next);
  };
  const groups = node.groups.filter((g) => includeDeleted || !g.isRecycleBin);
  return (
    <div className="onenote-node" style={{ paddingLeft: depth * 18 }}>
      <div className="onenote-row">
        <button type="button" className="onenote-twist" onClick={flip} aria-label={isCollapsed ? t("Expand") : t("Collapse")} aria-expanded={!isCollapsed}>
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
        <label className="onenote-check grow">
          <input ref={ref} type="checkbox" checked={all.length > 0 && ticked === all.length} disabled={all.length === 0} onChange={(event) => props.toggle(all, event.target.checked)} data-testid={`onenote-pick-${props.name}`} />
          <span className={`onenote-name${depth === 0 ? " book" : ""}`}>{props.name}</span>
        </label>
        <span className="meta">{tp(all.length, "{count} section", "{count} sections")} · {tp(pageCount(all, includeDeleted), "{count} page", "{count} pages")}</span>
      </div>
      {!isCollapsed && (
        <>
          {node.sections.map((section) => <SectionRow key={section.id} section={section} depth={depth + 1} selected={selected} toggle={props.toggle} includeDeleted={includeDeleted} />)}
          {groups.map((group) => <NodeRow key={group.id} {...props} id={group.id} name={group.name} node={group} depth={depth + 1} />)}
        </>
      )}
    </div>
  );
}

function SectionRow(props: { section: ONSection; depth: number; selected: Set<string>; toggle: (s: ONSection[], on: boolean) => void; includeDeleted: boolean }) {
  const { section } = props;
  const blocked = sectionProblem(section, props.includeDeleted);
  if (blocked && !section.locked && !section.encrypted) return null;
  const pages = section.pages.filter((p) => props.includeDeleted || !p.isInRecycleBin).length;
  return (
    <div className={`onenote-row section${blocked ? " locked" : ""}`} style={{ paddingLeft: props.depth * 18 + 26 }}>
      <label className="onenote-check grow">
        <input type="checkbox" disabled={!!blocked} checked={props.selected.has(section.id)} onChange={(event) => props.toggle([section], event.target.checked)} data-testid={`onenote-pick-${section.name}`} />
        <i className="onenote-dot" style={{ background: section.color ?? "var(--rule)" }} />
        <span className="onenote-name truncate">{section.name}</span>
      </label>
      {blocked ? <span className="meta onenote-lock"><Lock /> {blocked}</span> : <span className="meta">{tp(pages, "{count} page", "{count} pages")}</span>}
    </div>
  );
}

function Summary(props: { summary: ImportSummary; details: boolean; onDetails: () => void }) {
  const { summary } = props;
  return (
    <div className="onenote-summary" data-testid="onenote-summary">
      <h3>{summary.cancelled ? t("Stopped. What was done is kept.") : t("Import finished")}</h3>
      <ul>
        <li>{tp(summary.notebooks, "{count} notebook", "{count} notebooks")}, {tp(summary.sections, "{count} section", "{count} sections")}</li>
        <li>{tp(summary.pagesImported, "{count} page imported", "{count} pages imported")}</li>
        {summary.pagesUpdated > 0 && <li>{tp(summary.pagesUpdated, "{count} page updated", "{count} pages updated")}</li>}
        {summary.pagesKeptBoth > 0 && <li>{tp(summary.pagesKeptBoth, "{count} page changed in both places: OneNote's version was added after yours", "{count} pages changed in both places: OneNote's versions were added after yours")}</li>}
        {summary.pagesUnchanged > 0 && <li>{tp(summary.pagesUnchanged, "{count} page already up to date", "{count} pages already up to date")}</li>}
        {summary.pdfCopies > 0 && <li>{tp(summary.pdfCopies, "{count} page with a PDF copy as shown in OneNote", "{count} pages with a PDF copy as shown in OneNote")}</li>}
      </ul>
      {summary.skipped.length > 0 && (
        <>
          <h4>{t("Skipped")}</h4>
          <ul data-testid="onenote-skipped">{summary.skipped.map((s) => <li key={s.name}><strong>{s.name}</strong>: {s.reason}</li>)}</ul>
        </>
      )}
      {summary.warnings.length > 0 && (
        <>
          <p>
            {tp(summary.warnings.length, "{count} warning", "{count} warnings")}{" "}
            <button type="button" className="btn small flat" onClick={props.onDetails} data-testid="onenote-details">{props.details ? t("Hide details") : t("Show details")}</button>
          </p>
          {props.details && <ul className="onenote-warnings">{summary.warnings.map((w, i) => <li key={i}><strong>{w.where}</strong>: {w.message}</li>)}</ul>}
        </>
      )}
    </div>
  );
}
