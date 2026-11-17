// Locked notebooks. Windows Hello is tried first once the Rust side offers it; until then, and wherever Hello
// isn't set up, a PIN does the job. A lock hides a notebook in the app and does not encrypt its files.

import { ask } from "../design/controls";
import { invoke, isTauri } from "../platform/host";
import { changeNotebook, closeTabIfOpen, notify, setAuthenticator, updateSettings, useApp } from "../state/app";
import { hashPin, newSalt, pinMatches, validPin } from "./pin";
import { t } from "../i18n";

async function helloVerify(reason: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return (await invoke<boolean>("hello_verify", { reason })) === true;
  } catch {
    // The command isn't there yet, or Hello isn't set up on this PC: the PIN takes over.
    return false;
  }
}

/** Asks for a new PIN twice and keeps its hash. False if the user backs out or the two don't agree. */
export async function setPin(): Promise<boolean> {
  const first = await ask({ title: t("Set a PIN"), message: t("Four or more digits. It opens locked notebooks when Windows Hello can't."), confirm: t("Next"), password: true });
  if (first === null) return false;
  if (!validPin(first)) {
    notify(t("A PIN is four or more digits."), "trouble");
    return false;
  }
  const second = await ask({ title: t("Enter the PIN again"), confirm: t("Set PIN"), password: true });
  if (second === null) return false;
  if (second !== first) {
    notify(t("The two PINs didn't match. Nothing was changed."), "trouble");
    return false;
  }
  const salt = newSalt();
  updateSettings({ pinHash: await hashPin(first, salt), pinSalt: salt });
  return true;
}

async function askPin(reason: string): Promise<boolean> {
  const { pinHash, pinSalt } = useApp.getState().settings;
  const pin = await ask({ title: t("Enter your PIN"), message: reason, confirm: t("Unlock"), password: true });
  if (pin === null) return false;
  if (await pinMatches(pin, pinHash, pinSalt)) return true;
  notify(t("That PIN isn't right."), "trouble");
  return false;
}

/** Proves it is the owner: Windows Hello if it answers, otherwise the PIN (set on first use). */
export async function authenticate(reason: string): Promise<boolean> {
  if (await helloVerify(reason)) return true;
  if (useApp.getState().settings.pinHash === null) return setPin();
  return askPin(reason);
}

/** Asks for the current PIN, then for a new one. */
export async function changePin(): Promise<boolean> {
  if (useApp.getState().settings.pinHash !== null && !(await askPin(t("Enter the current PIN first.")))) return false;
  const done = await setPin();
  if (done) notify(t("PIN changed."));
  return done;
}

export async function lockNotebook(id: string): Promise<void> {
  const title = useApp.getState().manifests[id]?.title ?? t("this notebook");
  if (!(await authenticate(t("Lock “{name}”", { name: title })))) return;
  // Closed first, so it can't stay open on screen after it is locked.
  if (!(await closeTabIfOpen(id))) return;
  await changeNotebook(id, (manifest) => { manifest.locked = true; });
  notify(t("Locked. It is hidden in the app, not encrypted."));
}

export async function unlockNotebook(id: string): Promise<void> {
  const title = useApp.getState().manifests[id]?.title ?? t("this notebook");
  if (!(await authenticate(t("Remove the lock from “{name}”", { name: title })))) return;
  await changeNotebook(id, (manifest) => { manifest.locked = false; });
}

setAuthenticator(authenticate);
