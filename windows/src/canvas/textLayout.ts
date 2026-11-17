// How a text box reads: its lines with their list markers, and the formulas inside them. Shared by the page,
// the exports and search, so they agree.

import type { TextFace, TextItem } from "../model/notebook";

export interface TextLine {
  /** "•", "3." or a checkbox; null for plain text and for the empty lines of a list. */
  marker: string | null;
  /** On a checklist: whether the line is ticked. */
  checked: boolean | null;
  text: string;
  index: number;
}

export function textLines(item: Pick<TextItem, "string" | "list" | "checked">): TextLine[] {
  const ticked = new Set(item.checked ?? []);
  let number = 0;
  return item.string.split("\n").map((text, index) => {
    const blank = text.trim() === "";
    if (!item.list || blank) return { marker: null, checked: null, text, index };
    if (item.list === "bullet") return { marker: "•", checked: null, text, index };
    if (item.list === "number") return { marker: `${++number}.`, checked: null, text, index };
    return { marker: ticked.has(index) ? "☑" : "☐", checked: ticked.has(index), text, index };
  });
}

export interface TextRun {
  math: boolean;
  text: string;
}

/** Splits a line at its formulas: `$x^2$`. A dollar after a backslash is a dollar. */
export function mathRuns(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let plain = "";
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "$") {
      plain += "$";
      index += 2;
      continue;
    }
    if (char === "$") {
      let end = index + 1;
      while (end < line.length && !(line[end] === "$" && line[end - 1] !== "\\")) end++;
      const body = line.slice(index + 1, end);
      if (end < line.length && body.trim() !== "") {
        if (plain) runs.push({ math: false, text: plain });
        plain = "";
        runs.push({ math: true, text: body });
        index = end + 1;
        continue;
      }
    }
    plain += char;
    index++;
  }
  if (plain || runs.length === 0) runs.push({ math: false, text: plain });
  return runs;
}

/** The box as plain words, for search, text export and Markdown. */
export function plainText(item: Pick<TextItem, "string" | "list" | "checked">, markdown = false): string {
  return textLines(item).map((line) => {
    if (line.marker === null) return line.text;
    if (!markdown) return `${line.marker} ${line.text}`;
    if (line.checked !== null) return `- [${line.checked ? "x" : " "}] ${line.text}`;
    return line.marker === "•" ? `- ${line.text}` : `${line.marker} ${line.text}`;
  }).join("\n");
}

export const faceCSS: Record<TextFace, string> = {
  system: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", monospace',
  fraunces: '"Fraunces", Georgia, serif',
};

export const LINE_HEIGHT = 1.35;

/** Breaks text to a width, a word at a time, measuring with `measure`. Long words are cut. */
export function wrapLine(text: string, width: number, measure: (text: string) => number): string[] {
  if (text === "") return [""];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  const pushLong = (word: string) => {
    let piece = "";
    for (const char of word) {
      if (piece && measure(piece + char) > width) {
        lines.push(piece);
        piece = "";
      }
      piece += char;
    }
    current = piece;
  };
  for (const word of words) {
    if (word === "") continue;
    if (measure(current + word) <= width) {
      current += word;
    } else if (/^\s+$/.test(word)) {
      lines.push(current);
      current = "";
    } else {
      if (current.trim() !== "") lines.push(current.trimEnd());
      current = "";
      if (measure(word) > width) pushLong(word);
      else current = word;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}
