// Finds the strings the app passes to t(), tn() and tp() and reports the ones missing from a dictionary.
// Usage: node scripts/i18n-extract.mjs [--all] [--list]   (--all includes the OneNote files, which are translated separately)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LITERAL = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\$]|\\\\.)*`)";
const SINGLE = new RegExp(String.raw`(?<![\w.$])(?:t|tn)\(\s*` + LITERAL, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.$])tp\(\s*[^"'` + "`" + String.raw`;]*?,\s*` + LITERAL + String.raw`\s*,\s*` + LITERAL, "g");
const PENDING = /onenote/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function value(literal) {
  return new Function(`return ${literal}`)();
}

/** Every English key used in the source, with the files that use it. */
export function extractKeys({ all = false } = {}) {
  const keys = new Map();
  const add = (key, file) => {
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key).add(file);
  };
  for (const path of walk(join(root, "src"))) {
    const file = relative(root, path).replaceAll("\\", "/");
    if (file === "src/i18n/index.ts" || (!all && PENDING.test(file))) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(SINGLE)) add(value(match[1]), file);
    for (const match of text.matchAll(PLURAL)) {
      add(value(match[1]), file);
      add(value(match[2]), file);
    }
  }
  return keys;
}

export function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = extractKeys({ all: process.argv.includes("--all") });
  let missing = 0;
  for (const lang of ["es", "fr", "de"]) {
    const dictionary = (await import(pathToFileURL(join(root, "src/i18n", `${lang}.ts`)).href).catch(() => null))?.default;
    const missed = [...keys.keys()].filter((key) => !dictionary || dictionary[key] === undefined);
    missing += missed.length;
    console.log(`${lang}: ${missed.length} missing of ${keys.size}`);
    if (process.argv.includes("--list")) for (const key of missed) console.log("  " + JSON.stringify(key));
  }
  process.exit(missing ? 1 : 0);
}
