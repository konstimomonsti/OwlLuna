// A small translation layer with no dependency. Strings are keyed by their English text, as in the iPad app's string catalog.
// `t("Delete {name}?", { name })` looks the text up in the active language and fills the {placeholders}; a missing key falls back to
// English. `tp(count, one, other)` picks the singular or plural text with Intl.PluralRules; both texts are ordinary keys.
// `tn("Pen")` marks a string for the extraction script without translating it, for labels that are kept in a table and shown
// later through `t(label)`.

import { useSyncExternalStore } from "react";
import de from "./de";
import es from "./es";
import fr from "./fr";

export type Language = "en" | "es" | "fr" | "de";
export type LanguageSetting = Language | "system";
type Vars = Record<string, string | number>;

export const dictionaries: Record<Language, Record<string, string>> = { en: {}, es, fr, de };

let setting: LanguageSetting = "system";
let active: Language = resolve("system");
let tag = browserTag();
const listeners = new Set<() => void>();
let version = 0;

function browserTag(): string {
  return (typeof navigator !== "undefined" && navigator.language) || "en";
}

function resolve(value: LanguageSetting): Language {
  const code = value === "system" ? browserTag().toLowerCase().split("-")[0] : value;
  return code === "es" || code === "fr" || code === "de" ? code : "en";
}

/** Applies the app's language setting. Called whenever the setting changes. */
export function setLanguage(value: string | undefined): void {
  const next: LanguageSetting = value === "en" || value === "es" || value === "fr" || value === "de" ? value : "system";
  if (next === setting && version > 0) return;
  setting = next;
  active = resolve(next);
  const system = browserTag();
  tag = next === "system" ? system : system.toLowerCase().startsWith(active) ? system : active;
  if (typeof document !== "undefined") document.documentElement.lang = active;
  version++;
  listeners.forEach((listener) => listener());
}

/** The language in use. */
export function language(): Language {
  return active;
}

/** The BCP 47 tag for Intl formatting of dates and numbers. */
export function locale(): string {
  return tag;
}

const warned = new Set<string>();

function lookup(english: string): string {
  if (active === "en") return english;
  const found = dictionaries[active][english];
  if (found !== undefined) return found;
  if (import.meta.env?.DEV && !warned.has(english)) {
    warned.add(english);
    console.warn(`[i18n] no ${active} translation for "${english}"`);
  }
  return english;
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Translates an English string, filling `{placeholders}` from `vars`. */
export function t(english: string, vars?: Vars): string {
  return fill(lookup(english), vars);
}

/** Marks a string for translation and returns it unchanged; show it later with `t(label)`. */
export function tn<S extends string>(english: S): S {
  return english;
}

const rules = new Map<string, Intl.PluralRules>();

/** Picks the singular or the plural text for `count`. `{count}` is filled in automatically. */
export function tp(count: number, one: string, other: string, vars?: Vars): string {
  let rule = rules.get(tag);
  if (!rule) {
    try {
      rule = new Intl.PluralRules(tag);
    } catch {
      rule = new Intl.PluralRules("en");
    }
    rules.set(tag, rule);
  }
  const english = new Intl.PluralRules("en").select(count) === "one";
  const chosen = active === "en" ? english : rule.select(count) === "one";
  return fill(lookup(chosen ? one : other), { count: count.toLocaleString(tag), ...vars });
}

/** Subscribes a component to language changes; returns `t`. Plain `t` works anywhere, but only this re-renders. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, () => version);
  return t;
}

export function useLanguage(): Language {
  useSyncExternalStore(subscribe, () => version);
  return active;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

setLanguage("system");
