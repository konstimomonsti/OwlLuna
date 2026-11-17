// Recordings: the list in the side panel, and the bar that plays one back while the ink reappears as it was written.

import { Download, Pause, Pencil, Play, Trash2, X, Mic } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ask, confirm, EmptyPlate, IconButton, Segmented } from "../design/controls";
import "../design/study.css";
import type { Recording } from "../model/notebook";
import { safeFileName, saveFile } from "../platform/host";
import { deleteRecording, recordingPath, renameRecording } from "../services/recording";
import { notify } from "../state/app";
import type { NotebookDocument } from "./document";
import { clock, pageAtMoment, replayMoment } from "./replayMath";
import { goToPage, type Session } from "./session";
import { locale, t } from "../i18n";

const dateFormat = { format: (value: number) => new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(value) };

export function RecordingsPanel(props: { doc: NotebookDocument; session: Session; version: number; playing: string | null; onPlay: (recording: Recording) => void; onStop: () => void }) {
  const { doc, session } = props;
  const recordings = doc.manifest.recordings ?? [];

  const rename = async (recording: Recording) => {
    const name = await ask({ title: t("Rename Recording"), confirm: t("Rename"), value: recording.name });
    if (name !== null) renameRecording(doc, recording.id, name);
  };
  const remove = async (recording: Recording) => {
    if (!(await confirm({ title: t("Delete “{name}”?", { name: recording.name }), message: t("The audio is deleted from the notebook. The writing stays."), confirm: t("Delete"), destructive: true }))) return;
    if (props.playing === recording.id) props.onStop();
    await deleteRecording(doc, recording);
  };
  const exportAudio = async (recording: Recording) => {
    try {
      const data = await doc.fs.read(recordingPath(doc.id, recording.file));
      if (!data) throw new Error(t("The audio file is missing."));
      const extension = recording.file.split(".").pop() ?? "webm";
      await saveFile(`${safeFileName(recording.name, "Recording")}.${extension}`, data, { name: t("Audio"), extensions: [extension] });
    } catch (error) {
      notify(t("The audio couldn't be exported: {error}", { error: error instanceof Error ? error.message : String(error) }), "trouble");
    }
  };

  return (
    <aside className="side-panel right recordings-panel" data-testid="recordings-panel">
      <div className="side-head">
        <h3 className="display grow" style={{ fontSize: 16 }}>{t("Recordings")}</h3>
        <IconButton label={t("Close")} onClick={() => session.setState({ panel: null })} testid="recordings-close"><X /></IconButton>
      </div>
      <div className="side-body">
        {recordings.length === 0 ? (
          <EmptyPlate icon={<Mic />} title={t("No recordings")}>{t("Press the microphone in the bar to record while you write.")}</EmptyPlate>
        ) : (
          <div className="ledger">
            {[...recordings].reverse().map((recording) => (
              <div key={recording.id} className={`ledger-row recording-row${props.playing === recording.id ? " chosen" : ""}`} data-testid="recording-row" data-recording={recording.id}>
                <IconButton label={props.playing === recording.id ? t("Stop Replay") : t("Play")} onClick={() => (props.playing === recording.id ? props.onStop() : props.onPlay(recording))} testid="recording-play">
                  {props.playing === recording.id ? <Pause /> : <Play />}
                </IconButton>
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 600 }} data-testid="recording-name">{recording.name}</div>
                  <div className="meta">{dateFormat.format(recording.startedAt)} · {clock(recording.duration / 1000)}</div>
                </div>
                <IconButton label={t("Rename")} onClick={() => void rename(recording)} testid="recording-rename"><Pencil /></IconButton>
                <IconButton label={t("Export Audio")} onClick={() => void exportAudio(recording)} testid="recording-export"><Download /></IconButton>
                <IconButton label={t("Delete")} tone="tomato" onClick={() => void remove(recording)} testid="recording-delete"><Trash2 /></IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export interface ReplayHandle {
  recording: Recording;
  /** Moves the audio, and with it the ink, to a time in seconds. */
  seek(seconds: number): void;
}

const speeds = ["1", "1.5", "2"] as const;

/** The floating bar over the pages while a recording replays. */
export const ReplayBar = forwardRef<ReplayHandle, { doc: NotebookDocument; session: Session; recording: Recording; onClose: () => void }>(function ReplayBar(props, ref) {
  const { doc, session, recording } = props;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>("1");
  const [problem, setProblem] = useState<string | null>(null);
  const followed = useRef<string | null>(null);
  const lastFollow = useRef(0);
  const total = recording.duration / 1000;

  /** Brings the ink and the view to where the audio is. */
  const sync = (force = false) => {
    const element = audio.current;
    if (!element) return;
    const at = Math.min(element.currentTime, total);
    setSeconds(at);
    const moment = replayMoment(recording, at);
    session.setState({ replayFrom: recording.startedAt, replayUntil: moment });
    const now = performance.now();
    if (force || now - lastFollow.current >= 1000) {
      lastFollow.current = now;
      const target = pageAtMoment(doc.manifest.pages.map((page) => ({ pageID: page.id, strokes: doc.ink(page.id) })), recording, moment);
      if (target && target !== followed.current) {
        followed.current = target;
        goToPage(session, target);
      }
    }
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useImperativeHandle(ref, () => ({
    recording,
    seek(target) {
      const element = audio.current;
      if (!element) return;
      element.currentTime = Math.min(Math.max(target, 0), total);
      lastFollow.current = 0;
      syncRef.current(true);
    },
  }), [recording, total]);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    let frame = 0;
    const element = new Audio();
    audio.current = element;
    element.preload = "auto";
    void (async () => {
      // Every page's ink is read first, so the view can follow the writing to any of them.
      await doc.allInk().catch(() => {});
      const data = await doc.fs.read(recordingPath(doc.id, recording.file));
      if (!live) return;
      if (!data) {
        setProblem(t("The audio file is missing."));
        return;
      }
      const type = recording.file.endsWith(".ogg") ? "audio/ogg" : recording.file.endsWith(".m4a") ? "audio/mp4" : "audio/webm";
      url = URL.createObjectURL(new Blob([data.slice()], { type }));
      element.src = url;
      syncRef.current(true);
      // Pressing Play on a recording starts it; if the system won't allow that, the bar's Play button does.
      void element.play().catch(() => {});
    })().catch((error) => { if (live) setProblem(error instanceof Error ? error.message : String(error)); });

    // A recording made by the browser has no length in its header, so the audio reports an endless one until it has been run to the end once.
    element.addEventListener("loadedmetadata", () => {
      if (element.duration === Infinity) {
        const reset = () => { element.removeEventListener("timeupdate", reset); element.currentTime = 0; };
        element.addEventListener("timeupdate", reset);
        element.currentTime = 1e101;
      }
    });
    element.addEventListener("play", () => setPlaying(true));
    element.addEventListener("pause", () => setPlaying(false));
    element.addEventListener("ended", () => { setPlaying(false); syncRef.current(true); });
    element.addEventListener("seeked", () => syncRef.current(false));
    element.addEventListener("error", () => { if (live && element.src) setProblem(t("The audio couldn't be played.")); });
    const tick = () => {
      if (!element.paused) syncRef.current(false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    session.setState({ replayFrom: recording.startedAt, replayUntil: recording.startedAt });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      element.pause();
      element.removeAttribute("src");
      element.load();
      if (url) URL.revokeObjectURL(url);
      audio.current = null;
      // The pages show all their ink again.
      session.setState({ replayFrom: null, replayUntil: null });
    };
  }, [doc, session, recording]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = Number(speed);
  }, [speed, playing]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      if (element.ended || element.currentTime >= total - 0.05) element.currentTime = 0;
      void element.play().catch(() => setProblem(t("The audio couldn't be played.")));
    } else {
      element.pause();
    }
  };

  return (
    <div className="replay-bar board" role="toolbar" aria-label={t("Replay")} data-testid="replay-bar">
      <IconButton label={playing ? t("Pause") : t("Play")} onClick={toggle} disabled={problem !== null} testid="replay-toggle">{playing ? <Pause /> : <Play />}</IconButton>
      <span className="meta replay-name truncate" title={recording.name}>{problem ?? recording.name}</span>
      <input
        className="replay-scrub"
        type="range"
        min={0}
        max={Math.max(Math.round(total * 1000), 1)}
        step={50}
        value={Math.round(seconds * 1000)}
        aria-label={t("Position")}
        onChange={(event) => {
          const element = audio.current;
          if (!element) return;
          element.currentTime = Number(event.target.value) / 1000;
          lastFollow.current = 0;
          sync(true);
        }}
        data-testid="replay-scrubber"
      />
      <span className="meta replay-time" data-testid="replay-time">{clock(seconds)} / {clock(total)}</span>
      <Segmented label={t("Speed")} value={speed} onChange={setSpeed} options={speeds.map((value) => ({ value, label: `${value}x` }))} />
      <IconButton label={t("Close Replay")} onClick={props.onClose} testid="replay-close"><X /></IconButton>
    </div>
  );
});
