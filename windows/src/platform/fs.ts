// Where files live. The app runs on the library folder through Tauri; in a plain browser (development and
// tests) the same calls land in IndexedDB or in memory.

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface FS {
  /** A file's bytes, or null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** Replaces the file whole: a reader sees the old bytes or the new, never half. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  list(dir: string): Promise<FileEntry[]>;
  /** Removes a file, or a folder and all in it. Nothing there is not an error. */
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

export async function readText(fs: FS, path: string): Promise<string | null> {
  const bytes = await fs.read(path);
  return bytes ? decoder.decode(bytes) : null;
}

function clean(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) throw new Error(`path leaves the library: ${path}`);
  return parts.join("/");
}

/** Every file under `dir`, as paths relative to it. */
export async function listAll(fs: FS, dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (folder: string, prefix: string) => {
    for (const entry of await fs.list(folder)) {
      if (entry.isDir) await walk(`${folder}/${entry.name}`, `${prefix}${entry.name}/`);
      else out.push(prefix + entry.name);
    }
  };
  await walk(dir, "");
  return out;
}

export class MemoryFS implements FS {
  files = new Map<string, { data: Uint8Array; modified: number }>();
  /** Set to make the next writes fail, for testing what a full disk does. */
  failWrites = false;

  async read(path: string) {
    return this.files.get(clean(path))?.data ?? null;
  }

  async write(path: string, data: Uint8Array | string) {
    if (this.failWrites) throw new Error("disk full");
    this.files.set(clean(path), { data: bytesOf(data).slice(), modified: Date.now() });
  }

  async list(dir: string) {
    const base = clean(dir);
    const prefix = base === "" ? "" : base + "/";
    const entries = new Map<string, FileEntry>();
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) entries.set(rest, { name: rest, isDir: false, size: file.data.length, modified: file.modified });
      else {
        const name = rest.slice(0, slash);
        if (!entries.has(name)) entries.set(name, { name, isDir: true, size: 0, modified: file.modified });
      }
    }
    return [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async remove(path: string) {
    const target = clean(path);
    if (target === "") throw new Error("refusing to remove the library itself");
    this.files.delete(target);
    for (const key of [...this.files.keys()]) if (key.startsWith(target + "/")) this.files.delete(key);
  }

  async rename(from: string, to: string) {
    const source = clean(from), target = clean(to);
    const moved: [string, { data: Uint8Array; modified: number }][] = [];
    for (const [key, file] of this.files) {
      if (key === source) moved.push([target, file]);
      else if (key.startsWith(source + "/")) moved.push([target + key.slice(source.length), file]);
    }
    if (moved.length === 0) throw new Error(`no such file: ${from}`);
    for (const key of [...this.files.keys()]) if (key === source || key.startsWith(source + "/")) this.files.delete(key);
    for (const [key, file] of moved) this.files.set(key, file);
  }
}

/** Files kept in the browser's IndexedDB, one record a file. */
export class IdbFS implements FS {
  private db: Promise<IDBDatabase>;

  constructor(name = "owlluna-library") {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("files", mode);
      const request = work(transaction.objectStore("files"));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private range(prefix: string): IDBKeyRange | undefined {
    return prefix === "" ? undefined : IDBKeyRange.bound(prefix, prefix + "￿");
  }

  async read(path: string) {
    const record = await this.run<{ data: Uint8Array } | undefined>("readonly", (store) => store.get(clean(path)));
    return record?.data ?? null;
  }

  async write(path: string, data: Uint8Array | string) {
    const bytes = bytesOf(data).slice();
    await this.run("readwrite", (store) => store.put({ data: bytes, modified: Date.now() }, clean(path)));
  }

  async list(dir: string) {
    const base = clean(dir);
    const prefix = base === "" ? "" : base + "/";
    const db = await this.db;
    const entries = new Map<string, FileEntry>();
    await new Promise<void>((resolve, reject) => {
      const cursor = db.transaction("files", "readonly").objectStore("files").openCursor(this.range(prefix));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        const rest = String(at.key).slice(prefix.length);
        const slash = rest.indexOf("/");
        const value = at.value as { data: Uint8Array; modified: number };
        if (slash === -1) entries.set(rest, { name: rest, isDir: false, size: value.data.length, modified: value.modified });
        else if (!entries.has(rest.slice(0, slash))) entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), isDir: true, size: 0, modified: value.modified });
        at.continue();
      };
    });
    return [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async remove(path: string) {
    const target = clean(path);
    if (target === "") throw new Error("refusing to remove the library itself");
    await this.run("readwrite", (store) => {
      store.delete(target);
      store.delete(IDBKeyRange.bound(target + "/", target + "/￿"));
    });
  }

  async rename(from: string, to: string) {
    const source = clean(from), target = clean(to);
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      let moved = 0;
      const single = store.get(source);
      single.onsuccess = () => {
        if (single.result) {
          store.put(single.result, target);
          store.delete(source);
          moved++;
        }
        const cursor = store.openCursor(IDBKeyRange.bound(source + "/", source + "/￿"));
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at) {
            if (moved === 0) transaction.abort();
            return;
          }
          store.put(at.value, target + String(at.key).slice(source.length));
          at.delete();
          moved++;
          at.continue();
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error(`no such file: ${from}`));
    });
  }
}

type Invoke = (command: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;

/** The library folder itself, through the Rust shell. */
export class TauriFS implements FS {
  constructor(private invoke: Invoke) {}

  async read(path: string) {
    try {
      const reply = await this.invoke("fs_read", { path: clean(path) });
      return new Uint8Array(reply as ArrayBuffer);
    } catch (error) {
      if (String(error).includes("ENOENT")) return null;
      throw new Error(String(error));
    }
  }

  async write(path: string, data: Uint8Array | string) {
    await this.invoke("fs_write", bytesOf(data), { headers: { "x-path": encodeURIComponent(clean(path)) } });
  }

  async list(dir: string) {
    return (await this.invoke("fs_list", { path: clean(dir) })) as FileEntry[];
  }

  async remove(path: string) {
    const target = clean(path);
    if (target === "") throw new Error("refusing to remove the library itself");
    await this.invoke("fs_remove", { path: target });
  }

  async rename(from: string, to: string) {
    await this.invoke("fs_rename", { from: clean(from), to: clean(to) });
  }
}
