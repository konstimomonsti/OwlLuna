//! `GetPageContent` XML into a [`PageContent`]: text, pictures, ink and what could not be converted.
//!
//! Nothing here may panic on odd input: an element that can't be read is skipped and named in `warnings`.

use super::isf::RawStroke;
use super::model::*;
use roxmltree::{Document, Node};
use std::collections::HashMap;

pub type Decoder<'a> = &'a dyn Fn(&[u8]) -> Result<Vec<RawStroke>, String>;

fn num(node: &Node, name: &str) -> Option<f64> {
    node.attribute(name).and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite())
}

fn child<'a, 'b>(node: &Node<'a, 'b>, name: &str) -> Option<Node<'a, 'b>> {
    node.children().find(|c| c.has_tag_name(name))
}

/// x, y, z of a `one:Position`.
fn position(node: &Node) -> Option<(f64, f64, i32)> {
    let p = child(node, "Position")?;
    Some((num(&p, "x")?, num(&p, "y")?, num(&p, "z").unwrap_or(0.0) as i32))
}

fn size(node: &Node) -> Option<(f64, f64)> {
    let s = child(node, "Size")?;
    Some((num(&s, "width")?, num(&s, "height")?))
}

// ---- CSS-ish styles and the HTML OneNote keeps text in --------------------------------------------------------

fn named_color(name: &str) -> Option<&'static str> {
    Some(match name {
        "black" => "#000000", "white" => "#FFFFFF", "red" => "#FF0000", "lime" => "#00FF00", "green" => "#008000",
        "blue" => "#0000FF", "yellow" => "#FFFF00", "aqua" | "cyan" => "#00FFFF", "fuchsia" | "magenta" => "#FF00FF",
        "gray" | "grey" => "#808080", "silver" => "#C0C0C0", "maroon" => "#800000", "navy" => "#000080", "olive" => "#808000",
        "purple" => "#800080", "teal" => "#008080", "orange" => "#FFA500", "pink" => "#FFC0CB", "brown" => "#A52A2A",
        "darkblue" => "#00008B", "darkred" => "#8B0000", "darkgreen" => "#006400", "lightgreen" => "#90EE90",
        "lightblue" => "#ADD8E6", "gold" => "#FFD700",
        _ => return None,
    })
}

/// "#RRGGBB" from a CSS colour or OneNote attribute; None for automatic, transparent and what isn't a colour.
pub fn css_color(value: &str) -> Option<String> {
    let v = value.trim().to_ascii_lowercase();
    if v.is_empty() || matches!(v.as_str(), "automatic" | "windowtext" | "transparent" | "none" | "initial" | "inherit") {
        return None;
    }
    if let Some(hex) = v.strip_prefix('#') {
        return match hex.len() {
            6 if hex.chars().all(|c| c.is_ascii_hexdigit()) => Some(format!("#{}", hex.to_ascii_uppercase())),
            3 if hex.chars().all(|c| c.is_ascii_hexdigit()) => {
                Some(format!("#{}", hex.chars().flat_map(|c| [c, c]).collect::<String>().to_ascii_uppercase()))
            }
            _ => None,
        };
    }
    if let Some(inner) = v.strip_prefix("rgb(").and_then(|r| r.strip_suffix(')')) {
        let parts: Vec<u8> = inner.split(',').filter_map(|p| p.trim().parse::<f64>().ok()).map(|n| n.clamp(0.0, 255.0) as u8).collect();
        if parts.len() == 3 {
            return Some(format!("#{:02X}{:02X}{:02X}", parts[0], parts[1], parts[2]));
        }
        return None;
    }
    named_color(&v).map(str::to_string)
}

#[derive(Clone, Default, Debug)]
struct Style {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    color: Option<String>,
    highlight: Option<String>,
    size: Option<f64>,
    face: Option<String>,
}

fn apply_css(style: &mut Style, css: &str) {
    for declaration in css.split(';') {
        let Some((key, value)) = declaration.split_once(':') else { continue };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        let lower = value.to_ascii_lowercase();
        match key.as_str() {
            "font-weight" => {
                style.bold = Some(lower == "bold" || lower == "bolder" || lower.parse::<u32>().is_ok_and(|n| n >= 600));
            }
            "font-style" => style.italic = Some(lower.starts_with("italic") || lower.starts_with("oblique")),
            "text-decoration" | "text-decoration-line" => {
                style.underline = Some(lower.contains("underline"));
                style.strike = Some(lower.contains("line-through"));
            }
            "color" => style.color = css_color(value),
            "background" | "background-color" | "mso-highlight" => {
                if let Some(first) = value.split_whitespace().next().and_then(css_color) {
                    style.highlight = Some(first);
                } else if lower == "transparent" || lower == "none" {
                    style.highlight = None;
                }
            }
            "font-size" => {
                let n: Option<f64> = lower.trim_end_matches("pt").trim_end_matches("px").trim().parse().ok();
                style.size = n.map(|n| if lower.ends_with("px") { n * 0.75 } else { n }).filter(|n| *n > 0.0 && *n < 400.0);
            }
            "font-family" => {
                let first = value.split(',').next().unwrap_or("").trim().trim_matches(['\'', '"']).trim().to_string();
                style.face = (!first.is_empty()).then_some(first);
            }
            _ => {}
        }
    }
}

fn layer(base: &Style, over: &Style) -> Style {
    Style {
        bold: over.bold.or(base.bold),
        italic: over.italic.or(base.italic),
        underline: over.underline.or(base.underline),
        strike: over.strike.or(base.strike),
        color: over.color.clone().or_else(|| base.color.clone()),
        highlight: over.highlight.clone().or_else(|| base.highlight.clone()),
        size: over.size.or(base.size),
        face: over.face.clone().or_else(|| base.face.clone()),
    }
}

fn decode_entity(name: &str) -> Option<String> {
    Some(match name {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "apos" => "'".into(),
        "nbsp" => " ".into(),
        "ndash" => "\u{2013}".into(),
        "mdash" => "\u{2014}".into(),
        "hellip" => "\u{2026}".into(),
        "euro" => "\u{20AC}".into(),
        _ => {
            let number = name.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code)?.to_string()
        }
    })
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        match after.find(';').filter(|&end| end <= 10).and_then(|end| decode_entity(&after[..end]).map(|s| (s, end))) {
            Some((replacement, end)) => {
                out.push_str(&replacement);
                rest = &after[end + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

struct Run {
    text: String,
    style: Style,
}

/// The runs of OneNote's HTML-ish text: `<span style='...'>`, `<br/>`, `<a>`, entities. Tags it doesn't know are dropped.
fn parse_runs(html: &str) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    let mut stack: Vec<Style> = vec![Style::default()];
    let mut text = String::new();
    let flush = |text: &mut String, stack: &Vec<Style>, runs: &mut Vec<Run>| {
        if !text.is_empty() {
            runs.push(Run { text: decode_entities(text), style: stack.last().cloned().unwrap_or_default() });
            text.clear();
        }
    };
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else {
            // A stray "<": keep it as text.
            text.push('<');
            rest = after;
            continue;
        };
        let tag = &after[..close];
        rest = &after[close + 1..];
        let closing = tag.starts_with('/');
        let body = tag.trim_start_matches('/').trim_end_matches('/');
        let name = body.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        if name == "br" {
            text.push('\n');
            continue;
        }
        if !matches!(name.as_str(), "span" | "b" | "strong" | "i" | "em" | "u" | "s" | "strike" | "del" | "font" | "a") {
            continue;
        }
        flush(&mut text, &stack, &mut runs);
        if closing {
            if stack.len() > 1 {
                stack.pop();
            }
            continue;
        }
        if tag.ends_with('/') {
            continue;
        }
        let mut style = stack.last().cloned().unwrap_or_default();
        match name.as_str() {
            "b" | "strong" => style.bold = Some(true),
            "i" | "em" => style.italic = Some(true),
            "u" => style.underline = Some(true),
            "s" | "strike" | "del" => style.strike = Some(true),
            _ => {}
        }
        if let Some(start) = body.to_ascii_lowercase().find("style=") {
            let value = &body[start + 6..];
            if let Some(quote) = value.chars().next().filter(|c| *c == '\'' || *c == '"') {
                if let Some(end) = value[1..].find(quote) {
                    apply_css(&mut style, &value[1..1 + end]);
                }
            }
        }
        stack.push(style);
    }
    text.push_str(rest);
    flush(&mut text, &stack, &mut runs);
    runs
}

/// The text of a paragraph and the style most of it is in.
fn dominant(runs: &[Run], base: &Style) -> (String, Style) {
    let text: String = runs.iter().map(|r| r.text.as_str()).collect();
    let mut weight = 0usize;
    let (mut bold, mut italic, mut underline, mut strike) = (0usize, 0usize, 0usize, 0usize);
    let mut highlight: HashMap<String, usize> = HashMap::new();
    let mut color: HashMap<String, usize> = HashMap::new();
    let mut size: Vec<(f64, usize)> = Vec::new();
    let mut face: HashMap<String, usize> = HashMap::new();
    for run in runs {
        let count = run.text.chars().filter(|c| !c.is_whitespace()).count();
        if count == 0 {
            continue;
        }
        let s = layer(base, &run.style);
        weight += count;
        if s.bold == Some(true) { bold += count; }
        if s.italic == Some(true) { italic += count; }
        if s.underline == Some(true) { underline += count; }
        if s.strike == Some(true) { strike += count; }
        if let Some(h) = s.highlight { *highlight.entry(h).or_default() += count; }
        if let Some(c) = s.color { *color.entry(c).or_default() += count; }
        if let Some(f) = s.face { *face.entry(f).or_default() += count; }
        if let Some(z) = s.size {
            match size.iter_mut().find(|(v, _)| (*v - z).abs() < 0.01) {
                Some(entry) => entry.1 += count,
                None => size.push((z, count)),
            }
        }
    }
    let top = |map: HashMap<String, usize>| map.into_iter().max_by_key(|(k, n)| (*n, std::cmp::Reverse(k.clone()))).map(|(k, n)| (k, n));
    if weight == 0 {
        return (text, base.clone());
    }
    let majority = |n: usize| n * 2 > weight;
    let out = Style {
        bold: Some(majority(bold)),
        italic: Some(majority(italic)),
        underline: Some(majority(underline)),
        strike: Some(majority(strike)),
        highlight: top(highlight).filter(|(_, n)| n * 2 >= weight).map(|(k, _)| k),
        color: top(color).map(|(k, _)| k),
        face: top(face).map(|(k, _)| k),
        size: size.into_iter().max_by_key(|(_, n)| *n).map(|(v, _)| v).or(base.size),
    };
    (text, out)
}

// ---- Pictures ----------------------------------------------------------------------------------------------------

/// What the bytes of a picture are, from their first bytes.
pub fn sniff(prefix: &[u8]) -> Option<&'static str> {
    if prefix.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if prefix.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if prefix.starts_with(b"GIF8") {
        Some("gif")
    } else if prefix.starts_with(b"BM") {
        Some("bmp")
    } else if prefix.starts_with(&[b'I', b'I', 0x2A, 0x00]) || prefix.starts_with(&[b'M', b'M', 0x00, 0x2A]) {
        Some("tif")
    } else if prefix.len() >= 44 && &prefix[40..44] == b" EMF" {
        Some("emf")
    } else if prefix.starts_with(&[0xD7, 0xCD, 0xC6, 0x9A]) || prefix.starts_with(&[0x01, 0x00, 0x09, 0x00]) {
        Some("wmf")
    } else {
        None
    }
}

fn clean_base64(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

fn base64_prefix(data: &str) -> Vec<u8> {
    use base64::Engine;
    let head: String = data.chars().take(88).collect();
    let usable = head.len() / 4 * 4;
    base64::engine::general_purpose::STANDARD.decode(&head[..usable]).unwrap_or_default()
}

// ---- The page --------------------------------------------------------------------------------------------------

struct Ctx<'d> {
    page: PageContent,
    decode: Decoder<'d>,
    quick: HashMap<i32, QuickStyle>,
    /// Tag definitions that mean "to do": index -> true.
    todo_tags: HashMap<i32, bool>,
    /// Where the next flowed thing in the current outline sits.
    flow_x: f64,
    flow_y: f64,
}

impl Ctx<'_> {
    fn warn(&mut self, message: String) {
        if self.page.warnings.len() < 200 {
            self.page.warnings.push(message);
        }
    }
}

fn read_picture(node: &Node, ctx: &mut Ctx, at: Option<(f64, f64, i32)>, inline: bool) {
    let (w, h) = size(node).unwrap_or((0.0, 0.0));
    let (x, y, z) = at.or_else(|| position(node)).unwrap_or((ctx.flow_x, ctx.flow_y, 0));
    let Some(data_node) = child(node, "Data") else {
        let what = if child(node, "CallbackID").is_some() { "a picture whose data OneNote did not include" } else { "a picture with no data" };
        ctx.warn(format!("Skipped {what}."));
        ctx.page.unsupported.push(Unsupported { kind: "picture".into(), name: None, x, y, w, h });
        return;
    };
    let data = clean_base64(data_node.text().unwrap_or(""));
    let declared = node.attribute("format").map(|f| f.to_ascii_lowercase());
    let sniffed = sniff(&base64_prefix(&data));
    let format = sniffed.map(str::to_string).or(declared.filter(|f| ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"].contains(&f.as_str())));
    let format = match format.as_deref() {
        Some("jpeg") => Some("jpg".to_string()),
        Some("tiff") => Some("tif".to_string()),
        _ => format,
    };
    let alt = node.attribute("alt").filter(|a| !a.trim().is_empty()).map(str::to_string);
    match format {
        Some(format) if !data.is_empty() && w > 0.0 && h > 0.0 => {
            let ocr = child(node, "OCRData")
                .and_then(|o| child(&o, "OCRText"))
                .and_then(|t| t.text())
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty());
            ctx.page.images.push(PictureOut {
                x, y, w, h, z, format, data, alt, ocr,
                is_print_out: node.attribute("isPrintOut").is_some_and(|v| v == "true"),
                inline,
            });
        }
        other => {
            let kind = other.unwrap_or_else(|| sniffed.unwrap_or("unknown").to_string());
            ctx.page.unsupported.push(Unsupported { kind: format!("picture ({kind})"), name: alt, x, y, w, h });
        }
    }
}

/// The geometry an ink element states about itself: a `one:Position` and `one:Size`, or x/y/width/height attributes.
fn ink_box(node: &Node) -> Option<(Rect, i32)> {
    if let (Some((x, y, z)), Some((w, h))) = (position(node), size(node)) {
        return Some((Rect { x, y, w, h }, z));
    }
    let (x, y, w, h) = (num(node, "x")?, num(node, "y")?, num(node, "width")?, num(node, "height")?);
    Some((Rect { x, y, w, h }, 0))
}

fn read_ink(node: &Node, ctx: &mut Ctx, source: &str) {
    let Some(data_node) = child(node, "Data") else { return };
    use base64::Engine;
    let data = clean_base64(data_node.text().unwrap_or(""));
    let bytes = match base64::engine::general_purpose::STANDARD.decode(data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            ctx.warn(format!("Skipped ink ({source}) whose data was damaged."));
            return;
        }
    };
    let raw = match (ctx.decode)(&bytes) {
        Ok(r) => r,
        Err(e) => {
            ctx.warn(format!("Skipped ink ({source}): {e}"));
            return;
        }
    };
    if raw.is_empty() {
        return;
    }
    let target = ink_box(node);
    let strokes = place_strokes(&raw, target.as_ref().map(|(r, _)| r));
    let bounds = stroke_bounds(&strokes);
    let (rect, z) = match target {
        Some((r, z)) => (r, z),
        None => (bounds.clone(), 0),
    };
    ctx.page.ink.push(InkOut {
        source: source.into(),
        x: rect.x, y: rect.y, w: rect.w, h: rect.h, z,
        last_modified: node.attribute("lastModifiedTime").map(str::to_string),
        recognized: node.attribute("recognizedText").map(str::to_string).filter(|t| !t.is_empty()),
        strokes,
    });
}

const DIP_TO_POINT: f32 = 72.0 / 96.0;

/// How ISF coordinates relate to the page, found by comparing 11,950 decoded `InkDrawing`s with their own
/// `Position`/`Size` on real pages:
///  * the decoded coordinates are not page coordinates. In about 86% of drawings page = 0.9826 * decoded (to within
///    0.01 pt at the median); in the rest the scale is the same or exactly 1.0 but there is an extra offset of up to
///    hundreds of points, so no single transform fits them all;
///  * `Size` is the stroke's point extent times that scale plus a fixed 0.29 pt (half of it each side), and `Position`
///    is the top left of that box.
/// So each drawing is fitted to its own box: one uniform scale (box size / point extent, from the longer side) and a
/// translation that puts the centre of its points at the centre of the box. A drawing too small to measure a scale on
/// (a dot) uses 0.9826. Ink with no box (an `InkWord` that states none) has nothing to fit to and gets 0.9826 about the
/// container's own origin, which is unverified: no such ink was found in the notebooks tested.
const ISF_SCALE: f32 = 0.9826;
const BOX_PAD: f64 = 0.29;

/// The bounds of ink, pen width included, in points.
pub fn stroke_bounds(strokes: &[StrokeOut]) -> Rect {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for s in strokes {
        let pad = s.width as f64 / 2.0;
        for p in &s.points {
            x0 = x0.min(p[0] as f64 - pad);
            y0 = y0.min(p[1] as f64 - pad);
            x1 = x1.max(p[0] as f64 + pad);
            y1 = y1.max(p[1] as f64 + pad);
        }
    }
    if x0 > x1 {
        return Rect::default();
    }
    Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/// Decoded strokes as page points, fitted to the box the element says it occupies. See `ISF_SCALE`.
pub fn place_strokes(raw: &[RawStroke], target: Option<&Rect>) -> Vec<StrokeOut> {
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for s in raw {
        for p in &s.points {
            x0 = x0.min(p.x * DIP_TO_POINT);
            y0 = y0.min(p.y * DIP_TO_POINT);
            x1 = x1.max(p.x * DIP_TO_POINT);
            y1 = y1.max(p.y * DIP_TO_POINT);
        }
    }
    if x0 > x1 {
        return Vec::new();
    }
    let (ecx, ecy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let (scale, tcx, tcy) = match target {
        Some(t) => {
            let (ew, eh) = ((x1 - x0) as f64, (y1 - y0) as f64);
            let (extent, wanted) = if ew >= eh { (ew, t.w - BOX_PAD) } else { (eh, t.h - BOX_PAD) };
            let scale = if extent > 3.0 && wanted > 0.0 && (0.9..=1.1).contains(&(wanted / extent)) { (wanted / extent) as f32 } else { ISF_SCALE };
            (scale, (t.x + t.w / 2.0) as f32, (t.y + t.h / 2.0) as f32)
        }
        None => (ISF_SCALE, ecx * ISF_SCALE, ecy * ISF_SCALE),
    };
    raw.iter()
        .filter(|s| !s.points.is_empty())
        .map(|s| {
            let first = s.points[0].time;
            let timed = s.points.iter().any(|p| p.time != first);
            let kind = if s.highlighter { "highlighter" } else if s.pencil { "pencil" } else { "pen" };
            StrokeOut {
                points: s
                    .points
                    .iter()
                    .map(|p| [tcx + (p.x * DIP_TO_POINT - ecx) * scale, tcy + (p.y * DIP_TO_POINT - ecy) * scale, p.pressure.clamp(0.0, 1.0)])
                    .collect(),
                color: format!("#{:02X}{:02X}{:02X}{:02X}", s.color[0], s.color[1], s.color[2], s.color[3]),
                width: (s.size[0].max(s.size[1]) * DIP_TO_POINT * scale).max(0.1),
                kind: kind.into(),
                times: if timed { s.points.iter().map(|p| p.time.saturating_sub(first) as f64 / 1000.0).collect() } else { Vec::new() },
            }
        })
        .collect()
}

fn flag_true(node: &Node, name: &str) -> bool {
    node.attribute(name).is_some_and(|v| v.eq_ignore_ascii_case("true"))
}

fn paragraph_of(oe: &Node, level: u32, ctx: &mut Ctx) -> Paragraph {
    // The base style: the quick style the paragraph names, then its own `style` attribute.
    let mut base = Style::default();
    let quick = oe.attribute("quickStyleIndex").and_then(|v| v.parse::<i32>().ok());
    if let Some(q) = quick.and_then(|i| ctx.quick.get(&i)) {
        base.size = q.font_size;
        base.face = q.font.clone();
        base.color = q.font_color.clone();
    }
    if let Some(style) = oe.attribute("style") {
        apply_css(&mut base, style);
    }
    let mut runs: Vec<Run> = Vec::new();
    for t in oe.children().filter(|c| c.has_tag_name("T")) {
        runs.extend(parse_runs(t.text().unwrap_or("")));
    }
    let (text, style) = dominant(&runs, &base);
    let mut paragraph = Paragraph {
        text,
        level,
        list: "none".into(),
        font_size: style.size,
        bold: style.bold.unwrap_or(false),
        italic: style.italic.unwrap_or(false),
        underline: style.underline.unwrap_or(false),
        strike: style.strike.unwrap_or(false),
        color: style.color,
        highlight: style.highlight,
        face: style.face,
        quick_style: quick,
        ..Paragraph::default()
    };
    if let Some(list) = child(oe, "List") {
        if child(&list, "Number").is_some() {
            paragraph.list = "number".into();
            paragraph.number_text = child(&list, "Number").and_then(|n| n.attribute("text").map(str::to_string));
        } else if child(&list, "Bullet").is_some() {
            paragraph.list = "bullet".into();
        }
    }
    for tag in oe.children().filter(|c| c.has_tag_name("Tag")) {
        let index = tag.attribute("index").and_then(|v| v.parse::<i32>().ok());
        if index.is_some_and(|i| ctx.todo_tags.get(&i).copied().unwrap_or(false)) {
            paragraph.todo = Some(flag_true(&tag, "completed"));
        }
    }
    paragraph
}

/// The text of a table, a row to a line, its cells joined with " | ".
fn table_rows(table: &Node, ctx: &mut Ctx) -> Vec<String> {
    let mut rows = Vec::new();
    for row in table.children().filter(|c| c.has_tag_name("Row")) {
        let mut cells = Vec::new();
        for cell in row.children().filter(|c| c.has_tag_name("Cell")) {
            let mut inner = Vec::new();
            if let Some(children) = child(&cell, "OEChildren") {
                collect_cell_text(&children, ctx, &mut inner);
            }
            cells.push(inner.join(" ").trim().to_string());
        }
        rows.push(cells.join(" | "));
    }
    rows
}

fn collect_cell_text(children: &Node, ctx: &mut Ctx, out: &mut Vec<String>) {
    for oe in children.children().filter(|c| c.has_tag_name("OE")) {
        let p = paragraph_of(&oe, 0, ctx);
        let text = p.text.trim().replace('\n', " ");
        if !text.is_empty() {
            out.push(text);
        }
        if let Some(inner) = child(&oe, "OEChildren") {
            collect_cell_text(&inner, ctx, out);
        }
    }
}

const LINE_FACTOR: f64 = 1.4;

fn walk_oes(children: &Node, level: u32, ctx: &mut Ctx, out: &mut Vec<Paragraph>) {
    for oe in children.children().filter(|c| c.has_tag_name("OE")) {
        let p = paragraph_of(&oe, level, ctx);
        let line = p.font_size.unwrap_or(11.0) * LINE_FACTOR;
        let lines = p.text.matches('\n').count() as f64 + 1.0;
        let has_text = oe.children().any(|c| c.has_tag_name("T"));
        let mut handled_extra = false;
        for element in oe.children().filter(|c| c.is_element()) {
            match element.tag_name().name() {
                "T" | "List" | "Tag" | "OEChildren" | "Meta" => {}
                "Table" => {
                    handled_extra = true;
                    for row in table_rows(&element, ctx) {
                        out.push(Paragraph { text: row, level, list: "none".into(), table: true, font_size: p.font_size, ..Paragraph::default() });
                        ctx.flow_y += line;
                    }
                }
                "Image" => {
                    handled_extra = true;
                    let before = ctx.flow_y;
                    ctx.flow_x += 0.0;
                    read_picture(&element, ctx, None, true);
                    let h = size(&element).map(|s| s.1).unwrap_or(0.0);
                    ctx.flow_y = before + h;
                }
                "InkParagraph" | "InkWord" | "InkDrawing" => {
                    handled_extra = true;
                    let name = element.tag_name().name();
                    let source = if name == "InkDrawing" { "drawing" } else if name == "InkWord" { "word" } else { "paragraph" };
                    let words: Vec<Node> = element.descendants().filter(|d| d.has_tag_name("InkWord") && *d != element).collect();
                    if words.is_empty() {
                        read_ink(&element, ctx, source);
                    } else {
                        for word in words {
                            read_ink(&word, ctx, "word");
                        }
                    }
                }
                other => {
                    handled_extra = true;
                    let (w, h) = size(&element).unwrap_or((0.0, 0.0));
                    let name = element.attribute("preferredName").or_else(|| element.attribute("name")).map(str::to_string);
                    ctx.page.unsupported.push(Unsupported { kind: other.to_string(), name, x: ctx.flow_x, y: ctx.flow_y, w, h });
                }
            }
        }
        if has_text || !handled_extra {
            ctx.flow_y += line * lines + 2.0;
            out.push(p);
        }
        if let Some(inner) = child(&oe, "OEChildren") {
            walk_oes(&inner, level + 1, ctx, out);
        }
    }
}

fn read_outline(node: &Node, ctx: &mut Ctx) {
    let (x, y, z) = position(node).unwrap_or((36.0, 36.0, 0));
    let (w, h) = size(node).unwrap_or((0.0, 0.0));
    ctx.flow_x = x;
    ctx.flow_y = y;
    let mut paragraphs = Vec::new();
    if let Some(children) = child(node, "OEChildren") {
        walk_oes(&children, 0, ctx, &mut paragraphs);
    }
    ctx.page.outlines.push(OutlineOut { x, y, w, h, z, paragraphs });
}

fn read_title(node: &Node, ctx: &mut Ctx) {
    let mut text = String::new();
    let mut size_pt = None;
    for oe in node.descendants().filter(|d| d.has_tag_name("OE")) {
        let p = paragraph_of(&oe, 0, ctx);
        if !text.is_empty() && !p.text.is_empty() {
            text.push(' ');
        }
        text.push_str(p.text.trim());
        size_pt = size_pt.or(p.font_size);
    }
    let (x, y, _) = position(node).unwrap_or((36.0, 43.2, 0));
    let w = size(node).map(|s| s.0).unwrap_or(0.0);
    ctx.page.title = Some(TitleOut { text, x, y, w, font_size: size_pt });
}

fn grow(extent: &mut (f64, f64, f64, f64), x: f64, y: f64, w: f64, h: f64) {
    if w < 0.0 || h < 0.0 || !x.is_finite() || !y.is_finite() {
        return;
    }
    extent.0 = extent.0.min(x);
    extent.1 = extent.1.min(y);
    extent.2 = extent.2.max(x + w);
    extent.3 = extent.3.max(y + h);
}

/// Reads a page. `decode` turns an ISF blob into strokes (Windows' ink container, or a stub in tests).
pub fn parse_page(xml: &str, decode: Decoder) -> Result<PageContent, String> {
    let document = Document::parse_with_options(xml, roxmltree::ParsingOptions { allow_dtd: false, ..Default::default() })
        .map_err(|e| format!("The page could not be read: {e}"))?;
    let root = document.root_element();
    if root.tag_name().name() != "Page" {
        return Err("OneNote did not return a page.".into());
    }
    let mut ctx = Ctx {
        page: PageContent {
            id: root.attribute("ID").unwrap_or("").into(),
            name: root.attribute("name").unwrap_or("").into(),
            created: root.attribute("dateTime").map(str::to_string),
            last_modified: root.attribute("lastModifiedTime").map(str::to_string),
            lang: root.attribute("lang").map(str::to_string),
            ..PageContent::default()
        },
        decode,
        quick: HashMap::new(),
        todo_tags: HashMap::new(),
        flow_x: 36.0,
        flow_y: 36.0,
    };
    // Definitions first: paragraphs refer to them by index.
    for node in root.children().filter(|c| c.is_element()) {
        match node.tag_name().name() {
            "QuickStyleDef" => {
                if let Some(index) = node.attribute("index").and_then(|v| v.parse::<i32>().ok()) {
                    ctx.quick.insert(index, QuickStyle {
                        index,
                        name: node.attribute("name").unwrap_or("").into(),
                        font: node.attribute("font").map(str::to_string),
                        font_size: num(&node, "fontSize"),
                        font_color: node.attribute("fontColor").and_then(css_color),
                    });
                }
            }
            "TagDef" => {
                if let Some(index) = node.attribute("index").and_then(|v| v.parse::<i32>().ok()) {
                    // The check-box tags: To Do (symbol 3) and its priority variants.
                    let symbol = num(&node, "symbol").unwrap_or(-1.0) as i32;
                    let name = node.attribute("name").unwrap_or("").to_ascii_lowercase();
                    ctx.todo_tags.insert(index, matches!(symbol, 3 | 12 | 13 | 28 | 94 | 95 | 96 | 97 | 98 | 99 | 100) || name.starts_with("to do") || name.starts_with("to-do"));
                }
            }
            "PageSettings" => {
                ctx.page.background = node.attribute("color").and_then(css_color);
                if let Some(rules) = child(&node, "RuleLines").filter(|r| flag_true(r, "visible")) {
                    let horizontal = child(&rules, "Horizontal");
                    let vertical = child(&rules, "Vertical");
                    ctx.page.rule_lines = Some(RuleLinesOut {
                        horizontal: horizontal.is_some(),
                        vertical: vertical.is_some(),
                        spacing: horizontal.as_ref().or(vertical.as_ref()).and_then(|n| num(n, "spacing")).unwrap_or(28.35),
                        color: horizontal.as_ref().or(vertical.as_ref()).and_then(|n| n.attribute("color")).and_then(css_color),
                    });
                }
            }
            _ => {}
        }
    }
    for node in root.children().filter(|c| c.is_element()) {
        match node.tag_name().name() {
            "QuickStyleDef" | "TagDef" | "PageSettings" | "Meta" => {}
            "Title" => read_title(&node, &mut ctx),
            "Outline" => read_outline(&node, &mut ctx),
            "Image" => read_picture(&node, &mut ctx, None, false),
            "InkDrawing" => read_ink(&node, &mut ctx, "drawing"),
            other => {
                let (x, y, _) = position(&node).unwrap_or((0.0, 0.0, 0));
                let (w, h) = size(&node).unwrap_or((0.0, 0.0));
                let name = node.attribute("preferredName").or_else(|| node.attribute("name")).map(str::to_string);
                ctx.page.unsupported.push(Unsupported { kind: other.to_string(), name, x, y, w, h });
            }
        }
    }
    // The box around everything, so the page can be made big enough to hold it.
    let mut extent = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let page = &ctx.page;
    for o in &page.outlines {
        let height = (o.h).max(o.paragraphs.len() as f64 * 15.0);
        grow(&mut extent, o.x, o.y, o.w.max(40.0), height);
    }
    for i in &page.images {
        grow(&mut extent, i.x, i.y, i.w, i.h);
    }
    for i in &page.ink {
        let b = stroke_bounds(&i.strokes);
        grow(&mut extent, b.x, b.y, b.w, b.h);
    }
    for u in &page.unsupported {
        grow(&mut extent, u.x, u.y, u.w, u.h);
    }
    if let Some(t) = &page.title {
        grow(&mut extent, t.x, t.y, t.w.max(100.0), 40.0);
    }
    ctx.page.extent = Rect { x: 0.0, y: 0.0, w: extent.2, h: extent.3 };
    Ok(ctx.page)
}
