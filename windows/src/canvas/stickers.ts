// Forty vector stickers: pastel paper with a deeper edge, and a shadow of layered tints rather than a blur, so they
// stay vector in a PDF. Each is drawn in a 64 by 64 box.

import { tn } from "../i18n";

export interface Sticker {
  name: string;
  label: string;
  svg: string;
}

const papers = {
  butter: ["#FBE9A9", "#D9B84A"],
  rose: ["#F6C9C4", "#CF8A84"],
  sage: ["#CFE0C6", "#8FAE83"],
  sky: ["#C8DEF2", "#7FA6CC"],
  lilac: ["#DDD0EE", "#A58FC7"],
  peach: ["#FAD3B2", "#D99A63"],
} as const;
type Paper = keyof typeof papers;

const INK = "#1B2230";

function tile(paper: Paper, shape: "round" | "square" | "tag", glyph: string): string {
  const [fill, edge] = papers[paper];
  const body = shape === "round"
    ? `<circle cx="32" cy="32" r="27"`
    : shape === "tag"
      ? `<path d="M6 16h40l12 16-12 16H6z"`
      : `<rect x="6" y="6" width="52" height="52" rx="7"`;
  const shadow = (dx: number, opacity: number) => `${body} transform="translate(${dx} ${dx})" fill="#1B2230" opacity="${opacity}"/>`;
  return `${shadow(2.4, 0.06)}${shadow(1.4, 0.08)}${body} fill="${fill}" stroke="${edge}" stroke-width="1.5"/>${glyph}`;
}

const line = (d: string, width = 3.2) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const solid = (d: string, fill = INK) => `<path d="${d}" fill="${fill}"/>`;
const word = (text: string, size = 15, y = 37.5, x = 30) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="Archivo, 'Segoe UI', sans-serif" font-weight="800" font-size="${size}" fill="${INK}">${text}</text>`;
const dot = (cx: number, cy: number, r: number, fill = INK) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

const star = "M32 14l5.3 11.2 12.2 1.6-9 8.5 2.3 12.1L32 41.5l-10.8 5.9 2.3-12.1-9-8.5 12.2-1.6z";
const heart = "M32 47S16 37.5 16 26.5C16 21 20 17 25 17c3 0 5.6 1.6 7 4 1.4-2.4 4-4 7-4 5 0 9 4 9 9.5C48 37.5 32 47 32 47z";

export const stickers: Sticker[] = [
  { name: "star", label: tn("Star"), svg: tile("butter", "round", solid(star, "#C9452F")) },
  { name: "heart", label: tn("Heart"), svg: tile("rose", "round", solid(heart, "#C9452F")) },
  { name: "check", label: tn("Tick"), svg: tile("sage", "round", line("M20 33l8 8 16-18", 4.5)) },
  { name: "cross", label: tn("Cross"), svg: tile("rose", "round", line("M22 22l20 20M42 22L22 42", 4.5)) },
  { name: "exclaim", label: tn("Important"), svg: tile("peach", "round", line("M32 17v19", 5) + dot(32, 45, 3)) },
  { name: "question", label: tn("Question"), svg: tile("sky", "round", line("M24 25c0-5 3.5-8 8-8s8 3 8 7.5c0 6-8 6-8 12", 4.2) + dot(32, 46, 2.8)) },
  { name: "arrow-right", label: tn("Arrow Right"), svg: tile("sky", "square", line("M17 32h30M36 21l11 11-11 11", 4.2)) },
  { name: "arrow-left", label: tn("Arrow Left"), svg: tile("sky", "square", line("M47 32H17M28 21L17 32l11 11", 4.2)) },
  { name: "arrow-up", label: tn("Arrow Up"), svg: tile("sage", "square", line("M32 47V17M21 28l11-11 11 11", 4.2)) },
  { name: "arrow-down", label: tn("Arrow Down"), svg: tile("peach", "square", line("M32 17v30M21 36l11 11 11-11", 4.2)) },
  { name: "idea", label: tn("Idea"), svg: tile("butter", "square", line("M25 37c-3-2.5-5-6-5-10a12 12 0 0124 0c0 4-2 7.5-5 10v4H25zM27 47h10")) },
  { name: "flag", label: tn("Flag"), svg: tile("rose", "square", line("M22 48V17") + solid("M22 18h22l-5 8 5 8H22z", "#C9452F")) },
  { name: "pin", label: tn("Pin"), svg: tile("peach", "round", solid("M32 49S20 36 20 28a12 12 0 0124 0c0 8-12 21-12 21z", "#C9452F") + dot(32, 28, 4.5, "#FAD3B2")) },
  { name: "bookmark", label: tn("Bookmark"), svg: tile("lilac", "square", solid("M22 15h20v34l-10-8-10 8z", "#5A2F52")) },
  { name: "clock", label: tn("Clock"), svg: tile("sky", "round", `<circle cx="32" cy="32" r="16" fill="none" stroke="${INK}" stroke-width="3.2"/>` + line("M32 22v10l7 5")) },
  { name: "calendar", label: tn("Date"), svg: tile("sage", "square", line("M17 21h30v27H17zM17 29h30M25 16v8M39 16v8") + dot(26, 37, 2.2) + dot(32, 37, 2.2) + dot(38, 37, 2.2)) },
  { name: "sun", label: tn("Sun"), svg: tile("butter", "round", dot(32, 32, 8, "#E07A1F") + line("M32 14v5M32 45v5M14 32h5M45 32h5M19.5 19.5l3.5 3.5M41 41l3.5 3.5M44.5 19.5L41 23M23 41l-3.5 3.5", 3)) },
  { name: "moon", label: tn("Moon"), svg: tile("lilac", "round", solid("M39 44a15 15 0 01-9-27 13 13 0 1014 26 15 15 0 01-5 1z", "#5A2F52")) },
  { name: "cloud", label: tn("Cloud"), svg: tile("sky", "square", line("M22 42a8 8 0 01-1-16 11 11 0 0121-2 9 9 0 012 18z")) },
  { name: "bolt", label: tn("Energy"), svg: tile("butter", "square", solid("M35 13L19 35h11l-3 16 18-24H33z", "#E07A1F")) },
  { name: "flame", label: tn("Hot"), svg: tile("peach", "round", solid("M32 49c-8 0-13-5-13-12 0-6 5-9 6-15 5 3 6 6 6 9 3-2 4-6 3-11 7 4 11 10 11 17 0 7-5 12-13 12z", "#C9452F")) },
  { name: "leaf", label: tn("Leaf"), svg: tile("sage", "round", solid("M18 46c0-16 10-27 28-28 0 17-9 28-24 28z", "#3D5A40") + line("M19 46l16-17", 2.4)) },
  { name: "flower", label: tn("Flower"), svg: tile("rose", "round", [0, 72, 144, 216, 288].map((angle) => `<ellipse cx="32" cy="21" rx="6.5" ry="9" fill="#D9578C" transform="rotate(${angle} 32 32)"/>`).join("") + dot(32, 32, 5, "#E8B023")) },
  { name: "drop", label: tn("Water"), svg: tile("sky", "round", solid("M32 14s13 14 13 23a13 13 0 01-26 0c0-9 13-23 13-23z", "#3D8FD9")) },
  { name: "note", label: tn("Music"), svg: tile("lilac", "square", line("M27 43V20l18-4v22") + dot(22, 43, 5) + dot(40, 39, 5)) },
  { name: "book", label: tn("Read"), svg: tile("sage", "square", line("M32 21c-4-3-9-4-15-4v26c6 0 11 1 15 4 4-3 9-4 15-4V17c-6 0-11 1-15 4zM32 21v26")) },
  { name: "pencil", label: tn("Write"), svg: tile("butter", "square", line("M19 45l3-10 19-19 7 7-19 19zM37 20l7 7")) },
  { name: "eye", label: tn("Look"), svg: tile("sky", "round", line("M14 32s7-11 18-11 18 11 18 11-7 11-18 11-18-11-18-11z") + dot(32, 32, 5)) },
  { name: "smile", label: tn("Happy"), svg: tile("butter", "round", dot(25, 27, 2.8) + dot(39, 27, 2.8) + line("M22 36c3 5 6 7 10 7s7-2 10-7")) },
  { name: "frown", label: tn("Unsure"), svg: tile("lilac", "round", dot(25, 27, 2.8) + dot(39, 27, 2.8) + line("M22 43c3-4 6-6 10-6s7 2 10 6")) },
  { name: "trophy", label: tn("Win"), svg: tile("butter", "square", line("M23 16h18v10a9 9 0 01-18 0zM23 19h-6c0 6 2 9 6 9M41 19h6c0 6-2 9-6 9M32 35v8M24 47h16")) },
  { name: "target", label: tn("Goal"), svg: tile("rose", "round", `<circle cx="32" cy="32" r="16" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="32" r="9" fill="none" stroke="${INK}" stroke-width="3"/>` + dot(32, 32, 3.2, "#C9452F")) },
  { name: "key", label: tn("Key Point"), svg: tile("peach", "square", `<circle cx="24" cy="32" r="8" fill="none" stroke="${INK}" stroke-width="3.2"/>` + line("M32 32h17M43 32v7M49 32v5")) },
  { name: "bell", label: tn("Reminder"), svg: tile("butter", "round", line("M21 41c2-3 2-6 2-11a9 9 0 0118 0c0 5 0 8 2 11zM29 46a3 3 0 006 0")) },
  { name: "chat", label: tn("Discuss"), svg: tile("sky", "square", line("M17 19h30v21H31l-8 7v-7h-6z")) },
  { name: "todo", label: tn("To Do"), svg: tile("peach", "tag", word("TO DO", 12.5)) },
  { name: "done", label: tn("Done"), svg: tile("sage", "tag", word("DONE", 13.5)) },
  { name: "exam", label: tn("Exam"), svg: tile("rose", "tag", word("EXAM", 13.5)) },
  { name: "review", label: tn("Review"), svg: tile("lilac", "tag", word("REVIEW", 10.5, 36)) },
  { name: "aplus", label: tn("A Plus"), svg: tile("butter", "round", word("A+", 22, 40, 32)) },
];

const byName = new Map(stickers.map((sticker) => [sticker.name, sticker]));

export function stickerNamed(name: string): Sticker | undefined {
  return byName.get(name);
}

export function stickerSVG(sticker: Sticker): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${sticker.svg}</svg>`;
}

export function stickerDataURL(sticker: Sticker): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stickerSVG(sticker))}`;
}
