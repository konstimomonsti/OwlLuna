import { describe, expect, it } from "vitest";
import { decimate, languageTag, MAX_POINTS, ocrImage, recogniseInk, recognitionAvailable, helloAvailable } from "../src/services/recognition";
import { makeStroke } from "../src/model/ink";

describe("recognition helpers", () => {
  it("maps the language setting to Windows tags", () => {
    expect(languageTag("system")).toBeUndefined();
    expect(languageTag(undefined)).toBeUndefined();
    expect(languageTag("en")).toBe("en-US");
    expect(languageTag("es")).toBe("es-ES");
    expect(languageTag("fr")).toBe("fr-FR");
    expect(languageTag("de")).toBe("de-DE");
  });

  it("keeps only x and y, and every point of a short stroke", () => {
    const stroke = makeStroke("pen", 0x000000ff, 2, [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]);
    expect(decimate(stroke)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("thins a long stroke but keeps its ends", () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i * 2 }));
    const out = decimate(makeStroke("pen", 0, 2, points));
    expect(out).toHaveLength(MAX_POINTS);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([999, 1998]);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });

  it("handles empty strokes", () => {
    expect(decimate({ pts: [] })).toEqual([]);
  });

  it("rejects with a readable message outside the Windows app", async () => {
    await expect(recogniseInk([], "en")).rejects.toThrow(/Windows app/);
    await expect(ocrImage(new Uint8Array([1]))).rejects.toThrow(/Windows app/);
    expect(await recognitionAvailable()).toBe(false);
    expect(await helloAvailable()).toBe(false);
  });
});
