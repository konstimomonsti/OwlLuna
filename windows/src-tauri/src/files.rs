//! File commands. Library paths are relative to the library root and can never leave it.

use crate::LibraryRoot;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

const ROOT_FILE: &str = "library-root.txt";

/// The library folder the user chose, if it still exists.
pub fn saved_root(data: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(data.join(ROOT_FILE)).ok()?;
    let path = PathBuf::from(text.trim());
    (path.is_absolute() && path.is_dir()).then_some(path)
}

/// `relative` under `root`, refused if it is absolute or climbs out with `..`.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let mut out = root.to_path_buf();
    for part in path.components() {
        match part {
            Component::Normal(name) => out.push(name),
            Component::CurDir => {}
            _ => return Err(format!("path leaves the library: {relative}")),
        }
    }
    Ok(out)
}

/// Writes through a temporary file and a rename, so a crash leaves the old file or the new one, never half.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut name = path.file_name().ok_or("no file name")?.to_os_string();
    name.push(".tmp");
    let temporary = path.with_file_name(name);
    {
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        e.to_string()
    })
}

fn root_of(state: &State<LibraryRoot>) -> PathBuf {
    state.0.lock().unwrap().clone()
}

fn header(request: &Request, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or(format!("missing header {name}"))?
        .to_str()
        .map_err(|e| e.to_string())?;
    percent_decode(raw)
}

/// Headers carry paths percent-encoded, since a header can't hold every character a file name can.
pub fn percent_decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3).ok_or("bad escape")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

fn body(request: &Request) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("expected raw bytes".into()),
    }
}

/// A file's bytes, or an empty reply with `found: false` in place of an error when it isn't there.
#[tauri::command]
pub fn fs_read(state: State<LibraryRoot>, path: String) -> Result<Response, String> {
    let full = resolve(&root_of(&state), &path)?;
    match fs::read(&full) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err("ENOENT".into()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn fs_write(state: State<LibraryRoot>, request: Request) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    let full = resolve(&root_of(&state), &path)?;
    write_atomic(&full, &body(&request)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: f64,
}

#[tauri::command]
pub fn fs_list(state: State<LibraryRoot>, path: String) -> Result<Vec<Entry>, String> {
    let full = resolve(&root_of(&state), &path)?;
    let reader = match fs::read_dir(&full) {
        Ok(reader) => reader,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut entries = Vec::new();
    for entry in reader.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".tmp") {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        entries.push(Entry { name, is_dir: meta.is_dir(), size: meta.len(), modified });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub fn fs_remove(state: State<LibraryRoot>, path: String) -> Result<(), String> {
    let root = root_of(&state);
    let full = resolve(&root, &path)?;
    if full == root {
        return Err("refusing to remove the library itself".into());
    }
    match fs::metadata(&full) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&full).map_err(|e| e.to_string()),
        Ok(_) => fs::remove_file(&full).map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn fs_rename(state: State<LibraryRoot>, from: String, to: String) -> Result<(), String> {
    let root = root_of(&state);
    let source = resolve(&root, &from)?;
    let target = resolve(&root, &to)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(source, target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_root(state: State<LibraryRoot>) -> String {
    root_of(&state).to_string_lossy().into_owned()
}

/// Points the app at another library folder. Nothing is moved: the folder is used as it is.
#[tauri::command]
pub fn set_library_root(app: AppHandle, state: State<LibraryRoot>, path: Option<String>) -> Result<String, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let root = match path {
        Some(path) => {
            let chosen = PathBuf::from(path);
            if !chosen.is_absolute() {
                return Err("the library folder must be a full path".into());
            }
            fs::create_dir_all(&chosen).map_err(|e| e.to_string())?;
            fs::write(data.join(ROOT_FILE), chosen.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
            chosen
        }
        None => {
            let _ = fs::remove_file(data.join(ROOT_FILE));
            let default = data.join("Library");
            fs::create_dir_all(&default).map_err(|e| e.to_string())?;
            default
        }
    };
    *state.0.lock().unwrap() = root.clone();
    Ok(root.to_string_lossy().into_owned())
}

/// A file the user picked in an Open dialog.
#[tauri::command]
pub fn read_external(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// A file the user named in a Save dialog.
#[tauri::command]
pub fn write_external(request: Request) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    write_atomic(Path::new(&path), &body(&request)?)
}

/// What the app was started with: `--today`, `--quick-note`, or a file to open.
#[tauri::command]
pub fn launch_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_keeps_paths_inside_the_root() {
        let root = Path::new("C:\\lib");
        assert_eq!(resolve(root, "a/b.json").unwrap(), root.join("a").join("b.json"));
        assert_eq!(resolve(root, "./a").unwrap(), root.join("a"));
        assert!(resolve(root, "../x").is_err());
        assert!(resolve(root, "a/../../x").is_err());
        assert!(resolve(root, "C:\\Windows\\x").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temporary_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("deep").join("note.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        let names: Vec<_> = fs::read_dir(path.parent().unwrap()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn percent_decoding_restores_names() {
        assert_eq!(percent_decode("a%20b%2Fc").unwrap(), "a b/c");
        assert_eq!(percent_decode("%C3%A9").unwrap(), "é");
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%4").is_err());
    }

    #[test]
    fn saved_root_ignores_a_folder_that_is_gone() {
        let data = tempfile::tempdir().unwrap();
        assert!(saved_root(data.path()).is_none());
        fs::write(data.path().join(ROOT_FILE), "C:\\definitely\\not\\here\\owl").unwrap();
        assert!(saved_root(data.path()).is_none());
        let real = tempfile::tempdir().unwrap();
        fs::write(data.path().join(ROOT_FILE), real.path().to_string_lossy().as_bytes()).unwrap();
        assert_eq!(saved_root(data.path()).unwrap(), real.path());
    }
}
