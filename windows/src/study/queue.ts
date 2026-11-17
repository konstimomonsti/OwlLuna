// The order of a review sitting. A card graded Again comes back a few cards later, until it is remembered.

import type { CardGrade, Flashcard } from "../model/flashcard";

/** How many other cards are shown before a forgotten one returns. */
export const AGAIN_GAP = 3;

export interface Queue {
  /** Keys of the cards still to show, the one on screen first. */
  waiting: string[];
  /** How many cards the sitting began with. */
  total: number;
  /** How many answers were Again. */
  again: number;
  /** How many answers were given in all. */
  answers: number;
}

export function startQueue(keys: string[]): Queue {
  return { waiting: [...keys], total: keys.length, again: 0, answers: 0 };
}

export function currentKey(queue: Queue): string | undefined {
  return queue.waiting[0];
}

export function isFinished(queue: Queue): boolean {
  return queue.waiting.length === 0;
}

/** Takes the card on screen off the front. Again puts it back after a few others, or last if fewer remain. */
export function answer(queue: Queue, grade: CardGrade): Queue {
  if (queue.waiting.length === 0) return queue;
  const [head, ...rest] = queue.waiting;
  const next: Queue = { ...queue, answers: queue.answers + 1, again: queue.again + (grade === "again" ? 1 : 0) };
  if (grade === "again") rest.splice(Math.min(AGAIN_GAP, rest.length), 0, head);
  next.waiting = rest;
  return next;
}

/** The share of the sitting's cards that are remembered for now, from 0 to 1. */
export function progress(queue: Queue): number {
  if (queue.total === 0) return 1;
  return (queue.total - new Set(queue.waiting).size) / queue.total;
}

/** The cards studied: how many different ones were shown. */
export function studiedCount(queue: Queue): number {
  return queue.total - new Set(queue.waiting).size;
}

/** A card's key across notebooks. */
export function cardKey(notebook: string, cardID: string): string {
  return `${notebook}|${cardID}`;
}

export function splitKey(key: string): { notebook: string; cardID: string } {
  const at = key.indexOf("|");
  return { notebook: key.slice(0, at), cardID: key.slice(at + 1) };
}

/** The words under a grade button for the days until the card returns. */
export function intervalLabel(days: number): string {
  if (days <= 0) return "now";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} months`;
  const years = Math.round((days / 365) * 10) / 10;
  return years === 1 ? "1 year" : `${years} years`;
}

/** How many cards of a list are due on `day`, given only their due days. */
export function dueAmong(dues: string[], day: string): number {
  return dues.filter((due) => due <= day).length;
}

export interface DueSummary {
  cards: number;
  notebooks: number;
}

export function summariseDue(perNotebook: Record<string, number>): DueSummary {
  let cards = 0, notebooks = 0;
  for (const count of Object.values(perNotebook)) {
    if (count > 0) { cards += count; notebooks++; }
  }
  return { cards, notebooks };
}

export function dueSentence(summary: DueSummary): string {
  const cards = summary.cards === 1 ? "1 card" : `${summary.cards} cards`;
  return `${cards} due in ${summary.notebooks === 1 ? "1 notebook" : `${summary.notebooks} notebooks`}`;
}

export function deckSentence(cards: Flashcard[], due: number): string {
  return `${cards.length === 1 ? "1 card" : `${cards.length} cards`}, ${due} due today`;
}
