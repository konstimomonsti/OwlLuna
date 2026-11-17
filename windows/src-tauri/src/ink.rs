//! Handwriting recognition with the recognizers Windows has installed (Windows.UI.Input.Inking).

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct InkLine {
    pub text: String,
    pub candidates: Vec<String>,
    /// x, y, width, height in page points.
    pub bounds: [f32; 4],
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
pub struct InkText {
    pub text: String,
    pub lines: Vec<InkLine>,
}

/// One recognised word, as the recognizer reports them.
#[derive(Debug, Clone)]
pub struct Word {
    pub candidates: Vec<String>,
    pub bounds: [f32; 4],
}

/// Words come back one at a time in no promised order. This sorts them into lines (top to bottom) and each line
/// into words (left to right). A word joins a line when they overlap vertically by at least half the shorter height.
pub fn group_lines(mut words: Vec<Word>) -> InkText {
    words.retain(|w| w.candidates.first().is_some_and(|t| !t.trim().is_empty()));
    words.sort_by(|a, b| a.bounds[1].total_cmp(&b.bounds[1]));
    let mut lines: Vec<Vec<Word>> = Vec::new();
    for word in words {
        let found = lines.iter_mut().find(|line| {
            let (top, bottom) = line
                .iter()
                .fold((f32::MAX, f32::MIN), |(t, b), w| (t.min(w.bounds[1]), b.max(w.bounds[1] + w.bounds[3])));
            let overlap = bottom.min(word.bounds[1] + word.bounds[3]) - top.max(word.bounds[1]);
            let shorter = (bottom - top).min(word.bounds[3]).max(0.001);
            overlap >= shorter * 0.5
        });
        match found {
            Some(line) => line.push(word),
            None => lines.push(vec![word]),
        }
    }
    let mut out: Vec<InkLine> = lines
        .into_iter()
        .map(|mut line| {
            line.sort_by(|a, b| a.bounds[0].total_cmp(&b.bounds[0]));
            let left = line.iter().map(|w| w.bounds[0]).fold(f32::MAX, f32::min);
            let top = line.iter().map(|w| w.bounds[1]).fold(f32::MAX, f32::min);
            let right = line.iter().map(|w| w.bounds[0] + w.bounds[2]).fold(f32::MIN, f32::max);
            let bottom = line.iter().map(|w| w.bounds[1] + w.bounds[3]).fold(f32::MIN, f32::max);
            let nth = |w: &Word, i: usize| w.candidates.get(i).or(w.candidates.first()).cloned().unwrap_or_default();
            let depth = line.iter().map(|w| w.candidates.len()).max().unwrap_or(1);
            let mut candidates: Vec<String> = Vec::new();
            for i in 0..depth {
                let text = line.iter().map(|w| nth(w, i)).collect::<Vec<_>>().join(" ");
                if !candidates.contains(&text) {
                    candidates.push(text);
                }
            }
            InkLine { text: candidates[0].clone(), candidates, bounds: [left, top, right - left, bottom - top] }
        })
        .collect();
    out.sort_by(|a, b| a.bounds[1].total_cmp(&b.bounds[1]));
    InkText { text: out.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n"), lines: out }
}

/// Which of the installed recognizers fits a language tag such as `en-US`: one whose name holds the language's
/// English name, preferring one that also names the region.
pub fn pick_recognizer(names: &[String], tag: &str) -> Option<usize> {
    let mut parts = tag.split(['-', '_']);
    let primary = parts.next()?.to_lowercase();
    let region = parts.last().map(|r| r.to_lowercase());
    let language = match primary.as_str() {
        "en" => "english",
        "es" => "spanish",
        "fr" => "french",
        "de" => "german",
        "it" => "italian",
        "pt" => "portuguese",
        "nl" => "dutch",
        other => other,
    };
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let fits: Vec<usize> = (0..names.len()).filter(|&i| lower[i].contains(language)).collect();
    if let Some(region) = region {
        if let Some(&i) = fits.iter().find(|&&i| lower[i].contains(&format!("({region}"))) {
            return Some(i);
        }
    }
    fits.first().copied()
}

#[cfg(windows)]
const NOT_INSTALLED: &str = "Handwriting recognition for this language is not installed in Windows. Add it in Settings > Time & language > Language & region > the language > Handwriting.";

#[cfg(windows)]
mod imp {
    use super::*;
    use windows_collections::IIterable;
    use windows::Foundation::Point;
    use windows::UI::Input::Inking::{InkRecognitionTarget, InkRecognizerContainer, InkStrokeBuilder, InkStrokeContainer};

    fn err(e: windows::core::Error) -> String {
        format!("Windows ink error: {}", e.message())
    }

    pub fn recognizers() -> Result<Vec<String>, String> {
        let container = InkRecognizerContainer::new().map_err(err)?;
        let list = container.GetRecognizers().map_err(err)?;
        let mut names = Vec::new();
        for recognizer in list {
            names.push(recognizer.Name().map_err(err)?.to_string());
        }
        Ok(names)
    }

    pub fn recognize(strokes: Vec<Vec<[f32; 2]>>, language: Option<String>) -> Result<InkText, String> {
        let container = InkRecognizerContainer::new().map_err(err)?;
        let installed = container.GetRecognizers().map_err(err)?;
        if installed.Size().map_err(err)? == 0 {
            return Err(NOT_INSTALLED.to_string());
        }
        if let Some(tag) = language.filter(|t| !t.trim().is_empty()) {
            let mut names = Vec::new();
            for r in &installed {
                names.push(r.Name().map_err(err)?.to_string());
            }
            // A language with no recognizer keeps Windows' default one rather than failing.
            if let Some(index) = pick_recognizer(&names, &tag) {
                let recognizer = installed.GetAt(index as u32).map_err(err)?;
                container.SetDefaultRecognizer(&recognizer).map_err(err)?;
            }
        }
        let strokes: Vec<Vec<[f32; 2]>> = strokes.into_iter().filter(|s| !s.is_empty()).collect();
        if strokes.is_empty() {
            return Ok(InkText::default());
        }
        let scale = 96.0 / 72.0;
        let builder = InkStrokeBuilder::new().map_err(err)?;
        let strokes_container = InkStrokeContainer::new().map_err(err)?;
        for stroke in &strokes {
            let mut points: Vec<Point> = stroke.iter().map(|p| Point { X: p[0] * scale, Y: p[1] * scale }).collect();
            if points.len() == 1 {
                // A dot is a stroke too, but Windows wants two points to make one.
                points.push(Point { X: points[0].X + 0.01, Y: points[0].Y });
            }
            let iterable: IIterable<Point> = points.into();
            let built = builder.CreateStroke(&iterable).map_err(err)?;
            strokes_container.AddStroke(&built).map_err(err)?;
        }
        let results = container
            .RecognizeAsync(&strokes_container, InkRecognitionTarget::All)
            .map_err(err)?
            .join()
            .map_err(err)?;
        let back = 72.0 / 96.0;
        let mut words = Vec::new();
        for result in results {
            let rect = result.BoundingRect().map_err(err)?;
            let mut candidates = Vec::new();
            for text in result.GetTextCandidates().map_err(err)? {
                candidates.push(text.to_string());
            }
            words.push(Word { candidates, bounds: [rect.X * back, rect.Y * back, rect.Width * back, rect.Height * back] });
        }
        Ok(group_lines(words))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn recognizers() -> Result<Vec<String>, String> {
        Err("Handwriting recognition needs the Windows app.".into())
    }
    pub fn recognize(_: Vec<Vec<[f32; 2]>>, _: Option<String>) -> Result<InkText, String> {
        Err("Handwriting recognition needs the Windows app.".into())
    }
}

pub use imp::{recognize as recognize_blocking, recognizers as recognizers_blocking};

#[tauri::command]
pub async fn ink_recognize(strokes: Vec<Vec<[f32; 2]>>, language: Option<String>) -> Result<InkText, String> {
    tauri::async_runtime::spawn_blocking(move || recognize_blocking(strokes, language))
        .await
        .map_err(|e| format!("recognition stopped: {e}"))?
}

#[tauri::command]
pub async fn ink_recognizers() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(recognizers_blocking)
        .await
        .map_err(|e| format!("recognition stopped: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: f32, y: f32, w: f32, h: f32) -> Word {
        Word { candidates: vec![text.into(), format!("{text}2")], bounds: [x, y, w, h] }
    }

    #[test]
    fn words_become_lines_in_reading_order() {
        let out = group_lines(vec![
            word("world", 80.0, 12.0, 40.0, 20.0),
            word("second", 0.0, 60.0, 50.0, 20.0),
            word("hello", 0.0, 10.0, 70.0, 22.0),
        ]);
        assert_eq!(out.text, "hello world\nsecond");
        assert_eq!(out.lines.len(), 2);
        assert_eq!(out.lines[0].candidates, vec!["hello world", "hello2 world2"]);
        assert_eq!(out.lines[0].bounds, [0.0, 10.0, 120.0, 22.0]);
    }

    #[test]
    fn picks_the_recognizer_for_a_tag() {
        let names: Vec<String> = [
            "Microsoft English (UK) Handwriting Recognizer",
            "Microsoft English (US) Handwriting Recognizer",
            "Microsoft German Handwriting Recognizer",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(pick_recognizer(&names, "en-US"), Some(1));
        assert_eq!(pick_recognizer(&names, "en-GB"), Some(0));
        assert_eq!(pick_recognizer(&names, "de-DE"), Some(2));
        assert_eq!(pick_recognizer(&names, "fr-FR"), None);
    }

    #[cfg(windows)]
    #[test]
    fn lists_installed_recognizers() {
        let names = recognizers_blocking().expect("recognizers can be listed");
        println!("installed recognizers: {names:?}");
    }

    #[cfg(windows)]
    #[test]
    fn recognises_drawn_letters_or_says_none_is_installed() {
        // An "L" about 60 points tall, and a "T".
        let l = vec![vec![[10.0, 10.0], [10.0, 40.0], [10.0, 70.0]], vec![[10.0, 70.0], [30.0, 70.0], [45.0, 70.0]]];
        let t = vec![vec![[80.0, 10.0], [100.0, 10.0], [120.0, 10.0]], vec![[100.0, 10.0], [100.0, 40.0], [100.0, 70.0]]];
        for strokes in [l, t] {
            match recognize_blocking(strokes, Some("en-US".into())) {
                Ok(result) => {
                    println!("recognised: {result:?}");
                    assert!(!result.text.is_empty(), "a recognizer is installed, so some text should come back");
                }
                Err(message) => {
                    println!("recognition: {message}");
                    assert!(message.contains("not installed"), "{message}");
                }
            }
        }
        // No strokes is not an error where a recognizer exists.
        if let Ok(empty) = recognize_blocking(vec![], None) {
            assert_eq!(empty, InkText::default());
        }
    }
}
