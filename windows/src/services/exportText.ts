// Notes as words: plain text or Markdown, page by page. Typed text in reading order, what was highlighted in a PDF, links
// with their targets, checklists with their ticks, and handwriting where it has been read. Pure.

import { plainText } from "../canvas/textLayout";
import type { LinkItem, Manifest, Page, PageItem } from "../model/notebook";
import { t } from "../i18n";

export interface TextExportOptions {
  markdown: boolean;
  /** Recognised handwriting by page, from the words cache. */
  words?: Record<string, { text: string }>;
}

function linkLine(item: LinkItem, manifest: Pick<Manifest, "pages">, markdown: boolean): string {
  const target = item.target;
  const label = item.label.trim();
  if (target.to === "web") {
    const text = label || target.url;
    return markdown ? `[${text}](${target.url})` : label ? `${label} (${target.url})` : target.url;
  }
  if (target.to === "page") {
    const index = manifest.pages.findIndex((page) => page.id === target.page);
    const text = label || (index === -1 ? t("Missing page") : t("Page {number}", { number: index + 1 }));
    if (index === -1) return text;
    return markdown ? `[${text}](#page-${index + 1})` : `${text} (page ${index + 1})`;
  }
  const text = label || target.name;
  return label && label !== target.name ? `${text} (notebook: ${target.name})` : `${text} (notebook)`;
}

/** The items that carry words, top to bottom and left to right. */
function readingOrder(items: PageItem[]): PageItem[] {
  return [...items].sort((a, b) => Math.round((a.y - a.h / 2) / 8) - Math.round((b.y - b.h / 2) / 8) || a.x - b.x);
}

/** The words of one page: blocks separated by a blank line. */
export function pageBlocks(page: Page, manifest: Pick<Manifest, "pages">, options: TextExportOptions): string[] {
  const blocks: string[] = [];
  for (const item of readingOrder(page.items)) {
    if (item.kind === "text") {
      const text = plainText(item, options.markdown).trimEnd();
      if (text.trim()) blocks.push(text);
    } else if (item.kind === "link") {
      blocks.push(linkLine(item, manifest, options.markdown));
    } else if (item.kind === "image" && item.text?.trim()) {
      blocks.push(options.markdown ? `*${t("Picture:")}* ${item.text.trim()}` : `${t("Picture:")} ${item.text.trim()}`);
    }
  }
  for (const mark of page.marks ?? []) {
    if (!mark.text.trim()) continue;
    blocks.push(options.markdown ? `> ${mark.text.trim()}` : `${t("Highlighted:")} ${mark.text.trim()}`);
  }
  // A PDF page's cached words are the PDF's own text, which is not the notes; only handwriting is wanted here.
  const handwriting = page.background.kind === "pdf" ? "" : options.words?.[page.id]?.text?.trim() ?? "";
  if (handwriting) blocks.push(options.markdown ? `*Handwriting:* ${handwriting}` : handwriting);
  return blocks;
}

/** The text of the chosen pages, with the notebook's title first. Pages with nothing to say are still named, so numbers stay true. */
export function exportText(manifest: Pick<Manifest, "title" | "pages">, pageIDs: string[], options: TextExportOptions): string {
  const out: string[] = [options.markdown ? `# ${manifest.title}` : manifest.title];
  for (const id of pageIDs) {
    const index = manifest.pages.findIndex((page) => page.id === id);
    if (index === -1) continue;
    const blocks = pageBlocks(manifest.pages[index], manifest, options);
    out.push([options.markdown ? `## ${t("Page {number}", { number: index + 1 })}` : t("Page {number}", { number: index + 1 }), ...(blocks.length ? [""] : []), blocks.join("\n\n")].join("\n").trimEnd());
  }
  return out.join("\n\n") + "\n";
}
