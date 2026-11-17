// The display names the model keeps in English (paper, covers, colours), translated where they are shown.
// The model stays free of UI text; the `tn` calls here register its names for the extraction script.

import { t, tn } from "./index";
import { inkKindNames, type InkKind } from "../model/tools";
import { familyNames, pageSizeNames, paperColorNames, templateNames, type PageSize, type PaperColor, type PaperFamily, type PaperTemplate } from "../model/paper";

// Paper templates, families, colours and sizes (model/paper.ts)
tn("Blank"); tn("Narrow Ruled"); tn("Wide Ruled"); tn("Grid"); tn("Dotted"); tn("Cornell"); tn("Music Staff"); tn("Engineering");
tn("Isometric"); tn("Checklist"); tn("Penmanship"); tn("Day Planner"); tn("Week Planner"); tn("Storyboard");
tn("Writing"); tn("Grids"); tn("Planning"); tn("Creative");
tn("White"); tn("Ivory"); tn("Legal Pad"); tn("Kraft"); tn("Sage"); tn("Blush"); tn("Gray"); tn("Charcoal"); tn("Chalkboard");
tn("US Letter"); tn("A4"); tn("A5"); tn("Widescreen");
// Cloth colours and print inks (model/notebook.ts)
tn("Oxblood"); tn("Tomato"); tn("Moss"); tn("Jade"); tn("Cobalt"); tn("Navy"); tn("Slate"); tn("Rose"); tn("Oat");
tn("Pink"); tn("Yellow"); tn("Teal"); tn("Blue"); tn("Black");
// Pen colours (model/tools.ts colorName)
tn("Mustard"); tn("Sky Blue"); tn("Plum"); tn("Light Green"); tn("Light Pink"); tn("Light Blue"); tn("Grey"); tn("Red"); tn("Brown");
tn("Orange"); tn("Green"); tn("Purple");

export const templateName = (template: PaperTemplate): string => t(templateNames[template]);
export const familyName = (family: PaperFamily): string => t(familyNames[family]);
export const paperColorName = (color: PaperColor): string => t(paperColorNames[color]);
export const pageSizeName = (size: PageSize): string => t(pageSizeNames[size]);

/** A cloth colour or a print ink, by its lower-case model name. */
export function swatchName(name: string): string {
  return t(name.charAt(0).toUpperCase() + name.slice(1));
}

// Text colours, tape colours and highlights (model/notebook.ts)
tn("Ink"); tn("Sky");
tn("Sans"); tn("Serif"); tn("Mono");

// Pen kinds (model/tools.ts inkKindNames)
tn("Pen"); tn("Fineliner"); tn("Fountain Pen"); tn("Calligraphy Pen"); tn("Pencil"); tn("Highlighter"); tn("Crayon"); tn("Watercolour");

export const inkKindName = (kind: InkKind): string => t(inkKindNames[kind]);
