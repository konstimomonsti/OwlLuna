//! The Windows shell of OwlLuna: files under the library folder, files the user picks, and the
//! Windows services that stand in for Apple's.

mod files;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Where the library lives. Its default is the app's data folder; Settings can move it, e.g. into OneDrive.
pub struct LibraryRoot(pub Mutex<PathBuf>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let root = files::saved_root(&data).unwrap_or_else(|| data.join("Library"));
            std::fs::create_dir_all(&root)?;
            app.manage(LibraryRoot(Mutex::new(root)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::fs_read,
            files::fs_write,
            files::fs_list,
            files::fs_remove,
            files::fs_rename,
            files::library_root,
            files::set_library_root,
            files::read_external,
            files::write_external,
            files::launch_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OwlLuna");
}
