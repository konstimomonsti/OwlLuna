// Keeping a notebook's words cache current: PDF text always, and handwriting when Windows has a recognizer, so what
// was written can be found by search. Nothing here ever shows an error; search just finds less.

import type { Stroke } from "../model/ink";
import { useApp } from "../state/app";
import { languageTag, recogniseInk, recognitionAvailable } from "./recognition";
import { refreshWords, type Recogniser, type WordsSource } from "./words";

let available: Promise<boolean> | null = null;

/** Whether a recognizer is installed, asked once per sitting. */
function recognizerInstalled(): Promise<boolean> {
  if (!available) available = recognitionAvailable().catch(() => false);
  return available;
}

/** A recogniser for the notebook's ink, or nothing where there is no recognizer to ask. */
async function recogniser(): Promise<Recogniser | undefined> {
  if (!(await recognizerInstalled())) return undefined;
  const language = useApp.getState().settings.language;
  return async (strokes: Stroke[]) => (await recogniseInk(strokes, languageTag(language))).text;
}

const running = new Map<string, Promise<boolean>>();

/** Reads what can be read in a notebook into its words cache. One pass per notebook at a time; a pass already running is joined. */
export function refreshSearchableWords(source: WordsSource): Promise<boolean> {
  const busy = running.get(source.id);
  if (busy) return busy;
  const pass = (async () => {
    try {
      return await refreshWords(source, await recogniser());
    } catch {
      return false;
    } finally {
      running.delete(source.id);
    }
  })();
  running.set(source.id, pass);
  return pass;
}
