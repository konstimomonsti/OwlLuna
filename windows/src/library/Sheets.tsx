// The small sheets of the library: tags, cover and smart shelf.

import { Check, Shuffle, X } from "lucide-react";
import { useState } from "react";
import { Segmented, Sheet } from "../design/controls";
import { t, tp } from "../i18n";
import { swatchName } from "../i18n/names";
import { uuid } from "../model/ids";
import { clothColors, clothHex, risoHex, risoPairs, type CoverSpec, type CoverStyle } from "../model/notebook";
import { allTags, changeNotebook, saveShelf, useApp } from "../state/app";
import type { SmartShelf } from "../storage/libraryFiles";
import { Cover } from "./Cover";

/** A tag as it will be kept: no leading #, one line, not too long. */
export function cleanTag(raw: string): string {
  return raw.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function TagsSheet(props: { ids: string[]; onClose: () => void }) {
  const manifests = useApp((state) => state.manifests);
  const single = props.ids.length === 1 ? manifests[props.ids[0]] : undefined;
  // For one notebook the sheet edits its tags; for several it only adds, so nobody's own tags are taken away.
  const [tags, setTags] = useState<string[]>(single ? single.tags : []);
  const [draft, setDraft] = useState("");
  const have = (tag: string) => tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase());
  const add = (raw: string) => {
    const tag = cleanTag(raw);
    if (tag && !have(tag)) setTags([...tags, tag]);
    setDraft("");
  };
  const suggestions = allTags(manifests).filter((tag) => !have(tag)).slice(0, 14);

  const save = async () => {
    const extra = cleanTag(draft);
    const chosen = extra && !have(extra) ? [...tags, extra] : tags;
    for (const id of props.ids) {
      await changeNotebook(id, (manifest) => {
        if (single) manifest.tags = chosen;
        else for (const tag of chosen) if (!manifest.tags.some((own) => own.toLowerCase() === tag.toLowerCase())) manifest.tags.push(tag);
      });
    }
    props.onClose();
  };

  return (
    <Sheet
      title={single ? t("Tags") : tp(props.ids.length, "Add Tags to {count} Notebook", "Add Tags to {count} Notebooks")}
      onClose={props.onClose}
      testid="tags-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="tags-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => void save()} data-testid="tags-save">{t("Save")}</button>
        </>
      }
    >
      <div>
        <label className="label" htmlFor="tag-input">{single ? t("Add a tag") : t("Tags to add")}</label>
        <input
          id="tag-input"
          className="field"
          autoFocus
          value={draft}
          placeholder={t("Type a tag and press Enter")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
          }}
          data-testid="tag-input"
        />
      </div>
      <div className="chip-list" data-testid="tag-chips">
        {tags.length === 0 && <span className="secondary">{t("No tags yet.")}</span>}
        {tags.map((tag) => (
          <span key={tag} className="tag" data-testid="tag-chip">
            {tag}
            <button type="button" aria-label={t("Remove {name}", { name: tag })} title={t("Remove")} onClick={() => setTags(tags.filter((candidate) => candidate !== tag))} data-testid="tag-remove"><X /></button>
          </span>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div>
          <span className="label">{t("In use elsewhere")}</span>
          <div className="chip-list">
            {suggestions.map((tag) => (
              <button key={tag} type="button" className="tag suggest" onClick={() => add(tag)} data-testid="tag-suggestion">+ {tag}</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function CoverSheet(props: { id: string; onClose: () => void }) {
  const manifest = useApp((state) => state.manifests[props.id]);
  const [cover, setCover] = useState<CoverSpec | null>(manifest ? manifest.cover : null);
  if (!manifest || !cover) return null;
  const patch = (change: Partial<CoverSpec>) => setCover({ ...cover, ...change });
  const save = async () => {
    await changeNotebook(props.id, (draft) => { draft.cover = cover; });
    props.onClose();
  };
  return (
    <Sheet
      title={t("Cover")}
      onClose={props.onClose}
      testid="cover-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="cover-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => void save()} data-testid="cover-save">{t("Done")}</button>
        </>
      }
    >
      <div className="cover-preview">
        <Cover title={manifest.title} cover={cover} whiteboard={manifest.kind === "whiteboard"} manifest={{ ...manifest, cover }} locked={manifest.locked} />
        <div className="options">
          <div>
            <span className="label">{t("Style")}</span>
            <Segmented<CoverStyle>
              label={t("Cover style")}
              value={cover.style}
              onChange={(style) => patch({ style })}
              options={[{ value: "cloth", label: t("Cloth") }, { value: "print", label: t("Print") }, { value: "firstPage", label: t("First Page") }]}
            />
          </div>
          {cover.style === "print" ? (
            <>
              <div>
                <span className="label">{t("Inks")}</span>
                <div className="swatches" role="group" aria-label={t("Ink pair")}>
                  {risoPairs.map((pair) => {
                    const on = pair[0] === cover.inks[0] && pair[1] === cover.inks[1];
                    return (
                      <button
                        key={pair.join("-")}
                        type="button"
                        className={`swatch riso${on ? " on" : ""}`}
                        style={{ background: `linear-gradient(90deg, ${risoHex[pair[0]]} 50%, ${risoHex[pair[1]]} 50%)` }}
                        title={t("{a} and {b}", { a: swatchName(pair[0]), b: swatchName(pair[1]) })}
                        aria-label={t("{a} and {b}", { a: swatchName(pair[0]), b: swatchName(pair[1]) })}
                        aria-pressed={on}
                        onClick={() => patch({ inks: pair })}
                        data-testid={`cover-ink-${pair.join("-")}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <button type="button" className="btn small" onClick={() => patch({ seed: Math.floor(Math.random() * 0xffffffff) >>> 0 })} data-testid="cover-shuffle">
                  <Shuffle /> {t("Shuffle pattern")}
                </button>
              </div>
            </>
          ) : (
            <div>
              <span className="label">{cover.style === "firstPage" ? t("Spine colour") : t("Cloth colour")}</span>
              <div className="swatches" role="group" aria-label={t("Cloth colour")}>
                {clothColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch${color === cover.cloth ? " on" : ""}`}
                    style={{ background: clothHex[color] }}
                    title={swatchName(color)}
                    aria-label={swatchName(color)}
                    aria-pressed={color === cover.cloth}
                    onClick={() => patch({ cloth: color })}
                    data-testid={`cover-cloth-${color}`}
                  />
                ))}
              </div>
            </div>
          )}
          {manifest.locked && cover.style === "firstPage" && <p className="meta">{t("A locked notebook never shows its first page.")}</p>}
        </div>
      </div>
    </Sheet>
  );
}

export function ShelfSheet(props: { shelf?: SmartShelf; onClose: () => void }) {
  const manifests = useApp((state) => state.manifests);
  const [name, setName] = useState(props.shelf?.name ?? "");
  const [tags, setTags] = useState<string[]>(props.shelf?.tags ?? []);
  const [match, setMatch] = useState<"all" | "any">(props.shelf?.match ?? "all");
  const tagList = allTags(manifests);
  // A shelf keeps naming a tag even after the last notebook with it goes, so it can still be unticked.
  const shown = [...tagList, ...tags.filter((tag) => !tagList.some((known) => known.toLowerCase() === tag.toLowerCase()))];
  const on = (tag: string) => tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase());
  const toggle = (tag: string) => setTags(on(tag) ? tags.filter((candidate) => candidate.toLowerCase() !== tag.toLowerCase()) : [...tags, tag]);
  const save = async () => {
    await saveShelf({ id: props.shelf?.id ?? uuid(), name: name.trim() || t("Smart Shelf"), tags, match });
    props.onClose();
  };
  return (
    <Sheet
      title={props.shelf ? t("Edit Smart Shelf") : t("New Smart Shelf")}
      onClose={props.onClose}
      testid="shelf-sheet"
      foot={
        <>
          <button type="button" className="btn" onClick={props.onClose} data-testid="shelf-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={tags.length === 0} data-testid="shelf-save">{t("Save")}</button>
        </>
      }
    >
      <div>
        <label className="label" htmlFor="shelf-name">{t("Name")}</label>
        <input id="shelf-name" className="field" autoFocus value={name} placeholder={t("Smart Shelf")} onChange={(event) => setName(event.target.value)} data-testid="shelf-name" />
      </div>
      <div>
        <span className="label">{t("Notebooks with")}</span>
        <Segmented<"all" | "any"> label={t("Match")} value={match} onChange={setMatch} options={[{ value: "all", label: t("All of the tags") }, { value: "any", label: t("Any of the tags") }]} />
      </div>
      <div>
        <span className="label">{t("Tags")}</span>
        {shown.length === 0 ? (
          <p className="secondary">{t("No notebook has a tag yet. Add tags from a notebook's menu first.")}</p>
        ) : (
          <div className="plate" role="group" aria-label={t("Tags")}>
            {shown.map((tag) => (
              <button key={tag} type="button" role="checkbox" aria-checked={on(tag)} className="check-row" onClick={() => toggle(tag)} data-testid="shelf-tag">
                <span className="box"><Check /></span>
                <span className="truncate">{tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
