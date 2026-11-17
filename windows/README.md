# OwlLuna for Windows

An unofficial Windows port of [OwlLuna](https://github.com/owaisazmal/OwlLuna), the free, open-source handwritten notes app for iPad by Owais Azmal. It is a separate app, rebuilt from scratch for Windows pens and touch screens; it does not share code with the iPad app, and its notebooks are not interchangeable with it (the iPad app stores ink in Apple's private PencilKit format).

No accounts, no ads, no tracking. Notebooks stay in a folder on your PC.

## Install

Run `OwlLuna_<version>_x64-setup.exe`. It installs for your user only, needs no administrator rights, and adds OwlLuna to the Start menu. The installer is not code-signed, so Windows SmartScreen may warn the first time: choose **More info › Run anyway**.

Requirements: Windows 10 (1809) or Windows 11, x64. The WebView2 runtime that Windows 11 ships with is used; the installer fetches it on older systems.

## What it does

### Writing
- Pen, mouse and touch input with pressure and tilt (Windows Ink / MPP 2.0 pens), palm rejection, and pen-only or pen-and-finger drawing.
- A tool tray of up to eight pens: pen, fineliner, fountain pen, calligraphy, pencil, highlighter, crayon and watercolour, each with its own colour, width and opacity.
- An eraser for whole strokes, parts of strokes, or highlighter only.
- The pen's barrel button and second button can switch to the eraser or lasso, go back to the last tool, undo or redo (Settings › Pen Test shows what your pen reports).
- Draw and hold: rest the pen at the end of a line, circle, rectangle or triangle and it straightens; a hooked line becomes an arrow.
- Scribble over ink to erase it; draw a loop round ink and hold to select it.
- Lasso: move, resize, recolour, cut, copy, paste, duplicate, carry ink to another page.
- Shapes, a ruler, and a zoom window for writing small and neat.
- Zoom up to 5× with Fit Width (Ctrl+0) and Fit Page (Ctrl+9); scroll pages or turn them one at a time; focus mode; notebook tabs; two notebooks side by side.
- Whiteboards: an infinite canvas with a minimap, Show Everything and its own zoom range down to 5%.

### Pages and paper
- Fourteen paper templates in four families, nine paper colours, Letter, A4, A5 and widescreen pages, and your own paper from a picture or a PDF page.
- A page navigator to jump, reorder, insert, duplicate, copy and delete pages; bookmarks; links to a page, another notebook or a web address.
- Pictures you can move, resize, rotate, crop and layer; forty stickers; text boxes with fonts, lists, checklists, highlights and LaTeX formulas; study tape.

### PDFs and exports
- Import PDFs and pictures as notebooks or as pages; select, copy and highlight PDF text; a highlighter that snaps to a line of text.
- Export as PDF (vector ink, working links, the original PDF pages kept vector), PNG, plain text, Markdown, or a page as a time-lapse video.

### Bringing in OneNote
**New › Import from OneNote…** reads your notebooks straight from OneNote for Microsoft 365 or OneNote 2016, read-only: nothing in OneNote is changed, and no sign-in is needed.
- Each OneNote notebook becomes a folder, section groups become folders inside it, and each section becomes a notebook with its pages in order.
- Handwriting comes through as editable ink with its colours and widths, typed text as text boxes, pictures and printouts as pictures. Very tall pages of stacked printouts are split into pages.
- A page holding something that can't be converted (an attached file, an equation) also gets a PDF copy of the page as OneNote shows it, right after it, so nothing is lost. Or choose **Exact copy** to bring every page in as a PDF page.
- Importing again adds new pages and updates changed ones without duplicating anything; a page you've changed in OwlLuna is never overwritten, and OneNote's newer version is added beside it.
- Notebooks in `Documents\OneNote Notebooks` that aren't open in OneNote are listed, with a button to open them in OneNote and include them.
- Password-protected sections are skipped and named. Big notebooks take a while: OneNote can take several seconds to hand over a page full of ink.

The OneNote app from the Microsoft Store has no import interface. Without OneNote for Microsoft 365 or 2016, export from OneNote as PDF and use **Import PDF…**.

### Library
- Cloth, Print and first-page covers; nested folders, tags, smart shelves, favourites, sorting and a list view.
- A daily journal with Today's Page (Ctrl+T) and On This Day; Quick Note (Ctrl+Shift+N); a This Week strip and a writing calendar, with no streaks or badges.
- Search across titles, tags, typed text, PDF text, recognised handwriting and text in pictures; Find in Notebook (Ctrl+F).
- Recently Deleted, emptied after 7, 30 or 90 days.
- Locked notebooks, opened with Windows Hello or a PIN. A lock hides a notebook in the app; it does not encrypt its files.
- Backup of the whole library, or one notebook, to a single `.owlbackup` file. Restoring never overwrites: a notebook that differs comes back as a second copy.
- Light, Dark or the system appearance, and a left-handed layout.
- English, Spanish, French and German. Many translations come from the iPad app's own catalogue; like those, they haven't been checked by native speakers yet.

### Windows in place of Apple
| iPad | Windows |
|---|---|
| Handwriting recognition (Vision) | Windows Ink handwriting recognition, on the device |
| Text in scans (Vision) | Windows OCR, on the device |
| Face ID / Touch ID | Windows Hello, or a PIN |
| iCloud sync | Put the library folder in OneDrive (Settings › Library Folder). Changes made on two PCs at once are not merged. |
| Widgets, Control Center, Shortcuts | Taskbar jump list: Today's Page and Quick Note; `owlluna.exe --today`, `--quick-note` |

### Not in this port
- The study guide written by Apple Intelligence: Windows has no on-device model to call, and sending notes to a server would break the app's privacy promise.
- Transcripts of recordings: Windows has no on-device transcription of audio files.
- Translation of handwriting with Apple's translator, Siri and Spotlight.
- Opening notebooks made on the iPad.

## Privacy

Everything stays on the PC. Handwriting and printed text are read by Windows on the device. The camera and microphone are used only while you scan or record. Nothing is sent anywhere.

The library lives in `%APPDATA%\io.github.owlluna.windows\Library` unless you choose another folder. Each notebook is a folder `<id>.owlluna` holding `manifest.json`, one JSON ink file per page, and its pictures and PDFs, so it can be backed up or synced like any other folder.

## Build from source

Requirements: Node.js 20+, Rust (stable, MSVC toolchain), Visual Studio 2022 Build Tools with the C++ workload.

```bash
cd windows
npm install
npm run tauri dev
```

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

```bash
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## How it is built

- Tauri 2: a small Rust shell around the system WebView2. The Rust side owns file access (every path stays inside the library folder; writes go through a temporary file and a rename) and the Windows services: handwriting recognition, OCR and Windows Hello through WinRT, the jump list, and a single running instance.
- React and TypeScript for the app. Ink is vectors: each stroke keeps every point's position, pressure and time, and is drawn as a filled outline, so the screen, thumbnails and PDF export draw the same shapes.
- One document per notebook, shared by every view of it, with one undo history. Saves write only the pages that changed, then the manifest last. A file that can't be read is set aside as `.corrupt`, never overwritten.
- Only the part of each page in view is drawn, at the screen's own sharpness, so notebooks of any length and whiteboards of any size stay fast.
- The paper templates, pen ranges, shape recognition, scribble and loop gestures and the flashcard schedule are ported from the Swift sources, with the same numbers.

`src/model` holds the data model, `src/storage` the notebook packages, `src/canvas` the ink engine and page drawing, `src/editor` the editor, `src/library` the library, `src/services` import, export, search, backup and the Windows services, `src-tauri/src` the Rust side.

## Licence

MIT, like OwlLuna. The fonts Fraunces, Archivo and Bricolage Grotesque are bundled unmodified under the SIL Open Font License; their licences are in `public/fonts` and in Settings › Acknowledgements.
