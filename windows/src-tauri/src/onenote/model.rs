//! What the importer hands to the web side, as JSON. All lengths are page points (72 to the inch).

use serde::Serialize;

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageRef {
    pub id: String,
    pub name: String,
    pub date_time: Option<String>,
    pub last_modified: Option<String>,
    /// 1 for a page, 2 and 3 for subpages.
    pub level: u32,
    pub is_unread: bool,
    pub is_in_recycle_bin: bool,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub path: Option<String>,
    pub last_modified: Option<String>,
    /// Password protected and not unlocked: its pages cannot be read.
    pub locked: bool,
    pub encrypted: bool,
    pub read_only: bool,
    pub is_in_recycle_bin: bool,
    pub is_deleted_pages: bool,
    pub pages: Vec<PageRef>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SectionGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub last_modified: Option<String>,
    pub is_recycle_bin: bool,
    pub groups: Vec<SectionGroup>,
    pub sections: Vec<Section>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: String,
    pub name: String,
    pub nickname: Option<String>,
    pub path: Option<String>,
    pub color: Option<String>,
    pub last_modified: Option<String>,
    pub groups: Vec<SectionGroup>,
    pub sections: Vec<Section>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalNotebook {
    pub name: String,
    pub path: String,
    pub is_open: bool,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub text: String,
    /// Indent level, 0 at the outline's edge.
    pub level: u32,
    /// "bullet", "number" or "none".
    pub list: String,
    pub number_text: Option<String>,
    /// A to-do tag: Some(ticked).
    pub todo: Option<bool>,
    pub font_size: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub color: Option<String>,
    pub highlight: Option<String>,
    pub face: Option<String>,
    /// The paragraph is a table row ("a | b | c").
    pub table: bool,
    pub quick_style: Option<i32>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineOut {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: i32,
    pub paragraphs: Vec<Paragraph>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PictureOut {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: i32,
    /// "png", "jpg", "gif", "bmp" or "tif": what the bytes are. Anything else is listed as unsupported instead.
    pub format: String,
    /// Base64 of the bytes in `format`.
    pub data: String,
    pub alt: Option<String>,
    /// Text OneNote read from the picture.
    pub ocr: Option<String>,
    /// OneNote showed this as a printed-out file (a PDF page, say).
    pub is_print_out: bool,
    /// Placed by flow inside an outline, so x and y are an estimate.
    pub inline: bool,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct StrokeOut {
    /// x, y, pressure 0..1.
    pub points: Vec<[f32; 3]>,
    /// "#RRGGBBAA".
    pub color: String,
    /// Points.
    pub width: f32,
    /// "pen", "highlighter" or "pencil".
    pub kind: String,
    /// Milliseconds from the stroke's first point, one per point; empty when the file has none.
    pub times: Vec<f64>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InkOut {
    /// "drawing", "word" or "paragraph".
    pub source: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: i32,
    /// When it was last changed, "2026-09-21T08:31:47.000Z".
    pub last_modified: Option<String>,
    /// OneNote's own reading of handwriting in a word, if it made one.
    pub recognized: Option<String>,
    pub strokes: Vec<StrokeOut>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct Unsupported {
    pub kind: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleOut {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub font_size: Option<f64>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleLinesOut {
    pub horizontal: bool,
    pub vertical: bool,
    pub spacing: f64,
    pub color: Option<String>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickStyle {
    pub index: i32,
    pub name: String,
    pub font: Option<String>,
    pub font_size: Option<f64>,
    pub font_color: Option<String>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub id: String,
    pub name: String,
    pub created: Option<String>,
    pub last_modified: Option<String>,
    pub lang: Option<String>,
    pub title: Option<TitleOut>,
    pub rule_lines: Option<RuleLinesOut>,
    /// "#RRGGBB" or None for OneNote's automatic (white).
    pub background: Option<String>,
    pub quick_styles: Vec<QuickStyle>,
    /// The box that holds everything on the page, from 0,0.
    pub extent: Rect,
    pub outlines: Vec<OutlineOut>,
    pub images: Vec<PictureOut>,
    pub ink: Vec<InkOut>,
    pub unsupported: Vec<Unsupported>,
    pub warnings: Vec<String>,
}
