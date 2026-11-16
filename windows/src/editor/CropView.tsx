// Cropping a picture: the whole picture dimmed, the part kept bright inside a rectangle with eight handles.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAssetURL } from "../canvas/ItemsLayer";
import { capturePointer } from "../canvas/pointer";
import type { PictureItem } from "../model/notebook";
import { clampCrop, croppedItem, MIN_CROP as MIN, type Crop } from "./crop";
import type { NotebookDocument } from "./document";

type Grip = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

export function CropView(props: {
  doc: NotebookDocument;
  pageID: string;
  item: PictureItem;
  zoom: number;
  toPage: (clientX: number, clientY: number) => { x: number; y: number };
  onDone: () => void;
}) {
  const { item, zoom } = props;
  const url = useAssetURL(props.doc, item.file);
  const start: Crop = item.crop ?? [0, 0, 1, 1];
  const [draft, setDraft] = useState<Crop>(start);
  const drag = useRef<{ grip: Grip; origin: Crop; at: { x: number; y: number } } | null>(null);
  const W = item.w / start[2], H = item.h / start[3];
  const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);

  // A point of the window as a fraction of the whole picture.
  const fraction = (clientX: number, clientY: number) => {
    const page = props.toPage(clientX, clientY);
    const dx = page.x - item.x, dy = page.y - item.y;
    const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
    return { x: (localX + item.w / 2 + start[0] * W) / W, y: (localY + item.h / 2 + start[1] * H) / H };
  };

  const finish = (commit: boolean) => {
    if (commit) {
      const next = croppedItem(item, draft);
      props.doc.updateItem(props.pageID, item.id, "Crop", (target) => {
        if (target.kind !== "image") return;
        target.x = next.x; target.y = next.y; target.w = next.w; target.h = next.h;
        if (next.crop) target.crop = next.crop; else delete target.crop;
      });
    }
    props.onDone();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); finish(false); }
      else if (event.key === "Enter") { event.stopPropagation(); finish(true); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const begin = (grip: Grip) => (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
    drag.current = { grip, origin: draft, at: fraction(event.clientX, event.clientY) };
  };
  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const at = fraction(event.clientX, event.clientY);
    const [ox, oy, ow, oh] = state.origin;
    let left = ox, top = oy, right = ox + ow, bottom = oy + oh;
    if (state.grip === "move") {
      const dx = at.x - state.at.x, dy = at.y - state.at.y;
      const x = Math.min(Math.max(ox + dx, 0), 1 - ow), y = Math.min(Math.max(oy + dy, 0), 1 - oh);
      return setDraft([x, y, ow, oh]);
    }
    if (state.grip.includes("w")) left = Math.min(Math.max(at.x, 0), right - MIN);
    if (state.grip.includes("e")) right = Math.max(Math.min(at.x, 1), left + MIN);
    if (state.grip.includes("n")) top = Math.min(Math.max(at.y, 0), bottom - MIN);
    if (state.grip.includes("s")) bottom = Math.max(Math.min(at.y, 1), top + MIN);
    setDraft(clampCrop([left, top, right - left, bottom - top]));
  };
  const end = () => { drag.current = null; };

  // Local pixels, with the item's old centre as the origin; the wrapper turns with the item.
  const picLeft = (-item.w / 2 - start[0] * W) * zoom, picTop = (-item.h / 2 - start[1] * H) * zoom;
  const picW = W * zoom, picH = H * zoom;
  const cropLeft = picLeft + draft[0] * picW, cropTop = picTop + draft[1] * picH, cropW = draft[2] * picW, cropH = draft[3] * picH;
  const grips: [Grip, number, number, string][] = [
    ["nw", 0, 0, "nwse-resize"], ["n", 0.5, 0, "ns-resize"], ["ne", 1, 0, "nesw-resize"], ["e", 1, 0.5, "ew-resize"],
    ["se", 1, 1, "nwse-resize"], ["s", 0.5, 1, "ns-resize"], ["sw", 0, 1, "nesw-resize"], ["w", 0, 0.5, "ew-resize"],
  ];

  return (
    <>
      <div
        data-hot
        data-testid="crop-view"
        style={{ position: "absolute", left: item.x * zoom, top: item.y * zoom, width: 0, height: 0, transform: item.rotation ? `rotate(${item.rotation}rad)` : undefined, transformOrigin: "0 0", zIndex: 6 }}
      >
        {url && <img src={url} alt="" draggable={false} style={{ position: "absolute", left: picLeft, top: picTop, width: picW, height: picH, maxWidth: "none", opacity: 0.35 }} />}
        <div style={{ position: "absolute", left: picLeft, top: picTop, width: picW, height: picH, outline: "1px dashed var(--ink)", pointerEvents: "none" }} />
        <div
          onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          style={{ position: "absolute", left: cropLeft, top: cropTop, width: cropW, height: cropH, overflow: "hidden", cursor: "move", touchAction: "none", outline: "1.5px solid var(--ink)", boxShadow: "0 0 0 1.5px var(--mustard)" }}
          data-testid="crop-rect"
        >
          {url && <img src={url} alt="" draggable={false} style={{ position: "absolute", left: picLeft - cropLeft, top: picTop - cropTop, width: picW, height: picH, maxWidth: "none", pointerEvents: "none" }} />}
        </div>
        {grips.map(([grip, gx, gy, cursor]) => (
          <div
            key={grip}
            data-testid={`crop-${grip}`}
            onPointerDown={begin(grip)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            style={{ position: "absolute", left: cropLeft + gx * cropW - 7, top: cropTop + gy * cropH - 7, width: 14, height: 14, background: "var(--board)", border: "1.5px solid var(--ink)", borderRadius: 3, cursor, touchAction: "none" }}
          />
        ))}
      </div>
      {createPortal(
        <div className="plate float-bar crop-bar" data-testid="crop-bar">
          <button type="button" className="btn small" onClick={() => finish(false)} data-testid="crop-cancel">Cancel</button>
          <button type="button" className="btn small primary" onClick={() => finish(true)} data-testid="crop-done">Done</button>
        </div>,
        document.body,
      )}
    </>
  );
}
