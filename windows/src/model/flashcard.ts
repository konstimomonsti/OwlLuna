// Flashcards and their schedule. Ported from OwlLuna/Models/Flashcard.swift.

import { addDays, dayKey, daysBetween } from "./days";
import { uuid } from "./ids";

export interface CardSide {
  text: string;
  /** A PNG in the notebook's `cards/` folder. */
  image?: string;
  /** The words read from the clipping when it was cut. */
  imageText?: string;
}

export type CardGrade = "again" | "good" | "easy";

export interface Flashcard {
  id: string;
  front: CardSide;
  back: CardSide;
  pageID?: string;
  tapeID?: string;
  createdAt: number;
  /** The day it is next shown, as a day key. */
  due: string;
  /** Days between the last review and the next. Zero until it has been remembered once. */
  interval: number;
  ease: number;
  reviews: number;
  lapses: number;
  lastReviewed?: number;
  changedAt?: number;
}

export const startingEase = 2.5;
export const minimumEase = 1.3;
export const longestInterval = 365;

export function sideIsEmpty(side: CardSide): boolean {
  return side.text.trim() === "" && !side.image;
}

export function newCard(front: CardSide, back: CardSide, options: { pageID?: string; tapeID?: string; now?: Date } = {}): Flashcard {
  const now = options.now ?? new Date();
  return {
    id: uuid(), front, back,
    ...(options.pageID ? { pageID: options.pageID } : {}),
    ...(options.tapeID ? { tapeID: options.tapeID } : {}),
    createdAt: now.getTime(), due: dayKey(now), interval: 0, ease: startingEase, reviews: 0, lapses: 0,
  };
}

export function isDue(card: Flashcard, day: string): boolean {
  return card.due <= day;
}

/** Days still to go before a learned card's day, or null when it is due or its day can't be read. */
function daysEarly(card: Flashcard, now: Date): number | null {
  if (card.interval <= 0) return null;
  const days = daysBetween(dayKey(now), card.due);
  return days !== null && days > 0 ? days : null;
}

/** Days until the card is shown again. Zero means later in the same sitting. */
export function intervalAfter(grade: CardGrade, card: Flashcard, now: Date = new Date()): number {
  const early = daysEarly(card, now);
  if (grade !== "again" && early !== null) {
    const elapsed = Math.max(card.interval - early, 0);
    const grown = Math.round(elapsed * card.ease * (grade === "easy" ? 1.3 : 1));
    return Math.min(Math.max(grown, card.interval, early), longestInterval);
  }
  switch (grade) {
    case "again": return 0;
    case "good":
      if (card.interval === 0) return 1;
      if (card.interval === 1) return 3;
      return Math.min(Math.round(card.interval * card.ease), longestInterval);
    case "easy":
      return card.interval === 0 ? 4 : Math.min(Math.max(Math.round(card.interval * card.ease * 1.3), card.interval + 1), longestInterval);
  }
}

export function graded(card: Flashcard, grade: CardGrade, now: Date = new Date()): Flashcard {
  const next: Flashcard = { ...card, interval: intervalAfter(grade, card, now) };
  const early = daysEarly(card, now);
  if (grade === "again" && card.interval > 0 && (early ?? 0) < card.interval) {
    next.ease = Math.max(card.ease - 0.2, minimumEase);
    next.lapses = card.lapses + 1;
  } else if (grade === "easy" && early === null) {
    next.ease = card.ease + 0.15;
  }
  next.reviews = card.reviews + 1;
  next.lastReviewed = now.getTime();
  next.changedAt = now.getTime();
  next.due = dayKey(addDays(now, next.interval));
  return next;
}

/** `cards.json` in a notebook's package. */
export interface FlashcardFile {
  version: 1;
  cards: Flashcard[];
}

export function decodeCards(text: string): Flashcard[] {
  const parsed = JSON.parse(text) as Partial<FlashcardFile>;
  if (!parsed || !Array.isArray(parsed.cards)) throw new Error("not a card file");
  const out: Flashcard[] = [];
  for (const raw of parsed.cards as Partial<Flashcard>[]) {
    if (!raw || typeof raw.id !== "string") continue;
    const side = (value: unknown): CardSide => {
      const s = (value ?? {}) as Partial<CardSide>;
      return { text: typeof s.text === "string" ? s.text : "", ...(typeof s.image === "string" ? { image: s.image } : {}), ...(typeof s.imageText === "string" ? { imageText: s.imageText } : {}) };
    };
    const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
    out.push({
      ...raw,
      id: raw.id,
      front: side(raw.front),
      back: side(raw.back),
      createdAt,
      due: typeof raw.due === "string" ? raw.due : dayKey(new Date(createdAt)),
      interval: Math.max(typeof raw.interval === "number" ? Math.floor(raw.interval) : 0, 0),
      ease: Math.max(typeof raw.ease === "number" ? raw.ease : startingEase, minimumEase),
      reviews: typeof raw.reviews === "number" ? raw.reviews : 0,
      lapses: typeof raw.lapses === "number" ? raw.lapses : 0,
    });
  }
  return out;
}

export function encodeCards(cards: Flashcard[]): string {
  return JSON.stringify({ version: 1, cards } satisfies FlashcardFile, null, 1);
}

/** The cards to study now: those due, oldest day first. */
export function dueCards(cards: Flashcard[], day: string = dayKey()): Flashcard[] {
  return cards.filter((card) => isDue(card, day)).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdAt - b.createdAt));
}
