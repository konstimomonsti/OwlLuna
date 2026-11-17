//! `GetHierarchy` XML into notebooks, section groups, sections and pages.

use super::model::*;
use roxmltree::{Document, Node};

fn attr(node: &Node, name: &str) -> Option<String> {
    node.attribute(name).map(str::to_string)
}

fn flag(node: &Node, name: &str) -> bool {
    node.attribute(name).is_some_and(|v| v.eq_ignore_ascii_case("true"))
}

/// OneNote writes "none" or "automatic" where a section has no colour of its own.
fn colour(node: &Node) -> Option<String> {
    node.attribute("color").filter(|c| c.starts_with('#')).map(str::to_string)
}

fn page(node: &Node) -> PageRef {
    PageRef {
        id: attr(node, "ID").unwrap_or_default(),
        name: attr(node, "name").unwrap_or_default(),
        date_time: attr(node, "dateTime"),
        last_modified: attr(node, "lastModifiedTime"),
        level: node.attribute("pageLevel").and_then(|v| v.parse().ok()).unwrap_or(1).clamp(1, 9),
        is_unread: flag(node, "isUnread"),
        is_in_recycle_bin: flag(node, "isInRecycleBin"),
    }
}

fn section(node: &Node) -> Section {
    Section {
        id: attr(node, "ID").unwrap_or_default(),
        name: attr(node, "name").unwrap_or_default(),
        color: colour(node),
        path: attr(node, "path"),
        last_modified: attr(node, "lastModifiedTime"),
        locked: flag(node, "locked"),
        encrypted: flag(node, "encrypted"),
        read_only: flag(node, "readOnly"),
        is_in_recycle_bin: flag(node, "isInRecycleBin"),
        is_deleted_pages: flag(node, "isDeletedPages"),
        pages: node.children().filter(|c| c.has_tag_name("Page")).map(|c| page(&c)).collect(),
    }
}

fn group(node: &Node) -> SectionGroup {
    let (groups, sections) = children(node);
    SectionGroup {
        id: attr(node, "ID").unwrap_or_default(),
        name: attr(node, "name").unwrap_or_default(),
        color: colour(node),
        last_modified: attr(node, "lastModifiedTime"),
        is_recycle_bin: flag(node, "isRecycleBin"),
        groups,
        sections,
    }
}

fn children(node: &Node) -> (Vec<SectionGroup>, Vec<Section>) {
    let mut groups = Vec::new();
    let mut sections = Vec::new();
    for child in node.children().filter(|c| c.is_element()) {
        match child.tag_name().name() {
            "SectionGroup" => groups.push(group(&child)),
            "Section" => sections.push(section(&child)),
            _ => {}
        }
    }
    (groups, sections)
}

pub fn parse_hierarchy(xml: &str) -> Result<Vec<Notebook>, String> {
    let document = Document::parse(xml).map_err(|e| format!("OneNote's notebook list could not be read: {e}"))?;
    let mut out = Vec::new();
    for node in document.root_element().children().filter(|c| c.has_tag_name("Notebook")) {
        let (groups, sections) = children(&node);
        out.push(Notebook {
            id: attr(&node, "ID").unwrap_or_default(),
            name: attr(&node, "name").unwrap_or_default(),
            nickname: attr(&node, "nickname"),
            path: attr(&node, "path"),
            color: colour(&node),
            last_modified: attr(&node, "lastModifiedTime"),
            groups,
            sections,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const FIXTURE: &str = r##"<?xml version="1.0"?>
<one:Notebooks xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote">
 <one:Notebook name="School" nickname="Schule" ID="{NB1}{1}{B0}" path="C:\Docs\OneNote Notebooks\School\" lastModifiedTime="2026-10-11T11:22:53.000Z" color="#9BBBD2">
  <one:Section name="Maths" ID="{S1}{1}{B0}" path="C:\Docs\OneNote Notebooks\School\Maths.one" lastModifiedTime="2026-10-11T11:22:53.000Z" color="#8AA8E4">
   <one:Page ID="{S1}{1}{E1}" name="Algebra" dateTime="2026-09-21T06:57:24.000Z" lastModifiedTime="2026-09-24T07:01:44.000Z" pageLevel="1"/>
   <one:Page ID="{S1}{1}{E2}" name="Sub" dateTime="2026-09-21T06:57:24.000Z" lastModifiedTime="2026-09-24T07:01:44.000Z" pageLevel="2" isUnread="true"/>
  </one:Section>
  <one:Section name="Secret" ID="{S2}{1}{B0}" path="C:\Docs\OneNote Notebooks\School\Secret.one" color="none" encrypted="true" locked="true"/>
  <one:SectionGroup name="Year 2" ID="{G1}{1}{B0}" path="C:\Docs\OneNote Notebooks\School\Year 2" lastModifiedTime="2026-10-08T08:52:19.000Z">
   <one:Section name="Physics" ID="{S3}{1}{B0}" path="x" color="automatic">
    <one:Page ID="{S3}{1}{E3}" name="Optics" pageLevel="1"/>
   </one:Section>
   <one:SectionGroup name="Deep" ID="{G2}{1}{B0}" path="y"><one:Section name="Chem" ID="{S4}{1}{B0}" path="z"/></one:SectionGroup>
  </one:SectionGroup>
  <one:SectionGroup name="OneNote_RecycleBin" ID="{G3}{1}{B0}" path="r" isRecycleBin="true">
   <one:Section name="Deleted Pages" ID="{S5}{1}{B0}" path="r1" isInRecycleBin="true" isDeletedPages="true">
    <one:Page ID="{S5}{1}{E4}" name="Gone" pageLevel="1" isInRecycleBin="true"/>
   </one:Section>
  </one:SectionGroup>
 </one:Notebook>
 <one:Notebook name="Empty" ID="{NB2}{1}{B0}" path="e"/>
</one:Notebooks>"##;

    #[test]
    fn reads_notebooks_groups_sections_and_pages() {
        let books = parse_hierarchy(FIXTURE).unwrap();
        assert_eq!(books.len(), 2);
        let school = &books[0];
        assert_eq!(school.name, "School");
        assert_eq!(school.nickname.as_deref(), Some("Schule"));
        assert_eq!(school.color.as_deref(), Some("#9BBBD2"));
        assert_eq!(school.sections.len(), 2);
        assert_eq!(school.sections[0].pages.len(), 2);
        assert_eq!(school.sections[0].pages[1].level, 2);
        assert!(school.sections[0].pages[1].is_unread);
        assert_eq!(school.sections[0].color.as_deref(), Some("#8AA8E4"));
        assert_eq!(school.groups.len(), 2);
        assert_eq!(school.groups[0].sections[0].name, "Physics");
        assert_eq!(school.groups[0].sections[0].color, None);
        assert_eq!(school.groups[0].groups[0].sections[0].name, "Chem");
        assert!(books[1].sections.is_empty());
    }

    #[test]
    fn marks_locked_sections_and_the_recycle_bin() {
        let books = parse_hierarchy(FIXTURE).unwrap();
        let secret = &books[0].sections[1];
        assert!(secret.locked && secret.encrypted);
        assert_eq!(secret.color, None);
        let bin = &books[0].groups[1];
        assert!(bin.is_recycle_bin);
        assert!(bin.sections[0].is_in_recycle_bin && bin.sections[0].is_deleted_pages);
        assert!(bin.sections[0].pages[0].is_in_recycle_bin);
    }

    #[test]
    fn bad_xml_is_an_error_not_a_panic() {
        assert!(parse_hierarchy("<one:Notebooks").is_err());
        assert!(parse_hierarchy("").is_err());
    }
}
