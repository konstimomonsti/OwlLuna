// The arithmetic of cropping a picture, apart from the screen that shows it.

import type { PictureItem } from "../model/notebook";

export type Crop = [number, number, number, number];

export const MIN_CROP = 0.04;

/** Clamps a crop to the picture and keeps it from collapsing. */
export function clampCrop(crop: Crop): Crop {
  let [x, y, w, h] = crop;
  w = Math.min(Math.max(w, MIN_CROP), 1);
  h = Math.min(Math.max(h, MIN_CROP), 1);
  x = Math.min(Math.max(x, 0), 1 - w);
  y = Math.min(Math.max(y, 0), 1 - h);
  return [x, y, w, h];
}

/**
 * The item as it is once cropped to `next`: the picture keeps its scale and stays where it was on the page, so
 * the part still shown does not move. The new centre is the old one shifted by how far the visible middle moved
 * inside the picture, turned with the item.
 */
export function croppedItem(item: PictureItem, next: Crop): PictureItem {
  const [cx, cy, cw, ch] = item.crop ?? [0, 0, 1, 1];
  const W = item.w / cw, H = item.h / ch;
  const dx = (next[0] + next[2] / 2 - (cx + cw / 2)) * W, dy = (next[1] + next[3] / 2 - (cy + ch / 2)) * H;
  const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
  const full = next[0] <= 0.0005 && next[1] <= 0.0005 && next[2] >= 0.9995 && next[3] >= 0.9995;
  const out: PictureItem = { ...item, w: next[2] * W, h: next[3] * H, x: item.x + dx * cos - dy * sin, y: item.y + dx * sin + dy * cos, crop: full ? undefined : next };
  if (full) delete out.crop;
  return out;
}

