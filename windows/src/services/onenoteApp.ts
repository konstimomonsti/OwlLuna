// The importer wired to the running app: its library, folders and open notebooks. Kept apart from `onenoteImport.ts`
// so that file can be tested without the app's state.

import { addFolder, documentIfOpen, useApp } from "../state/app";
import { tauriApi, pdfSizesOf, type ImportEnv } from "./onenoteImport";

/** Finds or makes the library folders for "Notebook › Group › Subgroup". */
export async function ensureFolderPath(path: string[]): Promise<string | null> {
  let parent: string | null = null;
  for (const name of path) {
    const found = useApp.getState().folders.find((folder) => folder.parent === parent && folder.name === name);
    parent = found ? found.id : (await addFolder(name, parent)).id;
  }
  return parent;
}

export function appEnv(): ImportEnv {
  return {
    fs: useApp.getState().fs,
    api: tauriApi,
    findExisting: (sectionID) => {
      const manifests = Object.values(useApp.getState().manifests);
      return manifests.find((manifest) => (manifest as unknown as { oneNote?: { sectionID?: string } }).oneNote?.sectionID === sectionID && manifest.kind === "notebook") ?? null;
    },
    isOpen: (id) => documentIfOpen(id) !== undefined,
    ensureFolder: ensureFolderPath,
    pdfSizes: pdfSizesOf,
    written: (manifest) => useApp.setState((state) => ({ manifests: { ...state.manifests, [manifest.id]: manifest } })),
  };
}

