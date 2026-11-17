// Making cards from a notebook: a strip of study tape becomes a card whose back is what the tape hides, and selected
// handwriting becomes the front of a card.

import { itemBounds } from "../canvas/board";
import { pageRegion, renderPageToCanvas } from "../canvas/thumbnail";
import type { NotebookDocument } from "../editor/document";
import { inkBounds, type Rect, type Stroke } from "../model/ink";
import { newCard, type CardSide, type Flashcard } from "../model/flashcard";
import type { Page } from "../model/notebook";
import { notify, useApp } from "../state/app";
import { ocrImage, recogniseInk, recognitionAvailable } from "../services/recognition";
import { addCardImage } from "./cardImages";
import { addCard, cardForTape, ensureCards, requestEdit, updateCard } from "./cardStore";
import { CLIP_SCALE, INK_MARGIN, padRect, pixelRect, tapeClips } from "./clip";
import { t } from "../i18n";

/** The part of a rendered page that holds `rect`, as PNG bytes. Null when the rectangle is off the page. */
async function clipPNG(doc: NotebookDocument, page: Page, strokes: Stroke[], rect: Rect, options: { items: boolean; tapes: "none" | string }): Promise<Uint8Array | null> {
  // Tape is a page item; the clipping shows none, or only the one asked for.
  const items = page.items.filter((item) => item.kind !== "tape" || item.id === options.tapes);
  const shown: Page = { ...page, items };
  const canvas = await renderPageToCanvas(doc.fs, doc.id, shown, strokes, CLIP_SCALE, { items: options.items, manifest: doc.manifest });
  const region = pageRegion(shown, strokes);
  const box = pixelRect(region, rect, canvas);
  if (!box) return null;
  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Words in a clipping, read in the background and put on the card. Never blocks and never complains. */
function readWords(doc: NotebookDocument, card: Flashcard, side: "front" | "back", read: () => Promise<string>): void {
  void (async () => {
    if (!(await recognitionAvailable())) return;
    const text = (await read()).trim();
    if (text) await updateCard(doc.fs, doc.id, card.id, (current) => ({ ...current, [side]: { ...current[side], imageText: text } }));
  })().catch(() => {});
}

function language(): string | undefined {
  return useApp.getState().settings.language;
}

/**
 * A card from a strip of study tape. The back is the page under the tape without it; the front is the same place with
 * 60 points of page round it and the tape on. A tape that already has a card opens that card instead.
 */
export async function cardFromTape(doc: NotebookDocument, pageID: string, tapeID: string): Promise<void> {
  await ensureCards(doc.fs, doc.id);
  const existing = cardForTape(doc.id, tapeID);
  if (existing) {
    requestEdit(doc.id, existing.id);
    return;
  }
  const page = doc.page(pageID);
  const tape = page?.items.find((item) => item.id === tapeID);
  if (!page || !tape) return;
  try {
    const strokes = await doc.ensureInk(pageID);
    const { back, front } = tapeClips(itemBounds(tape));
    const backPNG = await clipPNG(doc, page, strokes, back, { items: true, tapes: "none" });
    const frontPNG = await clipPNG(doc, page, strokes, front, { items: true, tapes: tapeID });
    if (!backPNG || !frontPNG) throw new Error(t("The tape is not on the page."));
    const card = newCard(
      { text: "", image: await addCardImage(doc.fs, doc.id, frontPNG) },
      { text: "", image: await addCardImage(doc.fs, doc.id, backPNG) },
      { pageID, tapeID },
    );
    await addCard(doc.fs, doc.id, card);
    notify(t("Card made from the tape."), "info", { label: t("Open"), run: () => requestEdit(doc.id, card.id) });
    readWords(doc, card, "back", async () => (await ocrImage(backPNG, language())).text);
  } catch (error) {
    notify(t("The card couldn't be made: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
  }
}

/** A card whose front is the selected handwriting. The back starts empty, and the card opens to be filled in. */
export async function cardFromInk(doc: NotebookDocument, pageID: string, strokeIDs: string[]): Promise<void> {
  const page = doc.page(pageID);
  if (!page) return;
  await ensureCards(doc.fs, doc.id);
  try {
    const wanted = new Set(strokeIDs);
    const chosen = doc.ink(pageID).filter((stroke) => wanted.has(stroke.id));
    const bounds = inkBounds(chosen);
    if (!bounds) return;
    const png = await clipPNG(doc, page, chosen, padRect(bounds, INK_MARGIN), { items: false, tapes: "none" });
    if (!png) throw new Error(t("The writing is not on the page."));
    const front: CardSide = { text: "", image: await addCardImage(doc.fs, doc.id, png) };
    const card = newCard(front, { text: "" }, { pageID });
    await addCard(doc.fs, doc.id, card);
    requestEdit(doc.id, card.id);
    readWords(doc, card, "front", async () => (await recogniseInk(chosen, language())).text);
  } catch (error) {
    notify(t("The card couldn't be made: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
  }
}
