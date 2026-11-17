// Paper: templates, colours and page sizes. Ported from OwlLuna/Models/Paper.swift.

export const paperTemplates = [
  "blank", "narrowRuled", "wideRuled", "grid", "dotted", "cornell", "music",
  "engineering", "isometric", "checklist", "penmanship", "dayPlanner", "weekPlanner", "storyboard",
] as const;
export type PaperTemplate = (typeof paperTemplates)[number];

export const templateNames: Record<PaperTemplate, string> = {
  blank: "Blank", narrowRuled: "Narrow Ruled", wideRuled: "Wide Ruled", grid: "Grid", dotted: "Dotted",
  cornell: "Cornell", music: "Music Staff", engineering: "Engineering", isometric: "Isometric",
  checklist: "Checklist", penmanship: "Penmanship", dayPlanner: "Day Planner", weekPlanner: "Week Planner",
  storyboard: "Storyboard",
};

export const paperFamilies = ["writing", "grids", "planning", "creative"] as const;
export type PaperFamily = (typeof paperFamilies)[number];

export const familyNames: Record<PaperFamily, string> = {
  writing: "Writing", grids: "Grids", planning: "Planning", creative: "Creative",
};

export const familyTemplates: Record<PaperFamily, PaperTemplate[]> = {
  writing: ["blank", "narrowRuled", "wideRuled", "penmanship", "checklist"],
  grids: ["grid", "engineering", "dotted", "isometric"],
  planning: ["cornell", "dayPlanner", "weekPlanner"],
  creative: ["music", "storyboard"],
};

export function familyOf(template: PaperTemplate): PaperFamily {
  return paperFamilies.find((family) => familyTemplates[family].includes(template)) ?? "writing";
}

export const paperColors = ["white", "ivory", "yellow", "kraft", "sage", "blush", "gray", "charcoal", "chalkboard"] as const;
export type PaperColor = (typeof paperColors)[number];

export const paperColorNames: Record<PaperColor, string> = {
  white: "White", ivory: "Ivory", yellow: "Legal Pad", kraft: "Kraft", sage: "Sage", blush: "Blush",
  gray: "Gray", charcoal: "Charcoal", chalkboard: "Chalkboard",
};

/** Red, green and blue from 0 to 1, as the Swift source keeps them. */
export const paperRGB: Record<PaperColor, [number, number, number]> = {
  white: [1, 1, 1],
  ivory: [0.992, 0.976, 0.925],
  yellow: [1, 0.973, 0.765],
  gray: [0.925, 0.929, 0.937],
  charcoal: [0.165, 0.169, 0.184],
  kraft: [0.851, 0.769, 0.627],
  sage: [0.867, 0.898, 0.843],
  blush: [0.965, 0.894, 0.878],
  chalkboard: [0.169, 0.243, 0.212],
};

export function paperCSS(color: PaperColor): string {
  const [r, g, b] = paperRGB[color];
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function isDarkPaper(color: PaperColor): boolean {
  return color === "charcoal" || color === "chalkboard";
}

export const pageSizes = ["letter", "a4", "a5", "widescreen"] as const;
export type PageSize = (typeof pageSizes)[number];

export const pageSizeNames: Record<PageSize, string> = {
  letter: "US Letter", a4: "A4", a5: "A5", widescreen: "Widescreen",
};

/** Sizes in points, 72 to the inch. */
export const pageSizePoints: Record<PageSize, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 },
  widescreen: { w: 960, h: 540 },
};

export function asTemplate(raw: unknown): PaperTemplate {
  return (paperTemplates as readonly string[]).includes(raw as string) ? (raw as PaperTemplate) : "blank";
}

export function asPaperColor(raw: unknown): PaperColor {
  return (paperColors as readonly string[]).includes(raw as string) ? (raw as PaperColor) : "white";
}

export function asPageSize(raw: unknown): PageSize {
  return (pageSizes as readonly string[]).includes(raw as string) ? (raw as PageSize) : "letter";
}
