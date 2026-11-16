// What one open notebook's editor has in hand: the tool, the zoom, what is selected. Not saved.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { Point } from "../model/ink";
import type { ShapeKind, ToolChoice } from "../model/tools";

export interface InkSelection {
  pageID: string;
  ids: string[];
}

export interface RulerState {
  pageID: string;
  /** A point on the ruler's edge, in page points, and the edge's angle. */
  x: number;
  y: number;
  angle: number;
}

export type Panel = "navigator" | "paper" | "stickers" | "outline" | "recordings" | "cards" | "find" | null;

export interface SessionState {
  tool: ToolChoice;
  /** The tool before this one, for the pen button that goes back. */
  previousTool: ToolChoice;
  shape: ShapeKind;
  zoom: number;
  /** Kept fitted as the window changes, until the user zooms by hand. */
  fit: "width" | "page" | null;
  currentPage: string;
  /** Where a whiteboard's view begins, in its points. */
  board: Point;
  selection: InkSelection | null;
  selectedItem: { pageID: string; itemID: string } | null;
  editingItem: string | null;
  croppingItem: string | null;
  liftedTapes: string[];
  focus: boolean;
  ruler: RulerState | null;
  zoomWindow: { pageID: string; x: number; y: number } | null;
  panel: Panel;
  /** Asks the canvas to bring a page into view. The number makes each ask new. */
  scrollTo: { pageID: string; nonce: number; rect?: { x: number; y: number; w: number; h: number } } | null;
  /** Ink shown only up to this moment, while a recording replays. Null shows all. */
  replayUntil: number | null;
  replayFrom: number | null;
  /** Text marked on the page by Find, in page points. */
  findMarks: { pageID: string; rects: [number, number, number, number][]; current: boolean }[];
  textSelect: boolean;
}

export type Session = StoreApi<SessionState>;

const sessions = new Map<string, Session>();

export function sessionFor(notebookID: string, firstPage: string, penID: string | undefined): Session {
  let session = sessions.get(notebookID);
  if (!session) {
    const tool: ToolChoice = penID ? { kind: "pen", penID } : { kind: "hand" };
    session = createStore<SessionState>(() => ({
      tool, previousTool: tool, shape: "line", zoom: 1, fit: "width", currentPage: firstPage, board: { x: -40, y: -40 },
      selection: null, selectedItem: null, editingItem: null, croppingItem: null, liftedTapes: [], focus: false,
      ruler: null, zoomWindow: null, panel: null, scrollTo: null, replayUntil: null, replayFrom: null, findMarks: [], textSelect: false,
    }));
    sessions.set(notebookID, session);
  }
  return session;
}

export function dropSession(notebookID: string): void {
  sessions.delete(notebookID);
}

export function setTool(session: Session, tool: ToolChoice): void {
  session.setState((state) => {
    const same = JSON.stringify(state.tool) === JSON.stringify(tool);
    return {
      tool,
      previousTool: same ? state.previousTool : state.tool,
      // Ink stays selected only while the lasso is in hand.
      selection: tool.kind === "lasso" ? state.selection : null,
      selectedItem: tool.kind === "lasso" || tool.kind === "hand" || tool.kind === "text" ? state.selectedItem : null,
      editingItem: tool.kind === "pen" || tool.kind === "eraser" ? null : state.editingItem,
    };
  });
}

/** Back to the tool before, as a tap of the pen's button does. */
export function swapTool(session: Session): void {
  setTool(session, session.getState().previousTool);
}

let nonce = 0;

export function goToPage(session: Session, pageID: string, rect?: { x: number; y: number; w: number; h: number }): void {
  session.setState({ currentPage: pageID, scrollTo: { pageID, nonce: ++nonce, rect } });
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 5;

/** Pages keep 0.2 to 5; a whiteboard passes its own, wider range. */
export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return Math.min(Math.max(zoom, min), max);
}
