// Printed words in scans and pictures, read by Windows and kept so search finds them. Best effort throughout: if the
// text can't be read, the picture is still there.

import type { NotebookDocument } from "../editor/document";
import type { Page } from "../model/notebook";
import { loadWords, saveWords } from "../storage/package";
import { useApp } from "../state/app";
import { ocrImage } from "./recognition";
import { mergeWordText, wordsKey } from "./words";

/** Puts the text read from a scanned page in the notebook's words cache. */
export async function storeScanText(doc: NotebookDocument, page: Page, text: string): Promise<void> {
  const clean = mergeWordText(text);
  if (!clean) return;
  const words = await loadWords(doc.fs, doc.id);
  const known = new Set(doc.manifest.pages.map((candidate) => candidate.id));
  for (const id of Object.keys(words.pages)) if (!known.has(id)) delete words.pages[id];
  words.pages[page.id] = { key: wordsKey(page), text: clean, scan: clean };
  await saveWords(doc.fs, doc.id, words);
}

/** Reads a scanned page's text and stores it. Never rejects. */
export async function readScannedPage(doc: NotebookDocument, page: Page, data: Uint8Array): Promise<void> {
  try {
    const result = await ocrImage(data, useApp.getState().settings.language);
    await storeScanText(doc, page, result.text);
  } catch {
    // Reading is a favour to search; without it the scan is just a picture.
  }
}

/** Reads a placed picture's text into the item's `text`, which search reads. Not an undo step: it is not something the user did. */
export async function readPictureText(doc: NotebookDocument, pageID: string, itemID: string, data: Uint8Array): Promise<void> {
  try {
    const result = await ocrImage(data, useApp.getState().settings.language);
    const text = mergeWordText(result.text);
    if (!text) return;
    doc.touch((manifest) => {
      const item = manifest.pages.find((page) => page.id === pageID)?.items.find((candidate) => candidate.id === itemID);
      if (item && item.kind === "image") item.text = text;
    });
  } catch {
    // The picture stays as it is.
  }
}
