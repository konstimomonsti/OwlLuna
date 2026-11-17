//! Import from OneNote for Windows. Strictly read-only toward OneNote and its notebooks: the only calls made are
//! `GetHierarchy`, `GetPageContent`, `Publish` (to a folder this app owns in its cache) and, when the user asks for
//! it, `OpenHierarchy`. See `com.rs` for how the calls are made and `page.rs` for how a page is converted.

pub mod hierarchy;
pub mod isf;
pub mod model;
pub mod page;
#[cfg(windows)]
pub mod com;

#[cfg(test)]
mod tests;

use model::*;
use tauri::AppHandle;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::path::{Path, PathBuf};
    use tauri::Manager;

    pub async fn available() -> bool {
        com::installed()
    }

    pub async fn hierarchy() -> Result<Vec<Notebook>, String> {
        let xml = com::run(|s| s.hierarchy()).await?;
        hierarchy::parse_hierarchy(&xml)
    }

    fn norm(path: &str) -> String {
        path.trim().trim_end_matches(['\\', '/']).to_lowercase()
    }

    fn known_documents() -> Vec<PathBuf> {
        use windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        let mut roots = Vec::new();
        unsafe {
            if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None) {
                if let Ok(text) = p.to_string() {
                    roots.push(PathBuf::from(text));
                }
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            }
        }
        for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
            if let Ok(base) = std::env::var(var) {
                roots.push(PathBuf::from(base).join("Documents"));
            }
        }
        roots
    }

    fn has_toc(folder: &Path) -> bool {
        std::fs::read_dir(folder)
            .map(|rd| rd.flatten().any(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("onetoc2"))))
            .unwrap_or(false)
    }

    /// Folders under `Documents\OneNote Notebooks` that hold a notebook (a `.onetoc2` table of contents).
    pub fn find_local(open_paths: &[String]) -> Vec<LocalNotebook> {
        let mut seen: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for root in known_documents() {
            let folder = root.join("OneNote Notebooks");
            let Ok(entries) = std::fs::read_dir(&folder) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() || !has_toc(&path) {
                    continue;
                }
                let text = path.to_string_lossy().into_owned();
                let key = norm(&text);
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key.clone());
                out.push(LocalNotebook {
                    name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    path: text,
                    is_open: open_paths.iter().any(|p| norm(p) == key),
                });
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    pub async fn local_notebooks() -> Result<Vec<LocalNotebook>, String> {
        // Which are open comes from OneNote, when it can be asked.
        let open: Vec<String> = if com::installed() {
            match hierarchy().await {
                Ok(books) => books.into_iter().filter_map(|b| b.path).collect(),
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };
        tauri::async_runtime::spawn_blocking(move || find_local(&open)).await.map_err(|e| e.to_string())
    }

    pub async fn open_notebook(path: String) -> Result<String, String> {
        com::run(move |s| s.open_notebook(&path)).await
    }

    pub async fn page(page_id: String) -> Result<PageContent, String> {
        let xml = com::run(move |s| s.page(&page_id)).await?;
        // Converted off the OneNote thread: decoding ink is the slow part and needs no OneNote.
        tauri::async_runtime::spawn_blocking(move || page::parse_page(&xml, &isf::decode))
            .await
            .map_err(|e| format!("conversion stopped: {e}"))?
    }

    fn scratch(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("onenote-import");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    pub async fn publish_pdf(app: AppHandle, id: String) -> Result<String, String> {
        let dir = scratch(&app)?;
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let target = dir.join(format!("{nanos:x}-{}.pdf", std::process::id()));
        let text = target.to_string_lossy().into_owned();
        let for_call = text.clone();
        com::run(move |s| s.publish_pdf(&id, &for_call)).await?;
        if !target.is_file() {
            return Err("OneNote did not produce a PDF for that.".into());
        }
        Ok(text)
    }

    pub async fn cleanup(app: AppHandle) -> Result<(), String> {
        let dir = scratch(&app)?;
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                // Only the PDFs this importer made.
                if path.is_file() && path.extension().is_some_and(|x| x == "pdf") {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        Ok(())
    }

    pub async fn release() {
        com::release().await;
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    const NEEDS_WINDOWS: &str = "Importing from OneNote needs the Windows app.";
    pub async fn available() -> bool { false }
    pub async fn hierarchy() -> Result<Vec<Notebook>, String> { Err(NEEDS_WINDOWS.into()) }
    pub async fn local_notebooks() -> Result<Vec<LocalNotebook>, String> { Ok(Vec::new()) }
    pub async fn open_notebook(_: String) -> Result<String, String> { Err(NEEDS_WINDOWS.into()) }
    pub async fn page(_: String) -> Result<PageContent, String> { Err(NEEDS_WINDOWS.into()) }
    pub async fn publish_pdf(_: AppHandle, _: String) -> Result<String, String> { Err(NEEDS_WINDOWS.into()) }
    pub async fn cleanup(_: AppHandle) -> Result<(), String> { Ok(()) }
    pub async fn release() {}
}

/// Whether OneNote for Microsoft 365 or 2016 is installed. Does not start it.
#[tauri::command]
pub async fn onenote_available() -> bool {
    imp::available().await
}

/// Every open notebook down to its pages. The first call can take seconds while OneNote starts.
#[tauri::command]
pub async fn onenote_hierarchy() -> Result<Vec<Notebook>, String> {
    imp::hierarchy().await
}

/// Notebook folders on disk, and whether OneNote has them open.
#[tauri::command]
pub async fn onenote_local_notebooks() -> Result<Vec<LocalNotebook>, String> {
    imp::local_notebooks().await
}

/// Adds a notebook folder to OneNote's list (`OpenHierarchy`). Only for the user's click on "Open in OneNote and include".
#[tauri::command]
pub async fn onenote_open_notebook(path: String) -> Result<String, String> {
    imp::open_notebook(path).await
}

/// One page, read and converted.
#[tauri::command]
pub async fn onenote_page(page_id: String) -> Result<PageContent, String> {
    imp::page(page_id).await
}

/// A page, section or notebook as a PDF in this app's cache folder; returns its path (read it with `read_external`).
#[tauri::command]
pub async fn onenote_publish_pdf(app: AppHandle, id: String) -> Result<String, String> {
    imp::publish_pdf(app, id).await
}

/// Deletes the PDFs `onenote_publish_pdf` made.
#[tauri::command]
pub async fn onenote_cleanup(app: AppHandle) -> Result<(), String> {
    imp::cleanup(app).await
}

/// Lets go of OneNote when an import is over.
#[tauri::command]
pub async fn onenote_release() {
    imp::release().await
}
