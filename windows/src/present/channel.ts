// The line between the presenter's window and the audience's. A BroadcastChannel carries it between browser tabs and,
// when it reaches, between Tauri windows; Tauri's own events carry it too, so either path works. Messages that arrive both
// ways are let through once.

import { uuid } from "../model/ids";
import { isTauri } from "../platform/host";
import { CHANNEL, Dedupe, isEnvelope, type Envelope, type PresentMessage } from "./logic";

export interface PresentLink {
  send(message: PresentMessage): void;
  close(): void;
}

export function openLink(onMessage: (message: PresentMessage) => void): PresentLink {
  const me = uuid();
  let n = 0;
  let closed = false;
  const dedupe = new Dedupe();
  const receive = (value: unknown) => {
    if (closed || !isEnvelope(value) || value.from === me || !dedupe.fresh(value)) return;
    onMessage(value.message);
  };

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => receive(event.data);
  } catch {
    channel = null;
  }

  let unlisten: (() => void) | null = null;
  if (isTauri) {
    void import("@tauri-apps/api/event")
      .then((events) => events.listen(CHANNEL, (event) => receive(event.payload)))
      .then((stop) => { if (closed) stop(); else unlisten = stop; })
      .catch(() => {});
  }

  return {
    send(message) {
      if (closed) return;
      const envelope: Envelope = { from: me, n: ++n, message };
      try { channel?.postMessage(envelope); } catch { /* A closed channel has nobody to tell. */ }
      if (isTauri) void import("@tauri-apps/api/event").then((events) => events.emit(CHANNEL, envelope)).catch(() => {});
    },
    close() {
      closed = true;
      channel?.close();
      unlisten?.();
    },
  };
}
