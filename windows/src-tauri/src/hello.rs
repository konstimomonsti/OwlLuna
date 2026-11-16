//! Windows Hello: the prompt that unlocks locked notebooks.

#[cfg(windows)]
mod imp {
    use windows_future::IAsyncOperation;
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows::core::{factory, HSTRING};

    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    fn describe(a: UserConsentVerifierAvailability) -> &'static str {
        if a == UserConsentVerifierAvailability::DeviceNotPresent {
            "This PC has no Windows Hello hardware."
        } else if a == UserConsentVerifierAvailability::NotConfiguredForUser {
            "Windows Hello isn't set up for this account (Settings > Accounts > Sign-in options)."
        } else if a == UserConsentVerifierAvailability::DisabledByPolicy {
            "Windows Hello is turned off by policy."
        } else {
            "Windows Hello isn't available right now."
        }
    }

    /// `hwnd` is the owner window as a number, so it can cross to the thread that waits for the answer.
    pub fn verify(hwnd: isize, reason: &str) -> Result<bool, String> {
        let state = UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map_err(|e| format!("Windows Hello error: {}", e.message()))?;
        if state != UserConsentVerifierAvailability::Available {
            return Err(describe(state).to_string());
        }
        let message = HSTRING::from(reason);
        let through_window = (|| -> windows::core::Result<UserConsentVerificationResult> {
            let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
            let op: IAsyncOperation<UserConsentVerificationResult> =
                unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut _), &message)? };
            op.join()
        })();
        let result = match through_window {
            Ok(result) => result,
            // Without the interop the prompt may have no owner, but it is better than none.
            Err(_) => UserConsentVerifier::RequestVerificationAsync(&message)
                .and_then(|op| op.join())
                .map_err(|e| format!("Windows Hello error: {}", e.message()))?,
        };
        Ok(result == UserConsentVerificationResult::Verified)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn available() -> bool {
        false
    }
    pub fn verify(_: isize, _: &str) -> Result<bool, String> {
        Err("Windows Hello needs the Windows app.".into())
    }
}

pub use imp::available as available_blocking;

#[tauri::command]
pub async fn hello_available() -> bool {
    tauri::async_runtime::spawn_blocking(available_blocking).await.unwrap_or(false)
}

#[tauri::command]
pub async fn hello_verify(window: tauri::WebviewWindow, reason: String) -> Result<bool, String> {
    #[cfg(windows)]
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = &window;
        0isize
    };
    tauri::async_runtime::spawn_blocking(move || imp::verify(hwnd, &reason))
        .await
        .map_err(|e| format!("Windows Hello stopped: {e}"))?
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn availability_answers_without_a_prompt() {
        println!("hello available: {}", super::available_blocking());
    }
}
