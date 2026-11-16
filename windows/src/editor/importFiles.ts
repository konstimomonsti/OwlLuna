// The ways files come into the app: picked from a menu or dropped on the library. Shows progress and says what went wrong.

import { notify, openNotebook, registerManifest, useApp } from "../state/app";
import { pickFiles } from "../platform/host";
import { appendPdf, appendPictures, importPdf, importPictures, isPdfName, isPictureName, titleOfFile, type PickedFileLike } from "../services/pdfImport";

const PDFS = [{ name: "PDF", extensions: ["pdf"] }];
const PICTURES = [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];

function progress(label: string) {
  let last = 0;
  return (done: number, total: number, what: string) => {
    // A notice is only worth showing for work that takes a while.
    const now = Date.now();
    if (total > 3 && now - last > 1500) {
      last = now;
      notify(`${label}: ${what} ${done} of ${total}…`);
    }
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "That couldn't be imported.";
}

/** Imports PDFs and pictures into the library. PDFs make a notebook each; pictures together make one. Opens the result when there is one. */
export async function importFilesIntoLibrary(files: PickedFileLike[]): Promise<void> {
  const fs = useApp.getState().fs;
  const pdfs = files.filter((file) => isPdfName(file.name));
  const pictures = files.filter((file) => isPictureName(file.name));
  if (pdfs.length === 0 && pictures.length === 0) {
    notify("Only PDFs and pictures can be imported.", "trouble");
    return;
  }
  let opened: string | null = null;
  let made = 0;
  for (const file of pdfs) {
    try {
      const manifest = await importPdf(fs, file.data, file.name, progress(`Importing ${titleOfFile(file.name)}`));
      registerManifest(manifest);
      opened = manifest.id;
      made++;
    } catch (error) {
      notify(`${titleOfFile(file.name)}: ${message(error)}`, "trouble");
    }
  }
  if (pictures.length) {
    try {
      const manifest = await importPictures(fs, pictures, pictures.length === 1 ? pictures[0].name : "Pictures", progress("Importing pictures"));
      registerManifest(manifest);
      opened = manifest.id;
      made++;
    } catch (error) {
      notify(message(error), "trouble");
    }
  }
  if (made > 1) notify(`${made} notebooks imported.`);
  else if (opened) await openNotebook(opened);
}

export async function pickAndImportPdf(): Promise<void> {
  const files = await pickFiles(PDFS, true);
  if (files.length) await importFilesIntoLibrary(files);
}

export async function pickAndImportPictures(): Promise<void> {
  const files = await pickFiles(PICTURES, true);
  if (files.length) await importFilesIntoLibrary(files);
}

/** Files dropped on the library window. */
export async function importDropped(dropped: File[]): Promise<void> {
  const files: PickedFileLike[] = [];
  for (const file of dropped) files.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  await importFilesIntoLibrary(files);
}

/** Adds the pages of a picked PDF to an open notebook after a page. */
export async function addPdfPagesTo(doc: Parameters<typeof appendPdf>[0], afterPageID: string): Promise<string | null> {
  const [file] = await pickFiles(PDFS, false);
  if (!file) return null;
  try {
    const pages = await appendPdf(doc, file.data, afterPageID, progress("Adding PDF"));
    notify(pages.length === 1 ? "Added 1 page." : `Added ${pages.length} pages.`);
    return pages[0]?.id ?? null;
  } catch (error) {
    notify(message(error), "trouble");
    return null;
  }
}

/** Adds a picked picture to an open notebook as a page after a page. */
export async function addPicturePageTo(doc: Parameters<typeof appendPictures>[0], afterPageID: string): Promise<string | null> {
  const files = await pickFiles(PICTURES, true);
  if (!files.length) return null;
  try {
    const pages = await appendPictures(doc, files, afterPageID);
    return pages[0]?.id ?? null;
  } catch (error) {
    notify(message(error), "trouble");
    return null;
  }
}
