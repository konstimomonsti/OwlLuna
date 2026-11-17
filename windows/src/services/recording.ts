// Recording audio alongside a notebook. One recording at a time, bound to the notebook it began in; it goes on while
// pages change and is saved when it is stopped, or when the editor is left.

import { create } from "zustand";
import type { NotebookDocument } from "../editor/document";
import { nextRecordingName, pickRecordingType, recordingExtension } from "../editor/replayMath";
import { uuid } from "../model/ids";
import type { Recording } from "../model/notebook";
import { packageDir } from "../storage/package";

export interface RecorderState {
  /** The notebook being recorded, or null when nothing is. */
  notebook: string | null;
  startedAt: number;
}

export const useRecorder = create<RecorderState>(() => ({ notebook: null, startedAt: 0 }));

interface Live {
  doc: NotebookDocument;
  media: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  finished: Promise<Recording>;
}

let live: Live | null = null;
let starting = false;

export function recordingPath(notebook: string, file: string): string {
  return `${packageDir(notebook)}/recordings/${file}`;
}

/** What went wrong with the microphone, said so the user knows what to do. */
export function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "OwlLuna can't use the microphone. Allow it in Windows Settings, under Privacy and security, Microphone.";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "No microphone was found. Plug one in and try again.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return `The recording couldn't start: ${error instanceof Error ? error.message : String(error)}`;
}

export function isRecording(notebook?: string): boolean {
  return live !== null && (notebook === undefined || live.doc.id === notebook);
}

/** Starts recording for a notebook. Rejects with a message fit to show when it can't. */
export async function startRecording(doc: NotebookDocument): Promise<void> {
  if (live || starting) throw new Error("A recording is already running.");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This device can't record audio.");
  starting = true;
  try {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw new Error(microphoneProblem(error));
    }
    const mimeType = pickRecordingType((type) => MediaRecorder.isTypeSupported(type));
    const media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const finished = new Promise<Recording>((resolve, reject) => {
      media.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      media.onerror = () => reject(new Error("The recording stopped unexpectedly."));
      media.onstop = () => {
        void (async () => {
          try {
            const duration = Date.now() - startedAt;
            const type = media.mimeType || mimeType || "audio/webm";
            const blob = new Blob(chunks, { type });
            const file = `${uuid()}.${recordingExtension(type)}`;
            await doc.fs.write(recordingPath(doc.id, file), new Uint8Array(await blob.arrayBuffer()));
            const recording: Recording = { id: uuid(), file, startedAt, duration, name: nextRecordingName(doc.manifest.recordings ?? []) };
            doc.touch((manifest) => { manifest.recordings = [...(manifest.recordings ?? []), recording]; });
            resolve(recording);
          } catch (error) {
            reject(error);
          }
        })();
      };
    });
    live = { doc, media, stream, chunks, startedAt, finished };
    media.start(1000);
    useRecorder.setState({ notebook: doc.id, startedAt });
  } finally {
    starting = false;
  }
}

/** Stops the recording and saves it into the notebook. Resolves with the recording, or null when none was running. */
export async function stopRecording(): Promise<Recording | null> {
  const current = live;
  if (!current) return null;
  live = null;
  useRecorder.setState({ notebook: null, startedAt: 0 });
  try {
    if (current.media.state !== "inactive") current.media.stop();
    return await current.finished;
  } finally {
    for (const track of current.stream.getTracks()) track.stop();
  }
}

/** Stops a recording of this notebook, if there is one, and writes the notebook so the recording is in its manifest. */
export async function stopRecordingOf(doc: NotebookDocument): Promise<void> {
  if (!live || live.doc.id !== doc.id) return;
  await stopRecording();
  await doc.save().catch(() => {});
}

/** Removes a recording from a notebook and deletes its audio file. */
export async function deleteRecording(doc: NotebookDocument, recording: Recording): Promise<void> {
  doc.touch((manifest) => { manifest.recordings = (manifest.recordings ?? []).filter((candidate) => candidate.id !== recording.id); });
  try {
    await doc.fs.remove(recordingPath(doc.id, recording.file));
  } catch {
    // The file left behind costs only space.
  }
}

export function renameRecording(doc: NotebookDocument, recordingID: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  doc.touch((manifest) => {
    const found = manifest.recordings?.find((candidate) => candidate.id === recordingID);
    if (found) found.name = clean;
  });
}
