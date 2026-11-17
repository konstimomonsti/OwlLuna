// The flashcards of every notebook that has been looked at, kept in memory and written back after each change.
// A notebook's cards are read the first time they are needed.

import { create } from "zustand";
import { dayKey } from "../model/days";
import { graded, dueCards, type CardGrade, type Flashcard } from "../model/flashcard";
import type { Manifest } from "../model/notebook";
import type { FS } from "../platform/fs";
import { loadCards, saveCards } from "../storage/package";
import { removeCardImage } from "./cardImages";
import { cardKey, dueAmong } from "./queue";

export interface CardState {
  cards: Record<string, Flashcard[]>;
  /** Each notebook's cards' due days and the manifest stamp they were read at, so the library can offer a Study card without opening anything. */
  summaries: Record<string, { stamp: string; dues: string[] }>;
  /** A card the deck sheet should open for editing; the card ID "new" starts a blank one. */
  edit: { notebook: string; cardID: string } | null;
}

export const useCards = create<CardState>(() => ({ cards: {}, summaries: {}, edit: null }));

const loading = new Map<string, Promise<Flashcard[]>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writers = new Map<string, { fs: FS; chain: Promise<void> }>();
export const SAVE_DELAY = 600;

function record(id: string, cards: Flashcard[], stamp?: string): void {
  useCards.setState((state) => ({
    cards: { ...state.cards, [id]: cards },
    summaries: { ...state.summaries, [id]: { stamp: stamp ?? state.summaries[id]?.stamp ?? "", dues: cards.map((card) => card.due) } },
  }));
}

/** The cards of a notebook, read from disk the first time. */
export function ensureCards(fs: FS, id: string): Promise<Flashcard[]> {
  const have = useCards.getState().cards[id];
  if (have) return Promise.resolve(have);
  let pending = loading.get(id);
  if (!pending) {
    pending = loadCards(fs, id).then(
      (cards) => {
        loading.delete(id);
        // Changes made while the file was read win.
        if (!useCards.getState().cards[id]) record(id, cards);
        return useCards.getState().cards[id];
      },
      (error) => {
        loading.delete(id);
        throw error;
      },
    );
    loading.set(id, pending);
  }
  return pending;
}

export function cardsOf(id: string): Flashcard[] {
  return useCards.getState().cards[id] ?? [];
}

function schedule(fs: FS, id: string): void {
  if (!writers.has(id)) writers.set(id, { fs, chain: Promise.resolve() });
  const old = timers.get(id);
  if (old) clearTimeout(old);
  timers.set(id, setTimeout(() => void flushCards(id).catch(() => {}), SAVE_DELAY));
}

/** Writes a notebook's cards now if a change is waiting. Rejects if the write fails. */
export function flushCards(id: string): Promise<void> {
  const writer = writers.get(id);
  if (!writer) return Promise.resolve();
  const timer = timers.get(id);
  if (!timer) return writer.chain;
  clearTimeout(timer);
  timers.delete(id);
  const cards = cardsOf(id);
  writer.chain = writer.chain.catch(() => {}).then(() => saveCards(writer.fs, id, cards));
  return writer.chain;
}

export async function flushAllCards(): Promise<void> {
  await Promise.all([...timers.keys()].map((id) => flushCards(id)));
}

async function change(fs: FS, id: string, work: (cards: Flashcard[]) => Flashcard[]): Promise<void> {
  const cards = await ensureCards(fs, id);
  record(id, work(cards));
  schedule(fs, id);
}

export function addCard(fs: FS, id: string, card: Flashcard): Promise<void> {
  return change(fs, id, (cards) => [...cards, card]);
}

export function updateCard(fs: FS, id: string, cardID: string, work: (card: Flashcard) => Flashcard): Promise<void> {
  return change(fs, id, (cards) => cards.map((card) => (card.id === cardID ? { ...work(card), changedAt: Date.now() } : card)));
}

/** Removes a card and its clippings. */
export async function removeCard(fs: FS, id: string, cardID: string): Promise<void> {
  const card = (await ensureCards(fs, id)).find((candidate) => candidate.id === cardID);
  await change(fs, id, (cards) => cards.filter((candidate) => candidate.id !== cardID));
  if (card) {
    await removeCardImage(fs, id, card.front.image);
    await removeCardImage(fs, id, card.back.image);
  }
}

/** Records an answer. The card keeps its place in the notebook; only its schedule moves. */
export function gradeCard(fs: FS, id: string, cardID: string, grade: CardGrade, now: Date = new Date()): Promise<void> {
  return change(fs, id, (cards) => cards.map((card) => (card.id === cardID ? graded(card, grade, now) : card)));
}

export function requestEdit(notebook: string, cardID: string): void {
  useCards.setState({ edit: { notebook, cardID } });
}

export function clearEdit(): void {
  useCards.setState({ edit: null });
}

/** The card already made from a tape, if any. */
export function cardForTape(id: string, tapeID: string): Flashcard | undefined {
  return cardsOf(id).find((card) => card.tapeID === tapeID);
}

// The library's view of due cards

function offered(manifest: Manifest, unlocked: string[]): boolean {
  return manifest.trashedAt === null && !(manifest.locked && !unlocked.includes(manifest.id));
}

/**
 * Reads the cards of notebooks not yet read, once each, and again when a notebook's `modifiedAt` has moved since.
 * Notebooks whose cards are in memory are kept current by the store itself. Locked and trashed notebooks are left alone.
 */
export async function refreshSummaries(fs: FS, manifests: Record<string, Manifest>, unlocked: string[]): Promise<void> {
  for (const manifest of Object.values(manifests)) {
    if (!offered(manifest, unlocked)) continue;
    const stamp = String(manifest.modifiedAt);
    const known = useCards.getState().summaries[manifest.id];
    if (known && (useCards.getState().cards[manifest.id] || known.stamp === stamp)) continue;
    try {
      const cards = await loadCards(fs, manifest.id);
      // Cards opened meanwhile are more current than this read.
      if (useCards.getState().cards[manifest.id]) continue;
      useCards.setState((state) => ({ summaries: { ...state.summaries, [manifest.id]: { stamp, dues: cards.map((card) => card.due) } } }));
    } catch {
      // A notebook whose cards can't be read has none to offer.
    }
  }
}

/** Cards due today in each notebook that is not locked or trashed. */
export function dueByNotebook(manifests: Record<string, Manifest>, unlocked: string[], summaries: CardState["summaries"], day: string = dayKey()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const manifest of Object.values(manifests)) {
    if (!offered(manifest, unlocked)) continue;
    const summary = summaries[manifest.id];
    if (summary) out[manifest.id] = dueAmong(summary.dues, day);
  }
  return out;
}

/** The keys of the cards to show, oldest due day first across all the notebooks. */
export function sittingKeys(notebooks: string[], all: boolean, day: string = dayKey()): string[] {
  const owner = new Map<string, string>();
  const cards: Flashcard[] = [];
  for (const notebook of notebooks) {
    for (const card of cardsOf(notebook)) {
      owner.set(card.id, notebook);
      cards.push(card);
    }
  }
  const chosen = all ? [...cards].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdAt - b.createdAt)) : dueCards(cards, day);
  return chosen.map((card) => cardKey(owner.get(card.id)!, card.id));
}
