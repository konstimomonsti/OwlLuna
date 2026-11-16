// The shell: the library or the open notebooks, the alerts over them, and the few shortcuts that work anywhere.

import { useEffect } from "react";
import { Notices, StampHost, useDark } from "./design/controls";
import { Editor } from "./editor/Editor";
import { Library } from "./library/Library";
import * as appActions from "./state/app";
import { documentIfOpen, loadLibrary, openToday, quickNote, saveAll, useApp } from "./state/app";

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}

export default function App() {
  const ready = useApp((state) => state.ready);
  const active = useApp((state) => state.active);
  const split = useApp((state) => state.split);
  const dark = useDark();

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __owlluna: unknown }).__owlluna = { useApp, appActions, documentIfOpen };
    }
  }, []);

  // Anything not yet written goes to disk when the window is closed or hidden.
  useEffect(() => {
    const save = () => void saveAll();
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("beforeunload", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event.target) || document.querySelector(".scrim")) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "t" && !event.shiftKey) {
        event.preventDefault();
        void openToday();
      } else if (key === "n" && event.shiftKey) {
        event.preventDefault();
        void quickNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const doc = active ? documentIfOpen(active) : undefined;
  const second = split ? documentIfOpen(split) : undefined;

  return (
    <div className="app" data-testid="app">
      {!ready ? (
        <div className="splash" data-testid="splash">
          <h1 className="display" style={{ fontSize: 44 }}>OwlLuna</h1>
        </div>
      ) : doc ? (
        <div className="app-body">
          <Editor key={doc.id} doc={doc} active />
          {second && second.id !== doc.id && <Editor key={`split-${second.id}`} doc={second} active={false} secondary />}
        </div>
      ) : (
        <Library />
      )}
      <StampHost />
      <Notices />
    </div>
  );
}
