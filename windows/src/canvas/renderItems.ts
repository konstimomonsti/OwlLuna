// A page's items drawn into a 2D context, for thumbnails, export and printing. Mirrors ItemsLayer, which does the
// same with elements on screen.

import { highlightHex, tapeHex, textTintHex, type LinkItem, type Manifest, type Page, type PageItem, type PictureItem, type TapeItem, type TextItem } from "../model/notebook";
import { isDarkPaper } from "../model/paper";
import type { FS } from "../platform/fs";
import { backdrops } from "./backdrops";
import type { Picture } from "./renderPage";
import { stickerDataURL, stickerNamed } from "./stickers";
import { faceCSS, LINE_HEIGHT, mathRuns, textLines, wrapLine } from "./textLayout";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const stickerImages = new Map<string, Promise<HTMLImageElement | null>>();

function stickerImage(name: string): Promise<HTMLImageElement | null> {
  let pending = stickerImages.get(name);
  if (!pending) {
    const sticker = stickerNamed(name);
    pending = sticker
      ? new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = stickerDataURL(sticker);
        })
      : Promise.resolve(null);
    stickerImages.set(name, pending);
  }
  return pending;
}

/** What a link chip says. Without a document to ask, so it works for notebooks that are not open. */
export function linkText(item: LinkItem, manifest: Pick<Manifest, "pages">): string {
  if (item.label.trim()) return item.label;
  if (item.target.to === "web") {
    try {
      return new URL(item.target.url).hostname.replace(/^www\./, "");
    } catch {
      return item.target.url;
    }
  }
  if (item.target.to === "notebook") return item.target.name;
  const target = item.target;
  const index = manifest.pages.findIndex((page) => page.id === target.page);
  return index === -1 ? "Missing page" : `Page ${index + 1}`;
}

function turned(ctx: Ctx, item: PageItem, draw: () => void): void {
  ctx.save();
  ctx.translate(item.x, item.y);
  if (item.rotation) ctx.rotate(item.rotation);
  ctx.translate(-item.w / 2, -item.h / 2);
  draw();
  ctx.restore();
}

function drawPicture(ctx: Ctx, item: PictureItem, picture: Picture): void {
  const [cx, cy, cw, ch] = item.crop ?? [0, 0, 1, 1];
  turned(ctx, item, () => {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(picture, cx * picture.width, cy * picture.height, cw * picture.width, ch * picture.height, 0, 0, item.w, item.h);
  });
}

function drawText(ctx: Ctx, item: TextItem, dark: boolean): void {
  const tint = item.tint ?? "ink";
  const colour = tint === "ink" && dark ? "#ECE6DA" : textTintHex[tint];
  const size = item.fontSize;
  const font = (italic: boolean) => `${italic || item.italic ? "italic " : ""}${item.bold ? 700 : 400} ${size}px ${faceCSS[item.face ?? "system"]}`;
  turned(ctx, item, () => {
    ctx.textBaseline = "alphabetic";
    const lineHeight = size * LINE_HEIGHT;
    const gap = size * 0.45;
    let y = 0;
    for (const line of textLines(item)) {
      const marker = line.marker;
      ctx.font = font(false);
      const indent = marker !== null ? Math.max(ctx.measureText(marker).width, size) + gap : 0;
      const room = Math.max(item.w - indent, 8);
      // Formulas are drawn as their source, in italics: good enough away from the screen.
      const runs = mathRuns(line.text);
      const measure = (text: string) => { ctx.font = font(false); return ctx.measureText(text).width; };
      const rows = wrapLine(runs.map((run) => run.text).join(""), room, measure);
      const sources = runs.filter((run) => run.math).map((run) => run.text);
      rows.forEach((row, rowIndex) => {
        const baseline = y + lineHeight * 0.5 + size * 0.32;
        ctx.globalAlpha = line.checked ? 0.55 : 1;
        if (marker !== null && rowIndex === 0) {
          ctx.font = font(false);
          ctx.fillStyle = colour;
          ctx.textAlign = "left";
          ctx.fillText(marker, 0, baseline);
        }
        ctx.font = font(sources.some((source) => row.includes(source)));
        const width = ctx.measureText(row).width;
        const left = indent + (item.align === "center" ? (room - width) / 2 : item.align === "trailing" ? room - width : 0);
        if (item.highlight && row.trim()) {
          ctx.fillStyle = `${highlightHex[item.highlight]}66`;
          ctx.fillRect(left, y, width, lineHeight);
        }
        ctx.fillStyle = colour;
        ctx.textAlign = "left";
        ctx.fillText(row, left, baseline);
        if (item.underline || line.checked) {
          ctx.fillRect(left, line.checked ? y + lineHeight / 2 : baseline + size * 0.12, width, Math.max(size / 14, 0.8));
        }
        y += lineHeight;
        ctx.globalAlpha = 1;
      });
    }
  });
}

function drawLink(ctx: Ctx, item: LinkItem, manifest: Pick<Manifest, "pages">): void {
  turned(ctx, item, () => {
    ctx.fillStyle = "#F7F1E3";
    ctx.fillRect(0, 0, item.w, item.h);
    ctx.strokeStyle = "rgba(27,34,48,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, item.w - 1, item.h - 1);
    const size = Math.min(Math.max(item.h * 0.48, 9), 15);
    ctx.font = `600 ${size}px ${faceCSS.system}`;
    ctx.fillStyle = "#2747B8";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, item.w, item.h);
    ctx.clip();
    const text = linkText(item, manifest);
    ctx.fillText(text, 8, item.h / 2);
    ctx.fillRect(8, item.h / 2 + size * 0.5, Math.min(ctx.measureText(text).width, item.w - 16), 1);
    ctx.restore();
  });
}

function drawTape(ctx: Ctx, item: TapeItem): void {
  const colour = tapeHex[item.color];
  turned(ctx, item, () => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, item.w, item.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, item.w, item.h);
    ctx.clip();
    ctx.fillStyle = `${colour}DD`;
    for (let x = 7; x < item.w + item.h; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 7, 0);
      ctx.lineTo(x + 7 - item.h, item.h);
      ctx.lineTo(x - item.h, item.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(27,34,48,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, item.w - 1, item.h - 1);
  });
}

/**
 * Draws a page's items into a context already scaled to page points. "under" is pictures, stickers, text and links;
 * "over" is the study tape, except what is lifted.
 */
export async function drawItems(
  ctx: Ctx, fs: FS, notebookID: string, page: Page, layer: "under" | "over", lifted: Set<string> = new Set(),
  manifest: Pick<Manifest, "pages"> = { pages: [page] },
): Promise<void> {
  const dark = page.background.kind === "template" && isDarkPaper(page.paperColor);
  for (const item of page.items as PageItem[]) {
    if (layer === "over") {
      if (item.kind === "tape" && !lifted.has(item.id)) drawTape(ctx, item);
      continue;
    }
    switch (item.kind) {
      case "image": {
        const picture = await backdrops.pictureReady(fs, notebookID, item.file);
        if (picture) drawPicture(ctx, item, picture);
        break;
      }
      case "sticker": {
        const image = await stickerImage(item.name);
        if (image) turned(ctx, item, () => ctx.drawImage(image, 0, 0, item.w, item.h));
        break;
      }
      case "text": drawText(ctx, item, dark); break;
      case "link": drawLink(ctx, item, manifest); break;
      case "tape": break;
    }
  }
}

/** Text marks on a PDF page: translucent bands multiplied into the page, so the text under them stays readable. */
export function drawMarks(ctx: Ctx, page: Page): void {
  if (!page.marks?.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (const mark of page.marks) {
    ctx.fillStyle = `${highlightHex[mark.color]}99`;
    for (const [x, y, w, h] of mark.rects) ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}
