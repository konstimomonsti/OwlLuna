// One side of a card: its clipping, if it has one, and its words.

import { useEffect, useState } from "react";
import type { CardSide } from "../model/flashcard";
import type { FS } from "../platform/fs";
import { readCardImage } from "./cardImages";

/** A clipping as a blob address, made while it is shown. */
export function useCardImage(fs: FS, notebook: string, file: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!file) return;
    let live = true;
    let made: string | null = null;
    void readCardImage(fs, notebook, file).then((data) => {
      if (!data || !live) return;
      made = URL.createObjectURL(new Blob([data.slice()], { type: "image/png" }));
      setUrl(made);
    }).catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fs, notebook, file]);
  return url;
}

export function CardFace(props: { fs: FS; notebook: string; side: CardSide; empty?: string }) {
  const url = useCardImage(props.fs, props.notebook, props.side.image);
  const { side } = props;
  return (
    <>
      {side.image && url && <img className="card-clip" src={url} alt="" draggable={false} />}
      {side.text.trim() !== "" && <div className="card-text">{side.text}</div>}
      {!side.image && side.text.trim() === "" && props.empty && <div className="card-text" style={{ opacity: 0.5 }}>{props.empty}</div>}
    </>
  );
}
