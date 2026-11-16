// Pens. Ported from OwlLuna/Models/ToolPreset.swift, with PencilKit's ink kinds named as the app names them.

import { uuid } from "./ids";

export const inkKinds = ["pen", "fineliner", "fountain", "calligraphy", "pencil", "highlighter", "crayon", "watercolour"] as const;
export type InkKind = (typeof inkKinds)[number];

export const inkKindNames: Record<InkKind, string> = {
  pen: "Pen", fineliner: "Fineliner", fountain: "Fountain Pen", calligraphy: "Calligraphy Pen",
  pencil: "Pencil", highlighter: "Highlighter", crayon: "Crayon", watercolour: "Watercolour",
};

/** The widths, in points, each kind can be set to. PencilKit's own ranges, the fineliner let down to a quarter point. */
export const widthRanges: Record<InkKind, [number, number]> = {
  pen: [0.9, 25.7],
  fineliner: [0.25, 5],
  fountain: [1.5, 20],
  calligraphy: [2, 24],
  pencil: [2.4, 16],
  highlighter: [5, 46],
  crayon: [10, 30],
  watercolour: [10, 60],
};

/** Colours are red, green, blue and alpha, a byte each, in one number: 0xRRGGBBAA. */
export const inks: number[] = [
  0x1b2230ff, 0x6e737cff, 0x7a5230ff, 0xc9452fff, 0xe07a1fff, 0xe8b023ff,
  0x2f8f4eff, 0x1f8a8aff, 0x2747b8ff, 0x3d8fd9ff, 0x7a3e9dff, 0xd9578cff,
];
export const tints: number[] = [0xffd426ff, 0x7ed98bff, 0xff8fb8ff, 0x7cc4ffff];

export function paletteFor(ink: InkKind): number[] {
  return ink === "highlighter" ? [...tints, ...inks] : [...inks, ...tints];
}

export interface ToolPreset {
  id: string;
  ink: InkKind;
  color: number;
  width: number;
}

export const maxPens = 8;
export const leastOpacity = 0.1;

export function clampWidth(ink: InkKind, width: number): number {
  const [low, high] = widthRanges[ink];
  return Math.min(Math.max(width, low), high);
}

/** Where a width at `fraction` of the way lies. The thin end has most of the travel, where writing is done. */
export function widthAt(fraction: number, ink: InkKind): number {
  const [low, high] = widthRanges[ink];
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return low + (high - low) * clamped * clamped;
}

/** The reverse of `widthAt`. */
export function widthTravel(preset: ToolPreset): number {
  const [low, high] = widthRanges[preset.ink];
  if (high <= low) return 0.5;
  return Math.sqrt(Math.min(Math.max((preset.width - low) / (high - low), 0), 1));
}

export function opacityOf(color: number): number {
  return (color & 0xff) / 255;
}

export function withOpacity(color: number, opacity: number): number {
  const byte = Math.round(Math.min(Math.max(opacity, leastOpacity), 1) * 255);
  return ((color & 0xffffff00) | byte) >>> 0;
}

/** Another colour, as faint as the pen was. */
export function withTint(color: number, tint: number): number {
  return ((tint & 0xffffff00) | (color & 0xff)) >>> 0;
}

export function tintOf(color: number): number {
  return (color | 0xff) >>> 0;
}

export function rgbaCSS(color: number, alphaScale = 1): string {
  const r = (color >>> 24) & 0xff, g = (color >>> 16) & 0xff, b = (color >>> 8) & 0xff, a = (color & 0xff) / 255;
  return `rgba(${r}, ${g}, ${b}, ${+(a * alphaScale).toFixed(4)})`;
}

export function hexCSS(color: number): string {
  return "#" + ((color >>> 8) & 0xffffff).toString(16).padStart(6, "0");
}

export function colorFromHex(hex: string, alpha = 1): number {
  const value = parseInt(hex.replace("#", ""), 16) & 0xffffff;
  return ((value << 8) | Math.round(alpha * 255)) >>> 0;
}

/** The colour in a word, for labels and screen readers. */
export function colorName(color: number): string {
  switch (tintOf(color)) {
    case 0xe8b023ff: return "Mustard";
    case 0x3d8fd9ff: return "Sky Blue";
    case 0x7a3e9dff: return "Plum";
    case 0x7ed98bff: return "Light Green";
    case 0xff8fb8ff: return "Light Pink";
    case 0x7cc4ffff: return "Light Blue";
  }
  const r = ((color >>> 24) & 0xff) / 255, g = ((color >>> 16) & 0xff) / 255, b = ((color >>> 8) & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  if (max < 0.2) return "Black";
  if (saturation < 0.12) return max > 0.9 ? "White" : "Grey";
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  if (hue < 15 || hue >= 345) return "Red";
  if (hue < 40) return max < 0.6 ? "Brown" : "Orange";
  if (hue < 65) return "Yellow";
  if (hue < 165) return "Green";
  if (hue < 195) return "Teal";
  if (hue < 255) return "Blue";
  if (hue < 290) return "Purple";
  return "Pink";
}

/** The same tool, whichever one of them was saved. */
export function isSameTool(a: ToolPreset, b: ToolPreset): boolean {
  return a.ink === b.ink && a.color === b.color && Math.abs(a.width - b.width) < 0.15;
}

/** The pens a new library starts with. */
export function starterPens(): ToolPreset[] {
  return [
    { id: uuid(), ink: "pen", color: 0x1b2230ff, width: 2.4 },
    { id: uuid(), ink: "fineliner", color: 0x2747b8ff, width: 1.2 },
    { id: uuid(), ink: "pencil", color: 0x6e737cff, width: 3 },
    { id: uuid(), ink: "highlighter", color: withOpacity(0xffd426ff, 0.45), width: 18 },
  ];
}

export type ToolChoice =
  | { kind: "pen"; penID: string }
  | { kind: "eraser" }
  | { kind: "lasso" }
  | { kind: "shape"; shape: ShapeKind }
  | { kind: "tape" }
  | { kind: "text" }
  | { kind: "hand" }
  | { kind: "laser" };

export const shapeKinds = ["line", "arrow", "circle", "rectangle", "triangle"] as const;
export type ShapeKind = (typeof shapeKinds)[number];

export type EraserMode = "stroke" | "partial" | "highlighter";
