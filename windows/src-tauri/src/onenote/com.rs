//! Late-bound OLE Automation (IDispatch) for the OneNote application object, and the one thread that owns it.
//!
//! OneNote's COM API has no type library in the `windows` crate, so every call is `GetIDsOfNames` + `Invoke`.
//! Only the read-only methods the importer needs are exposed here: see [`Session`]. Nothing in this module can
//! write to a notebook.

use std::mem::ManuallyDrop;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use windows::core::{Interface, BSTR, GUID, HRESULT, IUnknown, PCWSTR};
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, ITypeInfo, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, DISPATCH_METHOD,
    DISPPARAMS, EXCEPINFO,
};
use windows::Win32::System::Ole::{LoadTypeLibEx, REGKIND_NONE};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CLASSES_ROOT, RRF_RT_REG_SZ};
use windows::Win32::System::Variant::{VARENUM, VARIANT, VT_BSTR, VT_BYREF, VT_I4};

/// What a call passes.
pub enum Arg<'a> {
    Str(&'a str),
    Int(i32),
    /// A `[out] BSTR`: its text comes back in the result, in the order the outs appear.
    OutStr,
}

fn describe(code: i32) -> Option<&'static str> {
    // OneNote's own HRESULTs (the hr* constants of its COM API) and the COM ones a busy or missing OneNote gives.
    Some(match code as u32 {
        0x8004_2000 => "OneNote refused the XML (hrMalformedXML).",
        0x8004_2001 => "OneNote refused the XML (hrInvalidXML).",
        0x8004_2014 => "That item no longer exists in OneNote (hrObjectDoesNotExist). It may have been moved or deleted.",
        0x8004_201A => "That notebook is not open in OneNote any more (hrNotebookDoesNotExist).",
        0x8004_0154 => "OneNote for Microsoft 365 or OneNote 2016 is not installed. The OneNote app from the Store has no import interface.",
        0x8008_0005 => "OneNote could not be started. Open OneNote once yourself, then try again.",
        0x8001_0001 | 0x8001_010A => "OneNote is busy. Wait for it to finish syncing, then try again.",
        0x8001_0108 | 0x8001_0114 | 0x8007_06BA | 0x8007_06BE => "OneNote closed while the import was running.",
        0x8004_2039 | 0x8004_203A => "This section is password protected. Unlock it in OneNote first.",
        _ => return None,
    })
}

pub fn explain(code: i32, what: &str) -> String {
    match describe(code) {
        Some(text) => text.to_string(),
        None => format!("OneNote could not {what} (error 0x{:08X}).", code as u32),
    }
}

fn is_busy(code: i32) -> bool {
    matches!(code as u32, 0x8001_0001 | 0x8001_010A)
}

fn is_gone(code: i32) -> bool {
    matches!(code as u32, 0x8001_0108 | 0x8001_0114 | 0x8007_06BA | 0x8007_06BE | 0x8001_0012)
}

pub struct ComError {
    pub code: i32,
    pub text: String,
}

impl ComError {
    fn new(code: i32, what: &str) -> Self {
        ComError { code, text: explain(code, what) }
    }
}

/// IApplicationCOM, the dual interface OneNote's Application class implements.
const IID_APPLICATION: GUID = GUID::from_u128(0x452ac71a_b655_4967_a208_a4cc39dd7949);
const TYPELIB_ID: &str = "{0EA692EE-BB50-4E3C-AEF0-356D91732725}";

/// Where OneNote's type library is. On some installs OneNote's server-side IDispatch cannot find it ("library not
/// registered": its registry entry only has a Win32 key), so the library is read from the file the registry names
/// and the interface is called through it directly instead of through IDispatch.
fn typelib_path() -> Option<String> {
    fn read(subkey: &str) -> Option<String> {
        unsafe {
            let key: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
            let mut buffer = vec![0u16; 1024];
            let mut size = (buffer.len() * 2) as u32;
            let status = RegGetValueW(HKEY_CLASSES_ROOT, PCWSTR(key.as_ptr()), PCWSTR::null(), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr() as *mut _), Some(&mut size));
            if status.0 != 0 {
                return None;
            }
            let chars = (size as usize / 2).saturating_sub(1);
            Some(String::from_utf16_lossy(&buffer[..chars]))
        }
    }
    for version in ["1.1", "1.0"] {
        for kind in ["Win64", "Win32"] {
            if let Some(path) = read(&format!("TypeLib\\{TYPELIB_ID}\\{version}\\0\\{kind}")) {
                return Some(path);
            }
        }
    }
    read(r"CLSID\{DC67E480-C3CB-49F8-8232-60B0C2056C8E}\LocalServer32")
}

/// Whether the OneNote application object is registered: `OneNote.Application` resolves and its type library is found.
/// Starts nothing.
pub fn installed() -> bool {
    unsafe {
        let wide: Vec<u16> = "OneNote.Application".encode_utf16().chain(std::iter::once(0)).collect();
        CLSIDFromProgID(PCWSTR(wide.as_ptr())).is_ok() && typelib_path().is_some()
    }
}

pub struct Dispatch {
    object: IUnknown,
    info: ITypeInfo,
}

impl Dispatch {
    pub fn create(prog_id: &str) -> Result<Dispatch, ComError> {
        unsafe {
            let wide: Vec<u16> = prog_id.encode_utf16().chain(std::iter::once(0)).collect();
            let clsid: GUID = CLSIDFromProgID(PCWSTR(wide.as_ptr())).map_err(|_| ComError::new(0x8004_0154u32 as i32, "start"))?;
            let unknown: IUnknown = CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER).map_err(|e| ComError::new(e.code().0, "start"))?;
            let mut raw: *mut std::ffi::c_void = std::ptr::null_mut();
            let hr = unknown.query(&IID_APPLICATION, &mut raw);
            if hr.is_err() || raw.is_null() {
                return Err(ComError { code: hr.0, text: "OneNote does not offer the interface the importer needs. Update OneNote for Microsoft 365.".into() });
            }
            let object = IUnknown::from_raw(raw);
            let path = typelib_path().ok_or(ComError { code: 0x8002_801D_u32 as i32, text: "OneNote's type library is not registered.".into() })?;
            let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            // REGKIND_NONE: reads the file and registers nothing.
            let library = LoadTypeLibEx(PCWSTR(wide_path.as_ptr()), REGKIND_NONE).map_err(|e| ComError::new(e.code().0, "read its type library"))?;
            let info = library.GetTypeInfoOfGuid(&IID_APPLICATION).map_err(|e| ComError::new(e.code().0, "read its type library"))?;
            Ok(Dispatch { object, info })
        }
    }

    fn id_of(&self, name: &str) -> Result<i32, ComError> {
        unsafe {
            let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            let names = [PCWSTR(wide.as_ptr())];
            let mut id = 0i32;
            self.info.GetIDsOfNames(names.as_ptr(), 1, &mut id).map_err(|e| ComError::new(e.code().0, name))?;
            Ok(id)
        }
    }

    /// Calls a method. `args` are in the order of the method's signature; returns the `OutStr` results in order.
    pub fn call(&self, method: &str, args: &[Arg], what: &str) -> Result<Vec<String>, ComError> {
        let id = self.id_of(method)?;
        let out_count = args.iter().filter(|a| matches!(a, Arg::OutStr)).count();
        // BSTRs the call reads, and the ones it fills in. Both live until the call is over.
        let owned: Vec<BSTR> = args
            .iter()
            .map(|a| match a {
                Arg::Str(s) => BSTR::from(*s),
                _ => BSTR::new(),
            })
            .collect();
        let mut outs: Vec<BSTR> = (0..out_count).map(|_| BSTR::new()).collect();
        let mut out_slot: Vec<Option<usize>> = Vec::with_capacity(args.len());
        let mut seen = 0usize;
        for arg in args {
            if matches!(arg, Arg::OutStr) {
                out_slot.push(Some(seen));
                seen += 1;
            } else {
                out_slot.push(None);
            }
        }
        let mut variants: Vec<VARIANT> = Vec::with_capacity(args.len());
        // IDispatch takes its arguments last to first.
        for (index, arg) in args.iter().enumerate().rev() {
            let mut v = VARIANT::default();
            unsafe {
                let inner = &mut *v.Anonymous.Anonymous;
                match arg {
                    Arg::Str(_) => {
                        inner.vt = VT_BSTR;
                        // A bitwise copy that is never dropped: `owned` frees the string.
                        inner.Anonymous.bstrVal = ManuallyDrop::new(std::mem::transmute_copy::<BSTR, BSTR>(&owned[index]));
                    }
                    Arg::Int(n) => {
                        inner.vt = VT_I4;
                        inner.Anonymous.lVal = *n;
                    }
                    Arg::OutStr => {
                        inner.vt = VARENUM(VT_BYREF.0 | VT_BSTR.0);
                        inner.Anonymous.pbstrVal = &mut outs[out_slot[index].unwrap()] as *mut BSTR;
                    }
                }
            }
            variants.push(v);
        }
        let params = DISPPARAMS { rgvarg: variants.as_mut_ptr(), rgdispidNamedArgs: std::ptr::null_mut(), cArgs: variants.len() as u32, cNamedArgs: 0 };
        let mut result = VARIANT::default();
        let mut exception = EXCEPINFO::default();
        let mut bad_arg = 0u32;
        let outcome = unsafe { self.info.Invoke(self.object.as_raw(), id, DISPATCH_METHOD, &params as *const DISPPARAMS as *mut DISPPARAMS, &mut result, &mut exception, &mut bad_arg) };
        // The variants only borrow: nothing in them is freed here.
        let code = match outcome {
            Ok(()) => None,
            Err(e) => {
                let hr: HRESULT = e.code();
                // DISP_E_EXCEPTION carries the server's own code in the exception record.
                Some(if hr.0 as u32 == 0x8002_0009 && exception.scode != 0 { exception.scode } else { hr.0 })
            }
        };
        unsafe {
            ManuallyDrop::drop(&mut exception.bstrSource);
            ManuallyDrop::drop(&mut exception.bstrDescription);
            ManuallyDrop::drop(&mut exception.bstrHelpFile);
        }
        if let Some(code) = code {
            return Err(ComError::new(code, what));
        }
        Ok(outs.iter().map(|b| b.to_string()).collect())
    }
}

// SAFETY: the object is only ever touched on the worker thread that created it; the wrapper moves nowhere else.
unsafe impl Send for Dispatch {}

/// The one OneNote object, created on first use and kept until released.
pub struct Session {
    app: Option<Dispatch>,
}

const PROG_ID: &str = "OneNote.Application";

/// Hierarchy scope and page info values of OneNote's COM API (read-only ones only).
pub const HS_PAGES: i32 = 4;
pub const XS_2013: i32 = 2;
pub const PI_BINARY_DATA: i32 = 1;
pub const PF_PDF: i32 = 3;
pub const CFT_NONE: i32 = 0;

impl Session {
    fn new() -> Session {
        Session { app: None }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Session {
        Session::new()
    }

    fn app(&mut self) -> Result<&Dispatch, ComError> {
        if self.app.is_none() {
            self.app = Some(Dispatch::create(PROG_ID)?);
        }
        Ok(self.app.as_ref().unwrap())
    }

    /// Runs a call; retries while OneNote says it is busy (it is slow to start and when syncing), and starts a
    /// fresh object once if OneNote went away in between.
    fn invoke(&mut self, method: &str, args: &[Arg], what: &str) -> Result<Vec<String>, String> {
        let mut restarted = false;
        let mut waited = 0u32;
        loop {
            let attempt = self.app().and_then(|app| app.call(method, args, what));
            match attempt {
                Ok(out) => return Ok(out),
                Err(error) if is_busy(error.code) && waited < 60 => {
                    waited += 1;
                    std::thread::sleep(Duration::from_millis(500));
                }
                Err(error) if is_gone(error.code) && !restarted => {
                    restarted = true;
                    self.app = None;
                }
                Err(error) => return Err(error.text),
            }
        }
    }

    /// `GetHierarchy("", hsPages, ...)`: every open notebook down to its pages.
    pub fn hierarchy(&mut self) -> Result<String, String> {
        let out = self.invoke("GetHierarchy", &[Arg::Str(""), Arg::Int(HS_PAGES), Arg::OutStr, Arg::Int(XS_2013)], "read the notebook list")?;
        Ok(out.into_iter().next().unwrap_or_default())
    }

    /// `GetPageContent(page, ..., piBinaryData)`: the page as XML, pictures and ink inline.
    pub fn page(&mut self, page_id: &str) -> Result<String, String> {
        let out = self.invoke("GetPageContent", &[Arg::Str(page_id), Arg::OutStr, Arg::Int(PI_BINARY_DATA), Arg::Int(XS_2013)], "read that page")?;
        Ok(out.into_iter().next().unwrap_or_default())
    }

    /// `Publish(id, target, pfPDF, "")`: a page, a section or a notebook rendered to a PDF at `target`.
    pub fn publish_pdf(&mut self, id: &str, target: &str) -> Result<(), String> {
        self.invoke("Publish", &[Arg::Str(id), Arg::Str(target), Arg::Int(PF_PDF), Arg::Str("")], "make a PDF of that")?;
        Ok(())
    }

    /// `OpenHierarchy(path, "", out id, cftNone)`: adds a notebook folder to OneNote's list. Only called when the
    /// user asks for exactly that.
    pub fn open_notebook(&mut self, path: &str) -> Result<String, String> {
        let out = self.invoke("OpenHierarchy", &[Arg::Str(path), Arg::Str(""), Arg::OutStr, Arg::Int(CFT_NONE)], "open that notebook")?;
        Ok(out.into_iter().next().unwrap_or_default())
    }
}

type Job = Box<dyn FnOnce(&mut Session) + Send>;

fn worker() -> &'static Mutex<Option<Sender<Job>>> {
    static WORKER: OnceLock<Mutex<Option<Sender<Job>>>> = OnceLock::new();
    WORKER.get_or_init(|| Mutex::new(None))
}

fn spawn_worker() -> Sender<Job> {
    let (tx, rx) = channel::<Job>();
    std::thread::Builder::new()
        .name("onenote-sta".into())
        .spawn(move || {
            // A single-threaded apartment owns the OneNote object for as long as the worker lives.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            let mut session = Session::new();
            while let Ok(job) = rx.recv() {
                // A panic in one job must not take the worker down, or every later call would fail.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut session)));
            }
        })
        .expect("start the OneNote thread");
    tx
}

/// Runs `work` on the OneNote thread and waits for its answer, without blocking the caller's async runtime.
pub async fn run<T: Send + 'static>(work: impl FnOnce(&mut Session) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (reply_tx, reply_rx) = channel::<Result<T, String>>();
    let job: Job = Box::new(move |session| {
        let _ = reply_tx.send(work(session));
    });
    {
        let mut guard = worker().lock().map_err(|_| "OneNote worker is unavailable".to_string())?;
        if guard.is_none() {
            *guard = Some(spawn_worker());
        }
        if guard.as_ref().unwrap().send(job).is_err() {
            // The thread ended: start another and fail this call so the caller can retry.
            *guard = None;
            return Err("OneNote stopped responding. Try again.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || reply_rx.recv().unwrap_or_else(|_| Err("OneNote stopped responding. Try again.".into())))
        .await
        .map_err(|e| format!("OneNote call stopped: {e}"))?
}

/// Lets go of the OneNote object (so OneNote can close if we started it).
pub async fn release() {
    let _ = run(|session| {
        session.app = None;
        Ok(())
    })
    .await;
}
