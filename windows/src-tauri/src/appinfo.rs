//! What the About section shows.

use crate::LibraryRoot;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub library_root: String,
    pub windows_build: String,
}

#[cfg(windows)]
pub fn windows_build() -> String {
    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        text: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
    }
    let mut info = OsVersionInfo { size: std::mem::size_of::<OsVersionInfo>() as u32, major: 0, minor: 0, build: 0, platform: 0, text: [0; 128] };
    // SAFETY: the struct matches OSVERSIONINFOW and `size` says so.
    let status = unsafe { RtlGetVersion(&mut info) };
    if status == 0 {
        format!("{}.{}.{}", info.major, info.minor, info.build)
    } else {
        "unknown".into()
    }
}

#[cfg(not(windows))]
pub fn windows_build() -> String {
    "not Windows".into()
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<LibraryRoot>) -> Result<AppInfo, String> {
    let root = state.0.lock().map_err(|_| "library folder is busy".to_string())?.clone();
    Ok(AppInfo { version: app.package_info().version.to_string(), library_root: root.to_string_lossy().into_owned(), windows_build: windows_build() })
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn reports_a_windows_build() {
        let build = super::windows_build();
        println!("windows build: {build}");
        assert!(build.starts_with("10.0."), "{build}");
    }
}
