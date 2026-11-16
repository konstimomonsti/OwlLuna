// Settings: one Fraunces heading over one ruled plate of rows for each part, with a note under it.

import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import pkg from "../../package.json";
import { confirm, Segmented, Sheet, Slab } from "../design/controls";
import { invoke, isTauri, libraryFS, openURL, pickFiles, pickFolder, saveFile, type FileKind } from "../platform/host";
import { backupFileName, BACKUP_SUFFIX, makeBackup, restoreBackup } from "../services/backup";
import { changePin } from "../services/lock";
import {
  clearWritingHistory, loadLibrary, notify, openSettings, resetApp, saveAll, updateSettings, useApp,
} from "../state/app";
import { allTrayShortcuts, trayShortcutNames, type PenAction, type Settings as SettingsData } from "../storage/libraryFiles";

const backupKind: FileKind = { name: "OwlLuna backup", extensions: [BACKUP_SUFFIX.slice(1)] };

const penActionNames: Record<PenAction, string> = {
  none: "Nothing", eraser: "Eraser", lasso: "Lasso", lastTool: "Previous Tool", undo: "Undo", redo: "Redo", inkDish: "Ink Dish",
};
const penActions = Object.keys(penActionNames) as PenAction[];

const languages: { value: SettingsData["language"]; label: string }[] = [
  { value: "system", label: "System" }, { value: "en", label: "English" }, { value: "es", label: "Español" }, { value: "fr", label: "Français" }, { value: "de", label: "Deutsch" },
];

const fonts = [
  { name: "Fraunces", file: "OFL-Fraunces.txt" },
  { name: "Archivo", file: "OFL-Archivo.txt" },
  { name: "Bricolage Grotesque", file: "OFL-BricolageGrotesque.txt" },
];

function Section(props: { title: string; note?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="settings-section" data-testid={props.testid}>
      <h3>{props.title}</h3>
      <div className="plate">{props.children}</div>
      {props.note && <p className="settings-note">{props.note}</p>}
    </section>
  );
}

function Row(props: { label: string; detail?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`settings-row${props.stack ? " stack" : ""}`}>
      <div className="grow">
        <div className="name">{props.label}</div>
        {props.detail && <div className="detail">{props.detail}</div>}
      </div>
      {props.children}
    </div>
  );
}

function ActionSelect(props: { label: string; value: PenAction; onChange: (value: PenAction) => void; testid: string }) {
  return (
    <Row label={props.label}>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as PenAction)} aria-label={props.label} data-testid={props.testid}>
        {penActions.map((action) => <option key={action} value={action}>{penActionNames[action]}</option>)}
      </select>
    </Row>
  );
}

export function Settings() {
  const settings = useApp((state) => state.settings);
  const fs = useApp((state) => state.fs);
  const set = updateSettings;
  const close = () => openSettings(false);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Sheet title="Settings" onClose={close} wide testid="settings-sheet" foot={<button type="button" className="btn primary" onClick={close} data-testid="settings-done">Done</button>}>
      <div className="settings-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Section title="Appearance">
          <Row label="Appearance">
            <Segmented<SettingsData["appearance"]>
              label="Appearance"
              value={settings.appearance}
              onChange={(appearance) => set({ appearance })}
              options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
            />
          </Row>
          <Row label="Left-handed layout" detail="Moves the tool tray and side panels to suit a left hand.">
            <Slab checked={settings.leftHanded} onChange={(leftHanded) => set({ leftHanded })} label="Left-handed layout" />
          </Row>
        </Section>

        <Section title="Writing" note="Draw and Hold straightens a shape when you pause at the end of a stroke. Scribble to Erase wipes out ink you scratch over. Loop to Select circles ink with the pen to select it.">
          <Row label="Draw With">
            <Segmented<SettingsData["drawWith"]>
              label="Draw with"
              value={settings.drawWith}
              onChange={(drawWith) => set({ drawWith })}
              options={[{ value: "pen", label: "Pen only" }, { value: "penAndFinger", label: "Pen and finger" }]}
            />
          </Row>
          <Row label="Page flow">
            <Segmented<SettingsData["pageFlow"]>
              label="Page flow"
              value={settings.pageFlow}
              onChange={(pageFlow) => set({ pageFlow })}
              options={[{ value: "continuous", label: "Continuous" }, { value: "single", label: "One page" }]}
            />
          </Row>
          <Row label="Draw and Hold"><Slab checked={settings.drawAndHold} onChange={(drawAndHold) => set({ drawAndHold })} label="Draw and Hold" /></Row>
          <Row label="Scribble to Erase"><Slab checked={settings.scribbleErase} onChange={(scribbleErase) => set({ scribbleErase })} label="Scribble to Erase" /></Row>
          <Row label="Loop to Select"><Slab checked={settings.loopSelect} onChange={(loopSelect) => set({ loopSelect })} label="Loop to Select" /></Row>
        </Section>

        <Section title="Pen and Touch" note="Use the pen test at the foot of this sheet to see what your pen's buttons report.">
          <ActionSelect label="Pen barrel button" value={settings.barrelButton} onChange={(barrelButton) => set({ barrelButton })} testid="pen-barrel" />
          <ActionSelect label="Pen second button" value={settings.secondButton} onChange={(secondButton) => set({ secondButton })} testid="pen-second" />
          <ActionSelect label="Two-finger tap" value={settings.twoFingerTap} onChange={(twoFingerTap) => set({ twoFingerTap })} testid="tap-two" />
          <ActionSelect label="Three-finger tap" value={settings.threeFingerTap} onChange={(threeFingerTap) => set({ threeFingerTap })} testid="tap-three" />
        </Section>

        <Section title="Tool Tray Shortcuts" note="The tools shown at the end of the tool tray.">
          <div role="group" aria-label="Tool tray shortcuts" style={{ padding: 4 }}>
            {allTrayShortcuts.map((shortcut) => {
              const on = settings.trayShortcuts.includes(shortcut);
              return (
                <button
                  key={shortcut}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className="check-row"
                  onClick={() => set({ trayShortcuts: allTrayShortcuts.filter((candidate) => (candidate === shortcut ? !on : settings.trayShortcuts.includes(candidate))) })}
                  data-testid={`tray-${shortcut}`}
                >
                  <span className="box"><Check /></span>
                  {trayShortcutNames[shortcut]}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Library" note="A deleted notebook is kept in Recently Deleted for this long, then removed for good.">
          <Row label="Recently Deleted keeps notebooks for">
            <Segmented<"7" | "30" | "90">
              label="Recently Deleted length"
              value={String(settings.trashDays) as "7" | "30" | "90"}
              onChange={(days) => set({ trashDays: Number(days) as 7 | 30 | 90 })}
              options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]}
            />
          </Row>
          <Row label="Language" detail="The choice is kept; translations come later.">
            <select value={settings.language} onChange={(event) => set({ language: event.target.value as SettingsData["language"] })} aria-label="Language" data-testid="language">
              {languages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select>
          </Row>
        </Section>

        <Section title="Writing History" note="The calendar and This Week are drawn from a record of how much you wrote each day and in which notebooks. It stays on this PC; a backup includes it.">
          <Row label="Keep a writing history">
            <Slab checked={settings.writingHistory} onChange={(writingHistory) => set({ writingHistory })} label="Writing history" />
          </Row>
          <Row label="Clear history" detail="Forgets every day written so far.">
            <button
              type="button"
              className="btn small destructive"
              data-testid="clear-history"
              onClick={async () => {
                const sure = await confirm({ title: "Clear the writing history?", message: "The calendar and This Week start empty. Your notebooks aren't touched.", confirm: "Clear History", destructive: true });
                if (sure) await clearWritingHistory();
              }}
            >
              Clear History…
            </button>
          </Row>
        </Section>

        <Section
          title="Locked Notebooks"
          note="A lock hides a notebook in the app and asks for Windows Hello or your PIN to open it. It does not encrypt the notebook's files, which anyone with access to this PC's library folder can still read."
        >
          <Row label="PIN" detail={settings.pinHash ? "A PIN is set." : "No PIN yet. You are asked for one the first time you lock a notebook."}>
            <button type="button" className="btn small" onClick={() => void changePin()} data-testid="change-pin">{settings.pinHash ? "Change PIN…" : "Set PIN…"}</button>
          </Row>
        </Section>

        {isTauri && <LibraryFolder />}

        <Section
          title="Backup"
          note={report ?? "A backup is one .owlbackup file holding every notebook, your folders, shelves and writing history. Restoring only adds: it never replaces or removes anything already in the library. A notebook that exists here and differs from the backup comes back as a copy."}
        >
          <Row label="Back up the library" detail="Saves one file you can keep anywhere.">
            <button
              type="button"
              className="btn small"
              disabled={busy}
              data-testid="backup-make"
              onClick={async () => {
                setBusy(true);
                try {
                  await saveAll();
                  if (await saveFile(backupFileName(), await makeBackup(fs), backupKind)) {
                    setReport("Backup saved.");
                    notify("Backup saved.");
                  }
                } catch (error) {
                  notify(`Couldn't make the backup: ${error instanceof Error ? error.message : String(error)}`, "trouble");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Back Up Library…
            </button>
          </Row>
          <Row label="Restore from a backup" detail="Adds what is missing; changes nothing that is here.">
            <button
              type="button"
              className="btn small"
              disabled={busy}
              data-testid="backup-restore"
              onClick={async () => {
                setBusy(true);
                try {
                  const [file] = await pickFiles([backupKind]);
                  if (!file) return;
                  await saveAll();
                  const result = await restoreBackup(fs, file.data);
                  await loadLibrary(fs);
                  const text = `Restored: ${result.added} added, ${result.keptBoth} kept as a copy, ${result.skipped} already here.`;
                  setReport(text);
                  notify(text);
                } catch (error) {
                  const text = error instanceof Error ? error.message : String(error);
                  setReport(`Nothing was restored. ${text}`);
                  notify(text, "trouble");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore from Backup…
            </button>
          </Row>
        </Section>

        <Section title="Pen Test">
          <Row label="Pen test" detail="Touch or draw on the pad with your pen to see what Windows reports." stack>
            <PenTest />
          </Row>
        </Section>

        <Section title="About">
          <Row label="OwlLuna for Windows" detail={`Version ${pkg.version}`} />
          <Row label="Unofficial Windows port of OwlLuna by Owais Azmal, MIT licence" />
          <Row label="The original OwlLuna on GitHub">
            <button type="button" className="btn small" onClick={() => void openURL("https://github.com/owaisazmal/OwlLuna")} data-testid="about-original">Open Original Repo</button>
          </Row>
        </Section>

        <Section title="Acknowledgements" note="The fonts are bundled with the app under the SIL Open Font License.">
          {fonts.map((font) => <Licence key={font.file} name={font.name} file={font.file} />)}
        </Section>
      </div>
    </Sheet>
  );
}

function Licence(props: { name: string; file: string }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const show = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (text === null) {
      try {
        const reply = await fetch(`/fonts/${props.file}`);
        setText(reply.ok ? await reply.text() : "The licence text couldn't be read.");
      } catch {
        setText("The licence text couldn't be read.");
      }
    }
  };
  return (
    <div className="settings-row stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="grow">
          <div className="name">{props.name}</div>
          <div className="detail">SIL Open Font License 1.1</div>
        </div>
        <button type="button" className="btn small" aria-expanded={open} onClick={() => void show()} data-testid={`licence-${props.file}`}>{open ? "Hide Licence" : "Show Licence"}</button>
      </div>
      {open && <pre className="licence" data-testid="licence-text">{text ?? "Reading…"}</pre>}
    </div>
  );
}

function PenTest() {
  const [event, setEvent] = useState<{ type: string; pointerType: string; pressure: number; tiltX: number; tiltY: number; buttons: number; button: number } | null>(null);
  const [live, setLive] = useState(false);
  const read = (kind: string, e: React.PointerEvent) =>
    setEvent({ type: kind, pointerType: e.pointerType, pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY, buttons: e.buttons, button: e.button });
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div
        className={`pen-pad${live ? " live" : ""}`}
        data-testid="pen-pad"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setLive(true); read("down", e); }}
        onPointerMove={(e) => read("move", e)}
        onPointerUp={(e) => { setLive(false); read("up", e); }}
        onPointerCancel={(e) => { setLive(false); read("cancel", e); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {event ? "Keep drawing, or press the pen's buttons" : "Draw here"}
      </div>
      <dl className="pen-readout" data-testid="pen-readout">
        <dt>Event</dt><dd data-testid="pen-event">{event?.type ?? "none yet"}</dd>
        <dt>pointerType</dt><dd data-testid="pen-type">{event?.pointerType ?? "-"}</dd>
        <dt>pressure</dt><dd data-testid="pen-pressure">{event ? event.pressure.toFixed(3) : "-"}</dd>
        <dt>tiltX / tiltY</dt><dd data-testid="pen-tilt">{event ? `${event.tiltX} / ${event.tiltY}` : "-"}</dd>
        <dt>buttons</dt><dd data-testid="pen-buttons">{event ? event.buttons : "-"}</dd>
        <dt>button</dt><dd data-testid="pen-button">{event ? event.button : "-"}</dd>
      </dl>
    </div>
  );
}

function LibraryFolder() {
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invoke<string>("library_root").then(setRoot, () => setRoot(null));
  }, []);

  const switchTo = async (path: string | null) => {
    const sure = await confirm({
      title: path ? "Use this folder as the library?" : "Use the default library folder?",
      message: path
        ? `${path}\n\nNothing is moved or merged. The app shows what is in that folder, and what is in the current one stays where it is.`
        : "Nothing is moved or merged. The app shows what is in the default folder, and what is in the current one stays where it is.",
      confirm: "Switch",
    });
    if (!sure) return;
    setBusy(true);
    try {
      await saveAll();
      await invoke("set_library_root", { path });
      await resetApp(libraryFS());
      await loadLibrary();
      setRoot(await invoke<string>("library_root"));
    } catch (error) {
      notify(`Couldn't change the library folder: ${error instanceof Error ? error.message : String(error)}`, "trouble");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Library Folder"
      note="Put the folder inside OneDrive and your notebooks sync between your PCs. Changing it moves and merges nothing: the app simply reads the folder you pick, and the old one stays as it was."
      testid="library-folder"
    >
      <Row label="Where your notebooks live" stack>
        <span className="path-line" data-testid="library-root">{root ?? "…"}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn small" disabled={busy} onClick={async () => { const path = await pickFolder(); if (path) await switchTo(path); }} data-testid="library-choose">Choose Folder…</button>
          <button type="button" className="btn small" disabled={busy} onClick={() => void switchTo(null)} data-testid="library-default">Use Default</button>
        </div>
      </Row>
    </Section>
  );
}
