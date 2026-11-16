//! OCR of an image (a photo or a PDF page rendered by the editor) with Windows.Media.Ocr.

use serde::Serialize;
use tauri::ipc::Request;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct OcrLine {
    pub text: String,
    /// x, y, width, height in pixels of the image as it was sent.
    pub bounds: [f32; 4],
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct OcrText {
    pub text: String,
    pub lines: Vec<OcrLine>,
}

/// The size an image is shrunk to so the engine takes it, or None when it already fits.
pub fn fit_size(width: u32, height: u32, max: u32) -> Option<(u32, u32, f32)> {
    let longest = width.max(height);
    if max == 0 || longest <= max {
        return None;
    }
    let scale = max as f32 / longest as f32;
    Some((((width as f32 * scale).floor() as u32).max(1), ((height as f32 * scale).floor() as u32).max(1), scale))
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode, ExifOrientationMode};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::core::HSTRING;

    fn err(e: windows::core::Error) -> String {
        format!("Windows OCR error: {}", e.message())
    }

    fn engine(language: Option<&str>) -> Result<OcrEngine, String> {
        if let Some(tag) = language.map(str::trim).filter(|t| !t.is_empty()) {
            let tag = HSTRING::from(tag);
            if Language::IsWellFormed(&tag).unwrap_or(false) {
                if let Ok(language) = Language::CreateLanguage(&tag) {
                    if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                        return Ok(engine);
                    }
                }
            }
        }
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
            "Text recognition has no language installed in Windows. Add one in Settings > Time & language > Language & region.".to_string()
        })
    }

    pub fn recognize(data: &[u8], language: Option<&str>) -> Result<OcrText, String> {
        if data.is_empty() {
            return Err("The image is empty.".into());
        }
        let engine = engine(language)?;
        let stream = InMemoryRandomAccessStream::new().map_err(err)?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(err)?;
        writer.WriteBytes(data).map_err(err)?;
        writer.StoreAsync().map_err(err)?.join().map_err(err)?;
        writer.DetachStream().map_err(err)?;
        stream.Seek(0).map_err(err)?;
        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(err)?
            .join()
            .map_err(|_| "That is not an image Windows can read (PNG, JPEG, BMP, GIF or TIFF).".to_string())?;
        let (width, height) = (decoder.PixelWidth().map_err(err)?, decoder.PixelHeight().map_err(err)?);
        let max = OcrEngine::MaxImageDimension().map_err(err)?;
        let transform = BitmapTransform::new().map_err(err)?;
        let mut scale = 1.0f32;
        if let Some((w, h, s)) = fit_size(width, height, max) {
            transform.SetScaledWidth(w).map_err(err)?;
            transform.SetScaledHeight(h).map_err(err)?;
            scale = s;
        }
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied, &transform, ExifOrientationMode::IgnoreExifOrientation, ColorManagementMode::DoNotColorManage)
            .map_err(err)?
            .join()
            .map_err(err)?;
        let result = engine.RecognizeAsync(&bitmap).map_err(err)?.join().map_err(err)?;
        let mut lines = Vec::new();
        for line in result.Lines().map_err(err)? {
            let (mut left, mut top, mut right, mut bottom) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            for word in line.Words().map_err(err)? {
                let r = word.BoundingRect().map_err(err)?;
                left = left.min(r.X);
                top = top.min(r.Y);
                right = right.max(r.X + r.Width);
                bottom = bottom.max(r.Y + r.Height);
            }
            if left > right {
                continue;
            }
            lines.push(OcrLine {
                text: line.Text().map_err(err)?.to_string(),
                bounds: [left / scale, top / scale, (right - left) / scale, (bottom - top) / scale],
            });
        }
        Ok(OcrText { text: result.Text().map_err(err)?.to_string(), lines })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn recognize(_: &[u8], _: Option<&str>) -> Result<OcrText, String> {
        Err("Text recognition needs the Windows app.".into())
    }
}

pub use imp::recognize as recognize_blocking;

/// The image's bytes are the request body; `x-language` optionally names a language tag.
#[tauri::command]
pub async fn ocr_image(request: Request<'_>) -> Result<OcrText, String> {
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected the image's bytes as the body".into()),
    };
    let language = request.headers().get("x-language").and_then(|v| v.to_str().ok()).map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || recognize_blocking(&data, language.as_deref()))
        .await
        .map_err(|e| format!("text recognition stopped: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_images_shrink_to_fit() {
        assert_eq!(fit_size(1000, 500, 2000), None);
        let (w, h, s) = fit_size(8000, 4000, 4000).unwrap();
        assert_eq!((w, h), (4000, 2000));
        assert!((s - 0.5).abs() < 1e-6);
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = !0u32;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
        out.extend((body.len() as u32).to_be_bytes());
        let mut all = kind.to_vec();
        all.extend(body);
        out.extend(&all);
        out.extend(crc32(&all).to_be_bytes());
    }

    /// A white 8-bit RGB PNG, written with stored (uncompressed) deflate blocks.
    fn white_png(size: u32) -> Vec<u8> {
        let mut raw = Vec::new();
        for _ in 0..size {
            raw.push(0);
            raw.extend(std::iter::repeat(255u8).take(size as usize * 3));
        }
        let mut z = vec![0x78, 0x01];
        let blocks: Vec<&[u8]> = raw.chunks(60000).collect();
        for (i, block) in blocks.iter().enumerate() {
            z.push(if i + 1 == blocks.len() { 1 } else { 0 });
            z.extend((block.len() as u16).to_le_bytes());
            z.extend((!(block.len() as u16)).to_le_bytes());
            z.extend(*block);
        }
        let (mut a, mut b) = (1u32, 0u32);
        for &byte in &raw {
            a = (a + byte as u32) % 65521;
            b = (b + a) % 65521;
        }
        z.extend(((b << 16) | a).to_be_bytes());
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mut header = Vec::new();
        header.extend(size.to_be_bytes());
        header.extend(size.to_be_bytes());
        header.extend([8, 2, 0, 0, 0]);
        chunk(&mut png, b"IHDR", &header);
        chunk(&mut png, b"IDAT", &z);
        chunk(&mut png, b"IEND", &[]);
        png
    }

    #[cfg(windows)]
    #[test]
    fn a_blank_image_has_no_text() {
        let result = recognize_blocking(&white_png(200), None);
        println!("ocr of a blank image: {result:?}");
        match result {
            Ok(text) => assert!(text.text.trim().len() < 5, "{text:?}"),
            // A PC with no OCR language installed says so; that is an answer too.
            Err(message) => assert!(message.contains("no language installed"), "{message}"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(recognize_blocking(b"not an image", Some("en-US")).is_err());
        assert!(recognize_blocking(&[], None).is_err());
    }
}
