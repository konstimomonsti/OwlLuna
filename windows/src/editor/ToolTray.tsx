// The tool tray: one board at the foot of the editor, over the desk. Up to eight pens, the eraser, the lasso and
// the shortcuts the user picked. Tapping the tool in hand opens its options.

import {
  Circle, Eraser, Image, Lasso, Link2, MoveUpRight, Plus, Ruler, Shapes, Slash, Square, StickyNote, Tally1, Trash2, Triangle, Type, ZoomIn, Languages, Hand,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { anchorAbove, IconButton, Menu, MenuBreak, MenuRow, Segmented, type MenuAnchor } from "../design/controls";
import { t, tn } from "../i18n";
import { inkKindName } from "../i18n/names";
import { uuid } from "../model/ids";
import {
  clampWidth, colorFromHex, colorName, hexCSS, inkKinds, maxPens, opacityOf, paletteFor, rgbaCSS, shapeKinds, tintOf, widthAt, widthRanges,
  widthTravel, withOpacity, withTint, type EraserMode, type InkKind, type ShapeKind, type ToolPreset,
} from "../model/tools";
import { updateSettings, useApp } from "../state/app";
import type { TrayShortcut } from "../storage/libraryFiles";
import { setTool, type Session } from "./session";

/** A pen as the tray shows it: its ink as a blot, as wide as it writes. */
export function InkBlot(props: { pen: ToolPreset; size?: number }) {
  const size = props.size ?? 30;
  const [low, high] = widthRanges[props.pen.ink];
  const weight = 1.6 + ((props.pen.width - low) / Math.max(high - low, 1)) ** 0.5 * 7;
  const marker = props.pen.ink === "highlighter";
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <path
        d={marker ? "M5 15h20" : "M5 19c4-9 6-9 8-3s4 6 6 0 3-6 6-2"}
        fill="none"
        stroke={rgbaCSS(props.pen.color, marker ? 1 : 1)}
        strokeOpacity={opacityOf(props.pen.color) * (props.pen.ink === "watercolour" ? 0.55 : 1)}
        strokeWidth={marker ? Math.max(weight * 1.4, 7) : weight}
        strokeLinecap={marker ? "butt" : "round"}
        strokeLinejoin="round"
        strokeDasharray={props.pen.ink === "pencil" || props.pen.ink === "crayon" ? "1.2 0.5" : undefined}
      />
    </svg>
  );
}

const shapeIcons: Record<ShapeKind, ReactNode> = {
  line: <Slash />, arrow: <MoveUpRight />, circle: <Circle />, rectangle: <Square />, triangle: <Triangle />,
};
const shapeNames: Record<ShapeKind, string> = { line: tn("Line"), arrow: tn("Arrow"), circle: tn("Circle"), rectangle: tn("Rectangle"), triangle: tn("Triangle") };

export interface TrayActions {
  addPicture(): void;
  addSticker(anchor: MenuAnchor): void;
  addLink(): void;
  toggleRuler(): void;
  toggleZoomWindow(): void;
  inkToText(): void;
}

export function ToolTray(props: { session: Session; actions: TrayActions }) {
  const { session } = props;
  const tool = useStore(session, (state) => state.tool);
  const shape = useStore(session, (state) => state.shape);
  const ruler = useStore(session, (state) => state.ruler !== null);
  const zoomWindow = useStore(session, (state) => state.zoomWindow !== null);
  const pens = useApp((state) => state.settings.pens);
  const shortcuts = useApp((state) => state.settings.trayShortcuts);
  const leftHanded = useApp((state) => state.settings.leftHanded);
  const [menu, setMenu] = useState<{ kind: "pen"; id: string; anchor: MenuAnchor } | { kind: "eraser" | "shapes"; anchor: MenuAnchor } | null>(null);

  const pickPen = (pen: ToolPreset, element: Element) => {
    if (tool.kind === "pen" && tool.penID === pen.id) setMenu({ kind: "pen", id: pen.id, anchor: anchorAbove(element) });
    else setTool(session, { kind: "pen", penID: pen.id });
  };
  const addPen = () => {
    const model = pens.find((pen) => tool.kind === "pen" && pen.id === tool.penID) ?? pens[pens.length - 1];
    const pen: ToolPreset = { ...(model ?? { ink: "pen" as InkKind, color: 0x1b2230ff, width: 2.4 }), id: uuid() };
    updateSettings({ pens: [...pens, pen] });
    setTool(session, { kind: "pen", penID: pen.id });
  };

  const shortcut = (name: TrayShortcut): ReactNode => {
    switch (name) {
      case "picture": return <IconButton key={name} label={t("Picture")} onClick={props.actions.addPicture} testid="tool-picture"><Image /></IconButton>;
      case "text": return <IconButton key={name} label={t("Text Box")} on={tool.kind === "text"} onClick={() => setTool(session, { kind: "text" })} testid="tool-text"><Type /></IconButton>;
      case "sticker": return <IconButton key={name} label={t("Sticker")} onClick={(event) => props.actions.addSticker(anchorAbove(event.currentTarget))} testid="tool-sticker"><StickyNote /></IconButton>;
      case "link": return <IconButton key={name} label={t("Link")} onClick={props.actions.addLink} testid="tool-link"><Link2 /></IconButton>;
      case "tape": return <IconButton key={name} label={t("Study Tape")} on={tool.kind === "tape"} onClick={() => setTool(session, { kind: "tape" })} testid="tool-tape"><Tally1 style={{ transform: "rotate(90deg) scale(1.3)" }} /></IconButton>;
      case "ruler": return <IconButton key={name} label={t("Ruler")} on={ruler} onClick={props.actions.toggleRuler} testid="tool-ruler"><Ruler /></IconButton>;
      case "zoomWindow": return <IconButton key={name} label={t("Zoom Window")} on={zoomWindow} onClick={props.actions.toggleZoomWindow} testid="tool-zoom-window"><ZoomIn /></IconButton>;
      case "inkToText": return <IconButton key={name} label={t("Handwriting to Text")} onClick={props.actions.inkToText} testid="tool-ink-to-text"><Languages /></IconButton>;
      case "shapes": return (
        <IconButton
          key={name}
          label={t("Shapes: {shape}", { shape: t(shapeNames[shape]) })}
          on={tool.kind === "shape"}
          testid="tool-shapes"
          onClick={(event) => {
            if (tool.kind === "shape") setMenu({ kind: "shapes", anchor: anchorAbove(event.currentTarget) });
            else setTool(session, { kind: "shape", shape });
          }}
        >
          {tool.kind === "shape" ? shapeIcons[shape] : <Shapes />}
        </IconButton>
      );
    }
  };

  const editing = menu?.kind === "pen" ? pens.find((pen) => pen.id === menu.id) : undefined;
  return (
    <div className="tool-tray board" data-testid="tool-tray" style={{ flexDirection: leftHanded ? "row-reverse" : "row" }} role="toolbar" aria-label={t("Tools")}>
      <div className="row" style={{ gap: 2 }}>
        {pens.map((pen, index) => (
          <button
            key={pen.id}
            type="button"
            className={`pen-label${tool.kind === "pen" && tool.penID === pen.id ? " on" : ""}`}
            title={`${inkKindName(pen.ink)}, ${t(colorName(pen.color))}`}
            aria-label={`${inkKindName(pen.ink)}, ${t(colorName(pen.color))}`}
            aria-pressed={tool.kind === "pen" && tool.penID === pen.id}
            data-testid={`pen-${index}`}
            onClick={(event) => pickPen(pen, event.currentTarget)}
          >
            <InkBlot pen={pen} />
          </button>
        ))}
        {pens.length < maxPens && <IconButton label={t("Add Pen")} onClick={addPen} testid="add-pen"><Plus /></IconButton>}
      </div>
      <div className="tray-rule" />
      <div className="row" style={{ gap: 2 }}>
        <IconButton
          label={t("Eraser")}
          on={tool.kind === "eraser"}
          testid="tool-eraser"
          onClick={(event) => {
            if (tool.kind === "eraser") setMenu({ kind: "eraser", anchor: anchorAbove(event.currentTarget) });
            else setTool(session, { kind: "eraser" });
          }}
        >
          <Eraser />
        </IconButton>
        <IconButton label={t("Lasso")} on={tool.kind === "lasso"} onClick={() => setTool(session, { kind: "lasso" })} testid="tool-lasso"><Lasso /></IconButton>
        <IconButton label={t("Move the Page")} on={tool.kind === "hand"} onClick={() => setTool(session, { kind: "hand" })} testid="tool-hand"><Hand /></IconButton>
      </div>
      {shortcuts.length > 0 && <div className="tray-rule" />}
      <div className="row" style={{ gap: 2 }}>{shortcuts.map(shortcut)}</div>

      {editing && menu?.kind === "pen" && <PenOptions pen={editing} anchor={menu.anchor} canDelete={pens.length > 1} onClose={() => setMenu(null)} session={session} />}
      {menu?.kind === "eraser" && <EraserOptions anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.kind === "shapes" && (
        <Menu anchor={menu.anchor} title={t("Shapes")} onClose={() => setMenu(null)}>
          {shapeKinds.map((kind) => (
            <MenuRow key={kind} icon={shapeIcons[kind]} chosen={kind === shape} onClick={() => { session.setState({ shape: kind }); setTool(session, { kind: "shape", shape: kind }); setMenu(null); }}>
              {t(shapeNames[kind])}
            </MenuRow>
          ))}
        </Menu>
      )}
    </div>
  );
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)) * 255);
  };
  return "#" + [f(5), f(3), f(1)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToHsv(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function Strip(props: { value: number; max: number; background: string; label: string; onChange: (value: number) => void; testid?: string }) {
  return (
    <label className="strip" style={{ background: props.background }}>
      <input type="range" min={0} max={props.max} step={props.max / 200} value={props.value} aria-label={props.label} data-testid={props.testid} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

function PenOptions(props: { pen: ToolPreset; anchor: MenuAnchor; canDelete: boolean; onClose: () => void; session: Session }) {
  const { pen } = props;
  const pens = useApp((state) => state.settings.pens);
  const [mixing, setMixing] = useState(false);
  const change = (patch: Partial<ToolPreset>) => updateSettings({ pens: pens.map((candidate) => (candidate.id === pen.id ? { ...candidate, ...patch } : candidate)) });
  const palette = paletteFor(pen.ink);
  const [h, s, v] = hexToHsv(hexCSS(pen.color));
  const setHSV = (nh: number, ns: number, nv: number) => change({ color: withTint(pen.color, colorFromHex(hsvToHex(nh, ns, nv))) });
  return (
    <Menu anchor={props.anchor} title={inkKindName(pen.ink)} onClose={props.onClose} width={296} testid="pen-options">
      <div className="pen-options" onPointerDown={(event) => event.stopPropagation()}>
        <div className="kind-grid">
          {inkKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`kind${kind === pen.ink ? " on" : ""}`}
              aria-pressed={kind === pen.ink}
              data-testid={`kind-${kind}`}
              onClick={() => {
                // A pen that becomes a highlighter takes a highlighter's width and faintness, and the reverse.
                const travel = widthTravel(pen);
                const becameMarker = kind === "highlighter" && pen.ink !== "highlighter", leftMarker = kind !== "highlighter" && pen.ink === "highlighter";
                change({
                  ink: kind,
                  width: clampWidth(kind, widthAt(travel, kind)),
                  color: becameMarker ? withOpacity(pen.color, 0.45) : leftMarker ? withOpacity(pen.color, 1) : pen.color,
                });
              }}
            >
              <InkBlot pen={{ ...pen, ink: kind, width: widthAt(0.45, kind) }} size={26} />
              <span>{inkKindName(kind)}</span>
            </button>
          ))}
        </div>
        <div className="swatches">
          {palette.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch${tintOf(pen.color) === color ? " on" : ""}`}
              style={{ background: hexCSS(color) }}
              title={t(colorName(color))}
              aria-label={t(colorName(color))}
              aria-pressed={tintOf(pen.color) === color}
              data-testid={`swatch-${hexCSS(color).slice(1)}`}
              onClick={() => change({ color: withTint(pen.color, color) })}
            />
          ))}
          <button type="button" className={`swatch mix${mixing ? " on" : ""}`} title={t("Mix a Colour")} aria-label={t("Mix a Colour")} aria-pressed={mixing} onClick={() => setMixing(!mixing)} data-testid="mix-colour" />
        </div>
        {mixing && (
          <div className="mixer">
            <span className="blot" style={{ background: hexCSS(pen.color) }} />
            <div className="grow column" style={{ gap: 6 }}>
              <Strip label={t("Hue")} value={h} max={360} onChange={(value) => setHSV(value, Math.max(s, 0.5), Math.max(v, 0.35))} background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" testid="hue-strip" />
              <Strip label={t("Shade")} value={v} max={1} onChange={(value) => setHSV(h, s, value)} background={`linear-gradient(90deg, #000, ${hsvToHex(h, Math.max(s, 0.5), 1)})`} />
              <Strip label={t("Strength")} value={s} max={1} onChange={(value) => setHSV(h, value, v)} background={`linear-gradient(90deg, ${hsvToHex(h, 0, v)}, ${hsvToHex(h, 1, v)})`} />
            </div>
          </div>
        )}
        <label className="slider-row">
          <span>{t("Width")}</span>
          <input type="range" min={0} max={1} step={0.005} value={widthTravel(pen)} data-testid="pen-width" onChange={(event) => change({ width: widthAt(Number(event.target.value), pen.ink) })} />
          <span className="meta">{pen.width < 10 ? pen.width.toFixed(1) : Math.round(pen.width)} pt</span>
        </label>
        <label className="slider-row">
          <span>{t("Opacity")}</span>
          <input type="range" min={0.1} max={1} step={0.01} value={opacityOf(pen.color)} data-testid="pen-opacity" onChange={(event) => change({ color: withOpacity(pen.color, Number(event.target.value)) })} />
          <span className="meta">{Math.round(opacityOf(pen.color) * 100)}%</span>
        </label>
      </div>
      <MenuBreak />
      <MenuRow
        icon={<Trash2 />}
        destructive
        disabled={!props.canDelete}
        testid="delete-pen"
        onClick={() => {
          const rest = pens.filter((candidate) => candidate.id !== pen.id);
          updateSettings({ pens: rest });
          setTool(props.session, { kind: "pen", penID: rest[0].id });
          props.onClose();
        }}
      >
        {t("Remove This Pen")}
      </MenuRow>
    </Menu>
  );
}

function EraserOptions(props: { anchor: MenuAnchor; onClose: () => void }) {
  const mode = useApp((state) => state.settings.eraserMode);
  const width = useApp((state) => state.settings.eraserWidth);
  return (
    <Menu anchor={props.anchor} title={t("Eraser")} onClose={props.onClose} width={300} testid="eraser-options">
      <div className="pen-options" onPointerDown={(event) => event.stopPropagation()}>
        <Segmented<EraserMode>
          label={t("What the eraser takes")}
          value={mode}
          onChange={(value) => updateSettings({ eraserMode: value })}
          options={[{ value: "stroke", label: t("Strokes") }, { value: "partial", label: t("Parts") }, { value: "highlighter", label: t("Highlighter") }]}
        />
        <p className="secondary" style={{ fontSize: 12 }}>
          {mode === "stroke" ? t("Takes each whole stroke it touches.") : mode === "partial" ? t("Rubs out only what is under it.") : t("Takes highlighter and leaves everything else.")}
        </p>
        <label className="slider-row">
          <span>{t("Size")}</span>
          <input type="range" min={4} max={60} step={1} value={width} onChange={(event) => updateSettings({ eraserWidth: Number(event.target.value) })} />
          <span className="meta">{width} pt</span>
        </label>
      </div>
    </Menu>
  );
}
