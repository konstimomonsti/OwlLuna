// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error the extraction script is plain JavaScript
import { extractKeys, placeholders } from "../scripts/i18n-extract.mjs";
import de from "../src/i18n/de";
import es from "../src/i18n/es";
import fr from "../src/i18n/fr";
import { language, locale, setLanguage, t, tn, tp } from "../src/i18n";

const dictionaries = { es, fr, de } as const;
const keys: string[] = [...(extractKeys() as Map<string, unknown>).keys()];

afterEach(() => setLanguage("en"));

describe("dictionaries", () => {
  it("finds the strings the source uses", () => {
    expect(keys.length).toBeGreaterThan(500);
  });

  for (const [name, dictionary] of Object.entries(dictionaries)) {
    describe(name, () => {
      it("has every key the source uses", () => {
        const missing = keys.filter((key) => dictionary[key] === undefined);
        expect(missing).toEqual([]);
      });

      it("keeps the placeholders of every key", () => {
        const broken = Object.entries(dictionary).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join()).map(([key]) => key);
        expect(broken).toEqual([]);
      });

      it("has no empty translation", () => {
        const empty = Object.entries(dictionary).filter(([, value]) => value.trim() === "").map(([key]) => key);
        expect(empty).toEqual([]);
      });

      it("translates something other than English for most keys", () => {
        const same = keys.filter((key) => dictionary[key] === key).length;
        expect(same / keys.length).toBeLessThan(0.2);
      });
    });
  }
});

describe("t and tp", () => {
  it("returns the English text in English", () => {
    setLanguage("en");
    expect(t("Cancel")).toBe("Cancel");
    expect(language()).toBe("en");
  });

  it("looks up each language and sets the document language", () => {
    setLanguage("es");
    expect(t("Cancel")).toBe(es["Cancel"]);
    expect(document.documentElement.lang).toBe("es");
    setLanguage("fr");
    expect(t("Cancel")).toBe(fr["Cancel"]);
    setLanguage("de");
    expect(t("Cancel")).toBe(de["Cancel"]);
    expect(document.documentElement.lang).toBe("de");
  });

  it("falls back to English for a missing key", () => {
    setLanguage("de");
    expect(t("A sentence nobody translated")).toBe("A sentence nobody translated");
    expect(t("Nobody translated {name}", { name: "this" })).toBe("Nobody translated this");
  });

  it("fills placeholders and leaves unknown ones", () => {
    setLanguage("en");
    expect(t("Delete “{name}” forever?", { name: "Physics" })).toBe("Delete “Physics” forever?");
    expect(t("{a} and {b}", { a: "x" })).toBe("x and {b}");
    setLanguage("fr");
    expect(t("Delete “{name}” forever?", { name: "Physique" })).toContain("Physique");
  });

  it("picks plurals in every language", () => {
    for (const lang of ["en", "es", "fr", "de"] as const) {
      setLanguage(lang);
      const one = tp(1, "{count} page", "{count} pages");
      const many = tp(5, "{count} page", "{count} pages");
      expect(one).toContain("1");
      expect(many).toContain("5");
      expect(one).not.toBe(many);
    }
    setLanguage("en");
    expect(tp(1, "{count} page", "{count} pages")).toBe("1 page");
    expect(tp(0, "{count} page", "{count} pages")).toBe("0 pages");
    expect(tp(3, "{count} page", "{count} pages")).toBe("3 pages");
    setLanguage("de");
    expect(tp(1, "{count} page", "{count} pages")).toBe("1 Seite");
    expect(tp(2, "{count} page", "{count} pages")).toBe("2 Seiten");
    setLanguage("es");
    expect(tp(2, "{count} day", "{count} days")).toBe("2 días");
  });

  it("marks a string without translating it", () => {
    setLanguage("de");
    expect(tn("Cancel")).toBe("Cancel");
  });

  it("formats with the language's locale", () => {
    setLanguage("es");
    expect(locale().startsWith("es")).toBe(true);
    setLanguage("de");
    expect(locale().startsWith("de")).toBe(true);
    expect(new Date(2024, 0, 1).toLocaleDateString(locale(), { weekday: "long" })).toBe("Montag");
  });
});
