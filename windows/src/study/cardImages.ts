// A card's clippings live in the notebook's `cards/` folder, apart from `assets/` so the sweep of unused pictures leaves them be.

import { uuid } from "../model/ids";
import type { FS } from "../platform/fs";
import { packageDir } from "../storage/package";

export function cardImagePath(id: string, file: string): string {
  return `${packageDir(id)}/cards/${file}`;
}

/** Keeps a PNG in the notebook's `cards/` folder and returns its file name. */
export async function addCardImage(fs: FS, id: string, data: Uint8Array): Promise<string> {
  const name = `${uuid()}.png`;
  await fs.write(cardImagePath(id, name), data);
  return name;
}

export function readCardImage(fs: FS, id: string, file: string): Promise<Uint8Array | null> {
  return fs.read(cardImagePath(id, file));
}

export async function removeCardImage(fs: FS, id: string, file: string | undefined): Promise<void> {
  if (!file) return;
  try {
    await fs.remove(cardImagePath(id, file));
  } catch {
    // A clipping left behind costs only space.
  }
}
