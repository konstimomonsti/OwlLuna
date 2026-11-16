//! The taskbar jump list: "Today's Page" and "Quick Note" start the app with `--today` / `--quick-note`.

/// Sets the list on a thread of its own, so a slow shell never delays the window. Failures are only logged.
pub fn install() {
    #[cfg(windows)]
    {
        let spawned = std::thread::Builder::new().name("jump-list".into()).spawn(|| {
            if let Err(e) = imp::set() {
                eprintln!("jump list not set: {e}");
            }
        });
        if let Err(e) = spawned {
            eprintln!("jump list not set: {e}");
        }
    }
}

#[cfg(windows)]
pub mod imp {
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink};
    use windows::core::{Interface, HSTRING};

    pub const TASKS: [(&str, &str); 2] = [("Today's Page", "--today"), ("Quick Note", "--quick-note")];

    struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn set() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = HSTRING::from(exe.as_os_str());
        let err = |e: windows::core::Error| e.message();
        unsafe {
            let _com = Com(CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok());
            let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER).map_err(err)?;
            let mut slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut slots).map_err(err)?;
            let tasks: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER).map_err(err)?;
            for (title, arguments) in TASKS {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(err)?;
                link.SetPath(&exe).map_err(err)?;
                link.SetArguments(&HSTRING::from(arguments)).map_err(err)?;
                link.SetIconLocation(&exe, 0).map_err(err)?;
                link.SetDescription(&HSTRING::from(title)).map_err(err)?;
                let store: IPropertyStore = link.cast().map_err(err)?;
                store.SetValue(&PKEY_Title, &PROPVARIANT::from(title)).map_err(err)?;
                store.Commit().map_err(err)?;
                tasks.AddObject(&link).map_err(err)?;
            }
            let array: IObjectArray = tasks.cast().map_err(err)?;
            list.AddUserTasks(&array).map_err(err)?;
            list.CommitList().map_err(err)?;
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn the_two_tasks_are_what_the_app_understands() {
        let args: Vec<&str> = super::imp::TASKS.iter().map(|t| t.1).collect();
        assert_eq!(args, ["--today", "--quick-note"]);
    }

    // The list belongs to the test executable here (jump lists are per program), so it can't touch the app's own.
    #[test]
    fn the_list_can_be_set() {
        let result = super::imp::set();
        println!("jump list: {result:?}");
        assert!(result.is_ok(), "{result:?}");
    }
}
