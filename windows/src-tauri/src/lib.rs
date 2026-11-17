//! The Windows shell of OwlLuna: files under the library folder, files the user picks, and the
//! Windows services that stand in for Apple's.

mod appinfo;
mod files;
mod hello;
mod ink;
mod jumplist;
mod ocr;
mod onenote;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Where the library lives. Its default is the app's data folder; Settings can move it, e.g. into OneDrive.
pub struct LibraryRoot(pub Mutex<PathBuf>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (the jump list's tasks, say) hands its arguments to the running app.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("launch-args", args.into_iter().skip(1).collect::<Vec<String>>());
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let root = files::saved_root(&data).unwrap_or_else(|| data.join("Library"));
            std::fs::create_dir_all(&root)?;
            app.manage(LibraryRoot(Mutex::new(root)));
            jumplist::install();
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
            ink::ink_recognize,
            ink::ink_recognizers,
            ocr::ocr_image,
            hello::hello_available,
            hello::hello_verify,
            appinfo::app_info,
            onenote::onenote_available,
            onenote::onenote_hierarchy,
            onenote::onenote_local_notebooks,
            onenote::onenote_open_notebook,
            onenote::onenote_page,
            onenote::onenote_publish_pdf,
            onenote::onenote_cleanup,
            onenote::onenote_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OwlLuna");
}
