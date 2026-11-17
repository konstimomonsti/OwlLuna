// The record button in the editor bar. While a recording runs it becomes a tomato square, the time so far, and Stop.

import { Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../design/controls";
import "../design/study.css";
import { notify } from "../state/app";
import { startRecording, stopRecording, useRecorder } from "../services/recording";
import { clock } from "./replayMath";
import type { NotebookDocument } from "./document";

export function RecorderControl(props: { doc: NotebookDocument }) {
  const { doc } = props;
  const recording = useRecorder((state) => state.notebook);
  const startedAt = useRecorder((state) => state.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!recording) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording]);

  if (recording === doc.id) {
    return (
      <div className="rec-live" data-testid="recording-live">
        <i className="rec-square" aria-hidden />
        <span className="meta rec-time" data-testid="recording-time">{clock((now - startedAt) / 1000)}</span>
        <button
          type="button"
          className="btn destructive small"
          onClick={() => void stopRecording().then((saved) => { if (saved) notify("Recording saved."); }).catch((error) => notify(error instanceof Error ? error.message : String(error), "trouble"))}
          data-testid="recording-stop"
        >
          <Square /> Stop
        </button>
      </div>
    );
  }
  return (
    <IconButton
      label={recording ? "Another notebook is being recorded" : "Record Audio"}
      disabled={recording !== null}
      onClick={() => void startRecording(doc).catch((error) => notify(error instanceof Error ? error.message : String(error), "trouble"))}
      testid="record"
    >
      <Mic />
    </IconButton>
  );
}
