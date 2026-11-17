// Scan from Camera: a live preview, a Capture button, and a picture file as the other way in. The picture becomes a new
// page; its printed words are read afterwards so search can find them.

import { Camera, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "../design/controls";
import "../design/study.css";
import { pickFiles } from "../platform/host";
import { appendPictures } from "../services/pdfImport";
import { readScannedPage } from "../services/scan";
import { notify } from "../state/app";
import type { NotebookDocument } from "./document";
import { goToPage, type Session } from "./session";

const PICTURES = [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];

function cameraProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "OwlLuna can't use the camera. Allow it in Windows Settings, under Privacy and security, Camera.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  return `The camera couldn't start: ${error instanceof Error ? error.message : String(error)}`;
}

export function ScanSheet(props: { doc: NotebookDocument; session: Session; afterPage: string; onClose: () => void }) {
  const { doc, session } = props;
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  // The camera runs only while the sheet is open.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This device can't use a camera.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
        setLive(true);
      } catch (error) {
        if (!stopped) setProblem(cameraProblem(error));
      }
    })();
    return () => {
      stopped = true;
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (video.current) video.current.srcObject = null;
    };
  }, []);

  const add = async (files: { name: string; data: Uint8Array }[]) => {
    setBusy(true);
    try {
      const pages = await appendPictures(doc, files, props.afterPage);
      if (pages[0]) goToPage(session, pages[0].id);
      props.onClose();
      // The words are read after the sheet has gone; the page is already there.
      if (pages.length === files.length) pages.forEach((page, index) => void readScannedPage(doc, page, files[index].data));
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "trouble");
      setBusy(false);
    }
  };

  const capture = async () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      notify("The picture couldn't be taken.", "trouble");
      return;
    }
    await add([{ name: "Scan.jpg", data: new Uint8Array(await blob.arrayBuffer()) }]);
  };

  const choose = async () => {
    const files = await pickFiles(PICTURES, true);
    if (files.length) await add(files);
  };

  return (
    <Sheet
      title="Scan from Camera"
      testid="scan-sheet"
      onClose={props.onClose}
      foot={
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => void choose()} data-testid="scan-choose"><ImagePlus /> Choose a Picture…</button>
          <button type="button" className="btn primary" disabled={!live || busy} onClick={() => void capture()} data-testid="scan-capture"><Camera /> Capture</button>
        </>
      }
    >
      {problem ? (
        <p className="field-error" role="alert" data-testid="scan-error">{problem}</p>
      ) : (
        <video ref={video} className="scan-video" muted playsInline data-testid="scan-video" />
      )}
    </Sheet>
  );
}
