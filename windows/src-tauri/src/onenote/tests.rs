use super::isf::{RawPoint, RawStroke};
use super::page::{css_color, parse_page, place_strokes, sniff};
use super::model::Rect;

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

fn stub(_: &[u8]) -> Result<Vec<RawStroke>, String> {
    // A 100 x 50 DIP stroke at (200, 400) with pressure rising; a highlighter second stroke.
    let line = |y: f32, highlighter: bool, pressure: f32| RawStroke {
        points: (0..=4).map(|i| RawPoint { x: 200.0 + i as f32 * 25.0, y: 400.0 + y, pressure, time: (i * 8000) as u64 }).collect(),
        color: if highlighter { [255, 235, 59, 255] } else { [10, 20, 30, 255] },
        size: [2.0, 2.0],
        highlighter,
        pencil: false,
        bounds: [200.0, 400.0 + y, 100.0, 1.0],
    };
    Ok(vec![line(0.0, false, 0.25), line(50.0, true, 0.75)])
}

fn page_xml() -> String {
    format!(
        r##"<?xml version="1.0"?>
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="{{P}}" name="Notes" dateTime="2026-09-21T06:57:24.000Z" lastModifiedTime="2026-10-09T15:50:02.000Z" lang="de">
 <one:TagDef index="0" type="0" symbol="3" fontColor="automatic" highlightColor="none" name="To Do"/>
 <one:QuickStyleDef index="0" name="PageTitle" fontColor="#E7E6E6" highlightColor="automatic" font="Calibri Light" fontSize="20.0" spaceBefore="0.0" spaceAfter="0.0"/>
 <one:QuickStyleDef index="1" name="h1" fontColor="#1E4E79" highlightColor="automatic" font="Calibri Light" fontSize="16.0" spaceBefore="0.0" spaceAfter="0.0"/>
 <one:PageSettings RTL="false" color="#FFF8C4"><one:PageSize><one:Automatic/></one:PageSize><one:RuleLines visible="true"><one:Horizontal color="#CAEBFD" spacing="28.3"/></one:RuleLines></one:PageSettings>
 <one:Title lang="de"><one:OE quickStyleIndex="0" style="font-family:'Calibri Light';font-size:20.0pt"><one:T><![CDATA[Mein &amp; Titel]]></one:T></one:OE></one:Title>
 <one:Outline objectID="{{O1}}"><one:Position x="36.0" y="90.0" z="1"/><one:Size width="300.0" height="120.0"/>
  <one:OEChildren>
   <one:OE quickStyleIndex="1"><one:T><![CDATA[<span style='font-weight:bold'>Heading</span>]]></one:T></one:OE>
   <one:OE><one:List><one:Bullet bullet="2"/></one:List><one:T><![CDATA[first&nbsp;point<br/>soft break]]></one:T>
     <one:OEChildren><one:OE><one:List><one:Bullet bullet="2"/></one:List><one:T><![CDATA[nested <span style='background:yellow;color:#C00000'>marked</span>]]></one:T></one:OE></one:OEChildren></one:OE>
   <one:OE><one:Tag index="0" completed="true"/><one:T><![CDATA[done thing]]></one:T></one:OE>
   <one:OE><one:Tag index="0" completed="false"/><one:T><![CDATA[open thing]]></one:T></one:OE>
   <one:OE><one:Table bordersVisible="true"><one:Columns><one:Column index="0" width="50"/><one:Column index="1" width="50"/></one:Columns>
     <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[a]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[b]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>
     <one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[c]]></one:T></one:OE></one:OEChildren></one:Cell><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[d]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row>
   </one:Table></one:OE>
   <one:OE><one:InsertedFile pathCache="x" preferredName="notes.pdf"/></one:OE>
  </one:OEChildren></one:Outline>
 <one:Image format="png"><one:Position x="40.0" y="300.0" z="2"/><one:Size width="100.0" height="80.0"/><one:Data>{png}</one:Data><one:OCRData lang="en"><one:OCRText><![CDATA[hello picture]]></one:OCRText></one:OCRData></one:Image>
 <one:Image><one:Position x="0" y="0"/><one:Size width="10" height="10"/><one:Data>AAAA</one:Data></one:Image>
 <one:InkDrawing lastModifiedTime="2026-09-21T08:31:47.000Z"><one:Position x="100.0" y="500.0" z="9"/><one:Size width="75.0" height="37.8"/><one:Data>AAAA</one:Data></one:InkDrawing>
 <one:InkDrawing lastModifiedTime="2026-09-21T08:31:48.000Z"><one:Position x="1" y="1"/><one:Size width="1" height="1"/><one:Data>@@not base64@@</one:Data></one:InkDrawing>
 <one:MediaFile preferredName="clip.mp4"/>
</one:Page>"##,
        png = PNG_1X1
    )
}

#[test]
fn converts_text_lists_todos_tables_and_styles() {
    let page = parse_page(&page_xml(), &stub).unwrap();
    assert_eq!(page.name, "Notes");
    assert_eq!(page.title.as_ref().unwrap().text, "Mein & Titel");
    assert_eq!(page.background.as_deref(), Some("#FFF8C4"));
    let rules = page.rule_lines.as_ref().unwrap();
    assert!(rules.horizontal && !rules.vertical);
    let outline = &page.outlines[0];
    assert_eq!((outline.x, outline.y, outline.w), (36.0, 90.0, 300.0));
    let texts: Vec<&str> = outline.paragraphs.iter().map(|p| p.text.as_str()).collect();
    assert_eq!(texts[0], "Heading");
    assert_eq!(texts[1], "first point\nsoft break");
    assert_eq!(texts[2], "nested marked");
    assert_eq!(texts[3], "done thing");
    assert_eq!(texts[5], "a | b");
    assert_eq!(texts[6], "c | d");
    let heading = &outline.paragraphs[0];
    assert!(heading.bold);
    assert_eq!(heading.font_size, Some(16.0));
    assert_eq!(heading.color.as_deref(), Some("#1E4E79"));
    assert_eq!(outline.paragraphs[1].list, "bullet");
    assert_eq!(outline.paragraphs[2].level, 1);
    assert_eq!(outline.paragraphs[2].highlight.as_deref(), Some("#FFFF00"));
    assert_eq!(outline.paragraphs[3].todo, Some(true));
    assert_eq!(outline.paragraphs[4].todo, Some(false));
    assert!(outline.paragraphs[5].table);
}

#[test]
fn lists_what_it_cannot_convert_and_skips_broken_elements_with_warnings() {
    let page = parse_page(&page_xml(), &stub).unwrap();
    let kinds: Vec<&str> = page.unsupported.iter().map(|u| u.kind.as_str()).collect();
    assert!(kinds.contains(&"InsertedFile"), "{kinds:?}");
    assert!(kinds.contains(&"MediaFile"), "{kinds:?}");
    // The second picture is not a picture at all.
    assert!(kinds.iter().any(|k| k.starts_with("picture")), "{kinds:?}");
    assert_eq!(page.images.len(), 1);
    assert!(page.warnings.iter().any(|w| w.contains("damaged")), "{:?}", page.warnings);
}

#[test]
fn reads_pictures_with_their_text() {
    let page = parse_page(&page_xml(), &stub).unwrap();
    let image = &page.images[0];
    assert_eq!(image.format, "png");
    assert_eq!((image.x, image.y, image.w, image.h), (40.0, 300.0, 100.0, 80.0));
    assert_eq!(image.ocr.as_deref(), Some("hello picture"));
    assert!(!image.inline);
}

#[test]
fn fits_ink_to_its_box_and_keeps_pressure_kind_and_width() {
    let page = parse_page(&page_xml(), &stub).unwrap();
    assert_eq!(page.ink.len(), 1);
    let ink = &page.ink[0];
    assert_eq!((ink.x, ink.y, ink.w, ink.h), (100.0, 500.0, 75.0, 37.8));
    assert_eq!(ink.strokes.len(), 2);
    let pen = &ink.strokes[0];
    assert_eq!(pen.kind, "pen");
    assert_eq!(pen.color, "#0A141EFF");
    assert!((pen.points[0][2] - 0.25).abs() < 1e-6);
    assert_eq!(ink.strokes[1].kind, "highlighter");
    assert_eq!(pen.times.len(), 5);
    assert_eq!(pen.times[4], 32.0);
    // The union of the points sits centred in the stated box.
    let xs: Vec<f32> = ink.strokes.iter().flat_map(|s| s.points.iter().map(|p| p[0])).collect();
    let ys: Vec<f32> = ink.strokes.iter().flat_map(|s| s.points.iter().map(|p| p[1])).collect();
    let (x0, x1) = (xs.iter().cloned().fold(f32::MAX, f32::min), xs.iter().cloned().fold(f32::MIN, f32::max));
    let (y0, y1) = (ys.iter().cloned().fold(f32::MAX, f32::min), ys.iter().cloned().fold(f32::MIN, f32::max));
    assert!(((x0 + x1) / 2.0 - 137.5).abs() < 0.01 && ((y0 + y1) / 2.0 - 518.9).abs() < 0.01);
    // 75 pt box less the 0.29 pad over a 75 pt (100 DIP) extent: a scale a little under one.
    assert!(((x1 - x0) - 74.71).abs() < 0.01, "{}", x1 - x0);
}

#[test]
fn ink_without_a_box_uses_the_default_scale_and_tiny_ink_does_too() {
    let raw = stub(&[]).unwrap();
    let placed = place_strokes(&raw, None);
    assert!((placed[0].points[0][0] - 150.0 * 0.9826).abs() < 0.01);
    let dot = vec![RawStroke {
        points: vec![RawPoint { x: 10.0, y: 10.0, pressure: 0.5, time: 0 }],
        color: [0, 0, 0, 255],
        size: [1.0, 1.0],
        highlighter: false,
        pencil: true,
        bounds: [10.0, 10.0, 1.0, 1.0],
    }];
    let placed = place_strokes(&dot, Some(&Rect { x: 50.0, y: 60.0, w: 0.3, h: 0.3 }));
    assert_eq!(placed[0].kind, "pencil");
    assert!((placed[0].points[0][0] - 50.15).abs() < 0.001);
}

#[test]
fn page_extent_covers_everything() {
    let page = parse_page(&page_xml(), &stub).unwrap();
    assert!(page.extent.w >= 336.0 && page.extent.h >= 537.0, "{:?}", page.extent);
}

#[test]
fn survives_garbage() {
    assert!(parse_page("", &stub).is_err());
    assert!(parse_page("<one:Notebooks xmlns:one='x'/>", &stub).is_err());
    let odd = r#"<one:Page xmlns:one="x"><one:Outline><one:Position x="a" y="b"/><one:OEChildren><one:OE><one:T><![CDATA[<span style='font-size:zz'>x&bogus; <b]]></one:T></one:OE></one:OEChildren></one:Outline><one:Image><one:Data>!!</one:Data></one:Image></one:Page>"#;
    let page = parse_page(odd, &stub).unwrap();
    assert_eq!(page.outlines[0].paragraphs[0].text, "x&bogus; <b");
}

#[test]
fn colours_and_picture_formats() {
    assert_eq!(css_color("#abc").as_deref(), Some("#AABBCC"));
    assert_eq!(css_color("yellow").as_deref(), Some("#FFFF00"));
    assert_eq!(css_color("rgb(1, 2, 3)").as_deref(), Some("#010203"));
    assert_eq!(css_color("automatic"), None);
    assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0, 0]), Some("png"));
    assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
    let mut emf = vec![0u8; 44];
    emf[40..44].copy_from_slice(b" EMF");
    assert_eq!(sniff(&emf), Some("emf"));
    assert_eq!(sniff(&[1, 2, 3]), None);
}

/// Talks to the real OneNote, read-only. Run by hand: `cargo test onenote::tests::real -- --ignored --nocapture`.
/// With `ONENOTE_DUMP_DIR` set, the converted pages are written there as JSON for the web side's tests.
#[cfg(windows)]
#[test]
#[ignore]
fn real_onenote_hierarchy_and_pages() {
    use super::com::Session;
    use super::hierarchy::parse_hierarchy;
    use std::time::Instant;
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED);
    }
    let mut session = Session::new_for_tests();
    let started = Instant::now();
    let xml = session.hierarchy().expect("hierarchy");
    let books = parse_hierarchy(&xml).expect("parse");
    let sections: Vec<_> = books.iter().flat_map(|b| all_sections(&b.groups, &b.sections)).collect();
    let pages: usize = sections.iter().map(|s| s.pages.len()).sum();
    println!("hierarchy: {} notebooks, {} sections, {} pages in {:?}", books.len(), sections.len(), pages, started.elapsed());
    let dump = std::env::var("ONENOTE_DUMP_DIR").ok();
    let wanted: usize = std::env::var("ONENOTE_SAMPLE").ok().and_then(|v| v.parse().ok()).unwrap_or(24);
    // Pages from every section in turn, so the sample spans notebooks.
    let mut picks = Vec::new();
    let mut round = 0;
    while picks.len() < wanted && round < 6 {
        for s in &sections {
            if s.locked || s.is_in_recycle_bin || s.is_deleted_pages {
                continue;
            }
            if let Some(p) = s.pages.get(round) {
                picks.push((s.name.clone(), p.clone()));
            }
        }
        round += 1;
    }
    picks.truncate(wanted);
    let mut totals = (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut kinds: std::collections::BTreeMap<String, usize> = Default::default();
    for (index, (_, page_ref)) in picks.iter().enumerate() {
        let t = Instant::now();
        let xml = match session.page(&page_ref.id) {
            Ok(x) => x,
            Err(e) => {
                println!("page {index}: {e}");
                continue;
            }
        };
        let fetched = t.elapsed();
        let page = match super::page::parse_page(&xml, &super::isf::decode) {
            Ok(p) => p,
            Err(e) => {
                println!("page {index}: convert error {e}");
                continue;
            }
        };
        let strokes: usize = page.ink.iter().map(|i| i.strokes.len()).sum();
        totals.0 += 1;
        totals.1 += strokes;
        totals.2 += page.images.len();
        totals.3 += page.outlines.iter().map(|o| o.paragraphs.len()).sum::<usize>();
        totals.4 += page.warnings.len();
        for u in &page.unsupported {
            *kinds.entry(u.kind.clone()).or_default() += 1;
        }
        // Does ink sit within the page's pictures and text? Count strokes whose centre lies inside any picture or outline.
        let mut inside = 0usize;
        for ink in &page.ink {
            let (cx, cy) = (ink.x + ink.w / 2.0, ink.y + ink.h / 2.0);
            let hit = page.images.iter().any(|i| cx >= i.x && cx <= i.x + i.w && cy >= i.y && cy <= i.y + i.h)
                || page.outlines.iter().any(|o| cx >= o.x && cx <= o.x + o.w.max(1.0) && cy >= o.y && cy <= o.y + o.h.max(1.0));
            if hit {
                inside += 1;
            }
        }
        println!(
            "page {index}: fetch {:?} total {:?} | outlines {} paragraphs {} images {} drawings {} strokes {} (drawings over a picture/text: {}) unsupported {} warnings {} extent {:.0}x{:.0}",
            fetched, t.elapsed(), page.outlines.len(), page.outlines.iter().map(|o| o.paragraphs.len()).sum::<usize>(), page.images.len(),
            page.ink.len(), strokes, inside, page.unsupported.len(), page.warnings.len(), page.extent.w, page.extent.h
        );
        if let Some(dir) = &dump {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::write(std::path::Path::new(dir).join(format!("page{index}.json")), serde_json::to_vec(&page).unwrap()).unwrap();
        }
    }
    println!("sampled {} pages: strokes {} images {} paragraphs {} warnings {}; unsupported kinds {:?}", totals.0, totals.1, totals.2, totals.3, totals.4, kinds);
}

#[cfg(windows)]
fn all_sections(groups: &[super::model::SectionGroup], sections: &[super::model::Section]) -> Vec<super::model::Section> {
    let mut out: Vec<super::model::Section> = sections.to_vec();
    for g in groups {
        if g.is_recycle_bin {
            continue;
        }
        out.extend(all_sections(&g.groups, &g.sections));
    }
    out
}
