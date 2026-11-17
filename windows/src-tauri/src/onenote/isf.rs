//! Ink Serialized Format (what OneNote keeps ink in) read with Windows.UI.Input.Inking.

/// One decoded point, in the container's own units (DIPs, 96 to the inch).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RawPoint {
    pub x: f32,
    pub y: f32,
    pub pressure: f32,
    /// Microseconds, as Windows reports them.
    pub time: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawStroke {
    pub points: Vec<RawPoint>,
    /// Red, green, blue, alpha.
    pub color: [u8; 4],
    /// Pen tip width and height in DIPs.
    pub size: [f32; 2],
    pub highlighter: bool,
    pub pencil: bool,
    /// x, y, width, height of the stroke's bounding box as Windows reports it, in DIPs.
    pub bounds: [f32; 4],
}

#[cfg(windows)]
pub fn decode(bytes: &[u8]) -> Result<Vec<RawStroke>, String> {
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::UI::Input::Inking::{InkDrawingAttributesKind, InkStrokeContainer};

    fn err(e: windows::core::Error) -> String {
        format!("Windows ink error: {}", e.message())
    }
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let stream = InMemoryRandomAccessStream::new().map_err(err)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(err)?;
    writer.WriteBytes(bytes).map_err(err)?;
    writer.StoreAsync().map_err(err)?.join().map_err(err)?;
    let input = stream.GetInputStreamAt(0).map_err(err)?;
    let container = InkStrokeContainer::new().map_err(err)?;
    container.LoadAsync(&input).map_err(err)?.join().map_err(err)?;
    let mut out = Vec::new();
    for stroke in container.GetStrokes().map_err(err)? {
        let attributes = stroke.DrawingAttributes().map_err(err)?;
        let color = attributes.Color().map_err(err)?;
        let size = attributes.Size().map_err(err)?;
        let bounds = stroke.BoundingRect().map_err(err)?;
        let mut points = Vec::new();
        for point in stroke.GetInkPoints().map_err(err)? {
            let position = point.Position().map_err(err)?;
            points.push(RawPoint { x: position.X, y: position.Y, pressure: point.Pressure().map_err(err)?, time: point.Timestamp().map_err(err)? });
        }
        out.push(RawStroke {
            points,
            color: [color.R, color.G, color.B, color.A],
            size: [size.Width, size.Height],
            highlighter: attributes.DrawAsHighlighter().unwrap_or(false),
            pencil: attributes.Kind().map(|k| k == InkDrawingAttributesKind::Pencil).unwrap_or(false),
            bounds: [bounds.X, bounds.Y, bounds.Width, bounds.Height],
        });
    }
    Ok(out)
}

#[cfg(not(windows))]
pub fn decode(_: &[u8]) -> Result<Vec<RawStroke>, String> {
    Err("Reading OneNote ink needs Windows.".into())
}
