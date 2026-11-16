import { describe, expect, it } from "vitest";
import { findInNotebook, fold } from "../src/editor/find";
import { newPage, type Page, type PageItem } from "../src/model/notebook";

const defaults = { template: "blank", paperColor: "white", pageSize: "letter" } as const;
const text = (string: string, patch: Partial<PageItem> = {}): PageItem => ({ id: "t" + string.length, kind: "text", string, fontSize: 17, x: 100, y: 50, w: 200, h: 40, rotation: 0, ...patch }) as PageItem;

function pageWith(...items: PageItem[]): Page {
  return newPage(defaults, { items });
}

describe("fold", () => {
  it("ignores case and accents", () => {
    expect(fold("Café ÉCOLE")).toBe("cafe ecole");
  });
});

describe("findInNotebook", () => {
  it("finds nothing for an empty query", () => {
    expect(findInNotebook("  ", [pageWith(text("hello"))])).toEqual([]);
  });
  it("matches case- and accent-insensitively and reports the item's box", () => {
    const page = pageWith(text("Un café noir"));
    const found = findInNotebook("CAFE", [page]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ pageID: page.id, kind: "text", rect: { x: 0, y: 30, w: 200, h: 40 } });
  });
  it("counts every occurrence and keeps page order", () => {
    const a = pageWith(text("owl owl")), b = pageWith(text("an Owl"));
    const found = findInNotebook("owl", [a, b]);
    expect(found.map((match) => match.pageID)).toEqual([a.id, a.id, b.id]);
  });
  it("searches link labels, picture text and recognised words", () => {
    const link = { id: "l", kind: "link", label: "Lecture notes", target: { to: "web", url: "https://a.b" }, x: 0, y: 0, w: 100, h: 30, rotation: 0 } as PageItem;
    const pic = { id: "p", kind: "image", file: "x.png", text: "lecture slide", x: 0, y: 0, w: 10, h: 10, rotation: 0 } as PageItem;
    const page = pageWith(link, pic);
    const found = findInNotebook("lecture", [page], { [page.id]: { text: "Lecture three" } });
    expect(found.map((match) => match.kind)).toEqual(["link", "picture", "words"]);
    expect(found[2].rect).toBeUndefined();
  });
  it("sees the text of list items without their markers confusing the match", () => {
    const page = pageWith(text("milk\neggs", { list: "bullet" } as Partial<PageItem>));
    expect(findInNotebook("eggs", [page])).toHaveLength(1);
  });
});
