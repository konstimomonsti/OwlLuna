// What is being dragged inside the library. A browser hides the dragged data until the drop, but the rows need
// to know on the way over whether they would accept it, so it is kept here as well.

export type Dragged = { kind: "folder"; id: string } | { kind: "notebooks"; ids: string[] } | null;

let current: Dragged = null;

export function beginDrag(event: { dataTransfer: DataTransfer | null }, what: NonNullable<Dragged>): void {
  current = what;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Some engines won't start a drag with nothing in the transfer.
    event.dataTransfer.setData("text/plain", what.kind === "folder" ? what.id : what.ids.join(","));
  }
}

export function endDrag(): void {
  current = null;
}

export function dragged(): Dragged {
  return current;
}
