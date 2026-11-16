// A notebook's cover, drawn as one small SVG so it stays sharp at any size.

import { useEffect, useId, useState } from "react";
import { manifestThumbnailURL } from "../canvas/thumbnail";
import { seededRandom } from "../model/ids";
import { clothHex, risoHex, risoPaperStock, type CoverSpec, type Manifest } from "../model/notebook";
import { useApp } from "../state/app";

const LABEL_CREAM = "#F7F1E3";
const INK = "#1B2230";

/** Breaks a title into at most `maxLines` lines of about `width` characters, ending the last with an ellipsis if it is cut. */
export function wrapTitle(title: string, width: number, maxLines = 3): string[] {
  // A word longer than a line is broken where the line ends.
  const words: string[] = [];
  for (const word of title.trim().split(/\s+/).filter(Boolean)) {
    for (let at = 0; at < word.length; at += width) words.push(word.slice(at, at + width));
  }
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= maxLines) return lines.length ? lines : [""];
  const kept = lines.slice(0, maxLines);
  let end = kept[maxLines - 1];
  if (end.length >= width) end = end.slice(0, width - 1);
  kept[maxLines - 1] = end.replace(/[\s.,;:!?-]+$/, "") + "…";
  return kept;
}

/** The first page's picture, made when the cover first needs it. The last one stays on show while a newer one is made. */
function useFirstPage(manifest: Manifest | undefined, wanted: boolean): string | null {
  const fs = useApp((state) => state.fs);
  const [url, setUrl] = useState<string | null>(null);
  const first = manifest?.pages[0];
  const stamp = first ? `${first.id}:${first.inkHash ?? ""}:${first.items.length}:${first.background.kind}` : "";
  useEffect(() => {
    if (!wanted || !manifest || !first) {
      setUrl(null);
      return;
    }
    let live = true;
    manifestThumbnailURL(fs, manifest, first.id, 360).then((made) => { if (live) setUrl(made); }, () => { if (live) setUrl(null); });
    return () => { live = false; };
    // The manifest object changes with every edit; the stamp says whether the first page did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, wanted, manifest?.id, stamp]);
  return wanted ? url : null;
}

export function Cover(props: { title: string; cover: CoverSpec; whiteboard?: boolean; className?: string; manifest?: Manifest; locked?: boolean }) {
  const { cover } = props;
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const locked = props.locked === true;
  // A locked notebook never shows what is inside it, and its first-page cover reads as cloth.
  const picture = useFirstPage(props.manifest, cover.style === "firstPage" && !locked);
  const print = cover.style === "print";
  return (
    <svg className={props.className ?? "cover"} viewBox="0 0 300 400" role="img" aria-label={locked ? `${props.title}, locked` : props.title} preserveAspectRatio="xMidYMid slice" data-testid="cover">
      {print ? (
        <PrintCover title={props.title} cover={cover} whiteboard={props.whiteboard} locked={locked} />
      ) : picture ? (
        <FirstPageCover id={id} url={picture} cloth={clothHex[cover.cloth]} />
      ) : (
        <ClothCover id={id} title={props.title} cover={cover} whiteboard={props.whiteboard} locked={locked} />
      )}
    </svg>
  );
}

/** A small padlock, drawn from rectangles and an arc so it needs no icon font. */
function Padlock(props: { x: number; y: number; colour: string }) {
  return (
    <g transform={`translate(${props.x} ${props.y})`} data-testid="cover-lock">
      <path d="M-6 0V-5a6 6 0 0 1 12 0V0" fill="none" stroke={props.colour} strokeWidth="2.4" />
      <rect x="-9" y="0" width="18" height="14" rx="1.5" fill={props.colour} />
      <rect x="-1.4" y="4.5" width="2.8" height="5" fill="#F7F4EC" />
    </g>
  );
}

/** The first page behind a narrow cloth spine, the way a notebook with a clear cover looks. */
function FirstPageCover(props: { id: string; url: string; cloth: string }) {
  return (
    <>
      <rect width="300" height="400" fill="#FFFFFF" />
      <image href={props.url} x="26" y="0" width="274" height="400" preserveAspectRatio="xMidYMin slice" />
      <rect x="26" width="274" height="400" fill="none" stroke="rgba(27,34,48,0.25)" />
      <rect width="26" height="400" fill={props.cloth} />
      <rect width="26" height="400" fill="rgba(0,0,0,0.18)" />
      <rect x="26" width="2" height="400" fill="rgba(255,255,255,0.14)" />
      <rect x="24" width="2" height="400" fill="rgba(0,0,0,0.25)" />
    </>
  );
}

function ClothCover(props: { id: string; title: string; cover: CoverSpec; whiteboard?: boolean; locked?: boolean }) {
  const colour = clothHex[props.cover.cloth];
  const lines = wrapTitle(props.title, 15);
  const lineHeight = 30;
  const labelH = Math.max(110, 56 + lines.length * lineHeight + (props.whiteboard ? 22 : 0));
  const labelY = 200 - labelH / 2 - 10;
  const first = labelY + 28 + (props.whiteboard ? 0 : 6) + lineHeight * 0.5;
  return (
    <>
      <defs>
        <pattern id={`${props.id}w`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="none" />
          <path d="M0 .5H4" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
          <path d="M.5 0V4" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="300" height="400" fill={colour} />
      <rect width="300" height="400" fill={`url(#${props.id}w)`} />
      <rect width="26" height="400" fill="rgba(0,0,0,0.22)" />
      <rect x="26" width="2" height="400" fill="rgba(255,255,255,0.14)" />
      <rect x="24" width="2" height="400" fill="rgba(0,0,0,0.25)" />
      <rect x="62" y={labelY} width="206" height={labelH} fill={LABEL_CREAM} />
      <rect x="67" y={labelY + 5} width="196" height={labelH - 10} fill="none" stroke={INK} strokeOpacity="0.7" strokeWidth="1" />
      <rect x="71" y={labelY + 9} width="188" height={labelH - 18} fill="none" stroke={INK} strokeOpacity="0.7" strokeWidth="1" />
      {props.locked && <Padlock x={240} y={labelY + 22} colour={INK} />}
      {props.whiteboard && (
        <text x="165" y={labelY + 30} textAnchor="middle" fontFamily="Archivo, sans-serif" fontSize="10" fontWeight="700" letterSpacing="2.5" fill="#5A6070">WHITEBOARD</text>
      )}
      <text textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="25" fontWeight="600" fill={INK}>
        {lines.map((line, index) => (
          <tspan key={index} x="165" y={first + (props.whiteboard ? 28 : 12) + index * lineHeight}>{line}</tspan>
        ))}
      </text>
    </>
  );
}

function PrintCover(props: { title: string; cover: CoverSpec; whiteboard?: boolean; locked?: boolean }) {
  const { cover } = props;
  const random = seededRandom(cover.seed);
  const [a, b] = [risoHex[cover.inks[0]], risoHex[cover.inks[1]]];
  const circle = { cx: 70 + random() * 160, cy: 90 + random() * 120, r: 80 + random() * 50 };
  const block = { x: 20 + random() * 80, y: 150 + random() * 110, w: 140 + random() * 100, h: 110 + random() * 90, turn: (random() - 0.5) * 24 };
  const lines = wrapTitle(props.title.toUpperCase(), 13);
  const lineHeight = 28;
  const knockH = 26 + lines.length * lineHeight + (props.whiteboard ? 20 : 0);
  const knockY = 400 - 40 - knockH;
  return (
    <>
      <rect width="300" height="400" fill={risoPaperStock} />
      <g style={{ mixBlendMode: "multiply" }}>
        <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill={a} />
        <rect x={block.x} y={block.y} width={block.w} height={block.h} fill={b} transform={`rotate(${block.turn} ${block.x + block.w / 2} ${block.y + block.h / 2})`} />
      </g>
      <rect x="24" y={knockY} width="252" height={knockH} fill={risoPaperStock} />
      {props.locked && (
        <>
          <rect x="236" y={knockY - 36} width="40" height="36" fill={risoPaperStock} />
          <Padlock x={256} y={knockY - 20} colour="#1C1C21" />
        </>
      )}
      {props.whiteboard && (
        <text x="38" y={knockY + 20} fontFamily="Bricolage Grotesque, sans-serif" fontSize="10" fontWeight="700" letterSpacing="2.5" fill="#1C1C21">WHITEBOARD</text>
      )}
      <text fontFamily="Bricolage Grotesque, sans-serif" fontSize="25" fontWeight="800" fill="#1C1C21">
        {lines.map((line, index) => (
          <tspan key={index} x="38" y={knockY + (props.whiteboard ? 46 : 36) + index * lineHeight}>{line}</tspan>
        ))}
      </text>
    </>
  );
}
