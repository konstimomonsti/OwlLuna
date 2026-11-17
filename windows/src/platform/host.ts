// What the app asks of the machine it runs on. In the Tauri window these go to Rust and Windows; in a plain
// browser (development and tests) they fall back to what a page can do.

import { IdbFS, TauriFS, type FS } from "./fs";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type InvokeOptions = { headers: Record<string, string> };

export async function invoke<T = unknown>(command: string, args?: unknown, options?: InvokeOptions): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args as never, options as never);
}

let fs: FS | null = null;

/** The library. Tests put their own in with `useFS`. */
export function libraryFS(): FS {
  if (!fs) fs = isTauri ? new TauriFS(invoke) : new IdbFS();
  return fs;
}

export function useFS(replacement: FS): void {
  fs = replacement;
}

export interface PickedFile {
  name: string;
  data: Uint8Array;
}

export interface FileKind {
  name: string;
  extensions: string[];
}

/** Asks for files to open. Empty when the user cancels. */
export async function pickFiles(kinds: FileKind[], multiple = false): Promise<PickedFile[]> {
  if (isTauri) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const chosen = await dialog.open({ multiple, filters: kinds });
    const paths = chosen === null ? [] : Array.isArray(chosen) ? chosen : [chosen];
    const out: PickedFile[] = [];
    for (const path of paths) {
      const data = await invoke<ArrayBuffer>("read_external", { path });
      out.push({ name: path.split(/[\\/]/).pop() ?? path, data: new Uint8Array(data) });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = kinds.flatMap((kind) => kind.extensions.map((extension) => "." + extension)).join(",");
    input.style.display = "none";
    input.dataset.testid = "file-input";
    document.body.appendChild(input);
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(await Promise.all(files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))));
    };
    input.addEventListener("change", () => void finish());
    input.addEventListener("cancel", () => void finish());
    input.click();
  });
}

/** Asks where to save, and writes there. False when the user cancels. */
export async function saveFile(name: string, data: Uint8Array, kind: FileKind): Promise<boolean> {
  if (isTauri) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const path = await dialog.save({ defaultPath: name, filters: [kind] });
    if (!path) return false;
    await invoke("write_external", data, { headers: { "x-path": encodeURIComponent(path) } });
    return true;
  }
  const url = URL.createObjectURL(new Blob([data.slice()]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Asks for a folder. Null when the user cancels, or in a browser, which has none to give. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const chosen = await dialog.open({ directory: true, multiple: false });
  return typeof chosen === "string" ? chosen : null;
}

export async function openURL(url: string): Promise<void> {
  if (isTauri) {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** A file name Windows will take: no reserved characters, no trailing dot or space, not too long. */
export function safeFileName(name: string, fallback = "Untitled"): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120);
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback;
  return cleaned;
}

/** Hears the arguments of a second launch (the jump list's `--today` and `--quick-note`) in the running app. Does nothing in a browser. */
export async function onLaunchArgs(handler: (args: string[]) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const events = await import("@tauri-apps/api/event");
  return events.listen<string[]>("launch-args", (event) => handler(Array.isArray(event.payload) ? event.payload : []));
}
