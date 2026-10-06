//! Text extraction for PDF, DOCX, EPUB, Markdown and plain text.

use super::chunk::bytes_to_utf16;
use quick_xml::events::Event;
use quick_xml::Reader;
use scraper::{ElementRef, Html, Node};
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct Extracted {
    pub text: String,
    /// (page, utf16 start offset), ascending
    pub pages: Option<Vec<(i64, i64)>>,
}

/// Errors carry a human-readable reason shown on the source.
pub type ExtractResult<T> = Result<T, String>;

pub fn kind_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        "docx" => "docx",
        "md" | "markdown" => "markdown",
        "txt" => "text",
        _ => return None,
    })
}

pub fn extract_file(path: &Path, kind: &str) -> ExtractResult<Extracted> {
    let bytes = std::fs::read(path).map_err(|e| format!("Couldn't read the file: {e}"))?;
    let res = catch_unwind(AssertUnwindSafe(|| extract_bytes(&bytes, kind)));
    let out = match res {
        Ok(r) => r?,
        Err(_) => {
            return Err(format!(
                "Couldn't read this {}. The file may be damaged or use an unsupported format.",
                kind_label(kind)
            ))
        }
    };
    if out.text.trim().is_empty() {
        return Err(match kind {
            "pdf" => "This PDF has no extractable text. It may be a scanned image.".into(),
            _ => format!("No text found in this {}.", kind_label(kind)),
        });
    }
    Ok(out)
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "pdf" => "PDF",
        "epub" => "EPUB",
        "docx" => "Word document",
        _ => "file",
    }
}

pub fn extract_bytes(bytes: &[u8], kind: &str) -> ExtractResult<Extracted> {
    match kind {
        "pdf" => extract_pdf(bytes),
        "docx" => Ok(Extracted { text: extract_docx(bytes)?, pages: None }),
        "epub" => Ok(Extracted { text: extract_epub(bytes)?, pages: None }),
        _ => Ok(Extracted { text: normalize_newlines(&String::from_utf8_lossy(bytes)), pages: None }),
    }
}

pub fn normalize_newlines(s: &str) -> String {
    s.trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\0', "")
}

// ---------- PDF ----------

pub fn extract_pdf(bytes: &[u8]) -> ExtractResult<Extracted> {
    let mut doc = pdf_extract::Document::load_mem(bytes).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    if doc.is_encrypted() && doc.decrypt("").is_err() {
        return Err("This PDF is password-protected.".into());
    }
    let page_nums: Vec<u32> = doc.get_pages().keys().copied().collect();
    if page_nums.is_empty() {
        return Err("This PDF has no pages.".into());
    }
    let mut text = String::new();
    let mut byte_starts = Vec::with_capacity(page_nums.len());
    let mut failed = 0;
    for &n in &page_nums {
        let raw = catch_unwind(AssertUnwindSafe(|| {
            let mut s = String::new();
            let mut out = pdf_extract::PlainTextOutput::new(&mut s);
            pdf_extract::output_doc_page(&doc, &mut out, n).map(|_| s)
        }));
        let page = match raw {
            Ok(Ok(s)) => normalize_pdf_page(&s),
            _ => {
                failed += 1;
                String::new()
            }
        };
        if !page.is_empty() && !text.is_empty() {
            text.push_str("\n\n");
        }
        byte_starts.push(text.len());
        text.push_str(&page);
    }
    if failed == page_nums.len() {
        return Err("Couldn't read this PDF. The file may be damaged or use an unsupported format.".into());
    }
    let u16 = bytes_to_utf16(&text, &byte_starts);
    let pages = page_nums.iter().zip(u16).map(|(&n, o)| (n as i64, o as i64)).collect();
    Ok(Extracted { text, pages: Some(pages) })
}

/// Collapses runs of spaces, trims lines, joins obvious hyphenated line breaks and limits blank lines.
pub fn normalize_pdf_page(raw: &str) -> String {
    let raw = normalize_newlines(raw);
    let lines: Vec<String> = raw
        .split('\n')
        .map(|l| {
            let mut out = String::with_capacity(l.len());
            let mut space = false;
            for c in l.chars() {
                if c == ' ' || c == '\t' || c == '\u{a0}' {
                    space = true;
                } else if !c.is_control() {
                    if space && !out.is_empty() {
                        out.push(' ');
                    }
                    space = false;
                    out.push(c);
                }
            }
            out
        })
        .collect();
    let mut out = String::with_capacity(raw.len());
    let mut blank_run = 0;
    let mut i = 0;
    while i < lines.len() {
        let line = &lines[i];
        if line.is_empty() {
            blank_run += 1;
            i += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blank_run > 0 { "\n\n" } else { "\n" });
        }
        blank_run = 0;
        let mut cur = line.clone();
        while cur.ends_with('-') && i + 1 < lines.len() {
            let before = cur[..cur.len() - 1].chars().next_back();
            let next_first = lines[i + 1].chars().next();
            match (before, next_first) {
                (Some(b), Some(n)) if b.is_lowercase() && n.is_lowercase() => {
                    cur.pop();
                    cur.push_str(&lines[i + 1]);
                    i += 1;
                }
                _ => break,
            }
        }
        out.push_str(&cur);
        i += 1;
    }
    out
}

// ---------- DOCX ----------

fn zip_read(archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, name: &str) -> Option<String> {
    let mut f = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn docx_heading_level(style: &str) -> Option<usize> {
    let s = style.to_ascii_lowercase().replace(' ', "");
    if s == "title" {
        return Some(1);
    }
    for prefix in ["heading", "berschrift", "titre", "titulo", "kop"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            if let Ok(n) = rest.parse::<usize>() {
                if (1..=6).contains(&n) {
                    return Some(n);
                }
            }
        }
    }
    None
}

pub fn extract_docx(bytes: &[u8]) -> ExtractResult<String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Couldn't read this Word document: {e}"))?;
    let xml = zip_read(&mut archive, "word/document.xml")
        .ok_or("Couldn't read this Word document: word/document.xml is missing.")?;
    let mut reader = Reader::from_str(&xml);
    let mut paras: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut level: Option<usize> = None;
    let mut in_t = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"p" => {
                    cur.clear();
                    level = None;
                }
                b"t" => in_t = true,
                b"pStyle" => level = style_attr(&e).and_then(|v| docx_heading_level(&v)),
                b"tab" => cur.push('\t'),
                b"br" | b"cr" => cur.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"pStyle" => level = style_attr(&e).and_then(|v| docx_heading_level(&v)),
                b"tab" => cur.push('\t'),
                b"br" | b"cr" => cur.push('\n'),
                b"noBreakHyphen" => cur.push('-'),
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                cur.push_str(&t.unescape().map_err(|e| format!("Couldn't read this Word document: {e}"))?);
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"p" => {
                    let t = cur.trim();
                    if !t.is_empty() {
                        paras.push(match level {
                            Some(n) => format!("{} {}", "#".repeat(n), t.replace('\n', " ")),
                            None => t.to_string(),
                        });
                    }
                    cur.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Couldn't read this Word document: {e}")),
            _ => {}
        }
    }
    Ok(paras.join("\n\n"))
}

fn style_attr(e: &quick_xml::events::BytesStart) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == b"val")
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

// ---------- EPUB ----------

fn attr_of(e: &quick_xml::events::BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn resolve_path(base_dir: &str, href: &str) -> String {
    let href = percent_decode(href.split('#').next().unwrap_or(""));
    let mut parts: Vec<&str> = if base_dir.is_empty() { vec![] } else { base_dir.split('/').collect() };
    for seg in href.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

pub fn extract_epub(bytes: &[u8]) -> ExtractResult<String> {
    let err = |m: &str| format!("Couldn't read this EPUB: {m}");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| err(&e.to_string()))?;
    let container = zip_read(&mut archive, "META-INF/container.xml").ok_or_else(|| err("container.xml is missing"))?;
    let mut opf_path = None;
    let mut r = Reader::from_str(&container);
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"rootfile" => {
                opf_path = attr_of(&e, b"full-path");
                break;
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(err(&e.to_string())),
            _ => {}
        }
    }
    let opf_path = opf_path.ok_or_else(|| err("no rootfile in container.xml"))?;
    let opf = zip_read(&mut archive, &opf_path).ok_or_else(|| err("package file is missing"))?;
    let opf_dir = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");

    let mut manifest = std::collections::HashMap::new();
    let mut spine = Vec::new();
    let mut r = Reader::from_str(&opf);
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"item" => {
                    if let (Some(id), Some(href)) = (attr_of(&e, b"id"), attr_of(&e, b"href")) {
                        manifest.insert(id, href);
                    }
                }
                b"itemref" => {
                    if let Some(id) = attr_of(&e, b"idref") {
                        spine.push(id);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => return Err(err(&e.to_string())),
            _ => {}
        }
    }
    let mut parts = Vec::new();
    for id in spine {
        let Some(href) = manifest.get(&id) else { continue };
        let path = resolve_path(opf_dir, href);
        let Some(html) = zip_read(&mut archive, &path) else { continue };
        let t = html_to_text(&html);
        if !t.is_empty() {
            parts.push(t);
        }
    }
    if parts.is_empty() && zip_read(&mut archive, "META-INF/encryption.xml").is_some() {
        return Err("This EPUB is DRM-protected and can't be imported.".into());
    }
    Ok(parts.join("\n\n"))
}

struct HtmlText {
    paras: Vec<String>,
    cur: String,
    prefix: String,
}

impl HtmlText {
    fn flush(&mut self) {
        let t = self.cur.trim();
        if !t.is_empty() {
            let p = format!("{}{}", self.prefix, t.replace(" \n", "\n").replace("\n ", "\n"));
            self.paras.push(p);
        }
        self.cur.clear();
        self.prefix.clear();
    }
    fn push_text(&mut self, s: &str) {
        for c in s.chars() {
            if c.is_whitespace() {
                if !self.cur.is_empty() && !self.cur.ends_with([' ', '\n']) {
                    self.cur.push(' ');
                }
            } else {
                self.cur.push(c);
            }
        }
    }
}

const BLOCKS: &[&str] = &[
    "p", "div", "section", "article", "blockquote", "pre", "ul", "ol", "li", "table", "tr", "dl", "dt", "dd",
    "figure", "figcaption", "header", "footer", "aside", "nav", "hr", "body",
];

fn walk(el: ElementRef, out: &mut HtmlText) {
    let name = el.value().name();
    if matches!(name, "head" | "script" | "style" | "title") {
        return;
    }
    let heading = match name {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => Some(name[1..].parse::<usize>().unwrap_or(1)),
        _ => None,
    };
    let block = heading.is_some() || BLOCKS.contains(&name);
    if block {
        out.flush();
    }
    if let Some(n) = heading {
        out.prefix = format!("{} ", "#".repeat(n));
    } else if name == "li" {
        out.prefix = "- ".into();
    }
    for child in el.children() {
        match child.value() {
            Node::Text(t) => out.push_text(t),
            Node::Element(_) => {
                if let Some(c) = ElementRef::wrap(child) {
                    match c.value().name() {
                        "br" => {
                            let trimmed = out.cur.trim_end().len();
                            out.cur.truncate(trimmed);
                            out.cur.push('\n');
                        }
                        "td" | "th" => {
                            out.push_text(" ");
                            walk(c, out);
                            out.push_text(" ");
                        }
                        _ => walk(c, out),
                    }
                }
            }
            _ => {}
        }
    }
    if block {
        if heading.is_some() {
            let t = out.cur.replace('\n', " ");
            out.cur = t;
        }
        out.flush();
    }
}

pub fn html_to_text(html: &str) -> String {
    let doc = Html::parse_document(html);
    let mut out = HtmlText { paras: Vec::new(), cur: String::new(), prefix: String::new() };
    walk(doc.root_element(), &mut out);
    out.flush();
    out.paras.join("\n\n")
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    pub fn make_zip(files: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, content) in files {
                w.start_file(*name, SimpleFileOptions::default()).unwrap();
                w.write_all(content.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    pub fn sample_docx() -> Vec<u8> {
        let doc = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Plant Biology</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Photosynthesis</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Plants use </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>chlorophyll</w:t></w:r><w:r><w:tab/><w:t>to absorb light &amp; make sugar.</w:t></w:r></w:p>
    <w:p></w:p>
    <w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two — Grüße 🌱</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        make_zip(&[
            ("[Content_Types].xml", "<Types/>"),
            ("word/document.xml", doc),
        ])
    }

    #[test]
    fn docx_paragraphs_and_headings() {
        let text = extract_docx(&sample_docx()).unwrap();
        assert_eq!(
            text,
            "# Plant Biology\n\n## Photosynthesis\n\nPlants use chlorophyll\tto absorb light & make sugar.\n\nLine one\nLine two — Grüße 🌱"
        );
    }

    pub fn sample_epub() -> Vec<u8> {
        let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
        let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>"#;
        let ch1 = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored</title><style>p{}</style></head>
<body><h1>Chapter   One</h1><p>First   paragraph
 about <em>cells</em>.</p><p>Second<br/>line</p><ul><li>Item A</li><li>Item B</li></ul></body></html>"#;
        let ch2 = r#"<html><body><section><h2>Chapter Two</h2><div>Über Äpfel 🍎</div></section></body></html>"#;
        make_zip(&[
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", container),
            ("OEBPS/content.opf", opf),
            ("OEBPS/text/ch1.xhtml", ch1),
            ("OEBPS/text/ch 2.xhtml", ch2),
        ])
    }

    #[test]
    fn epub_spine_order_headings_paragraphs() {
        let text = extract_epub(&sample_epub()).unwrap();
        assert_eq!(
            text,
            "# Chapter One\n\nFirst paragraph about cells.\n\nSecond\nline\n\n- Item A\n\n- Item B\n\n## Chapter Two\n\nÜber Äpfel 🍎"
        );
    }

    #[test]
    fn bad_archives_give_readable_errors() {
        let e = extract_docx(b"not a zip").unwrap_err();
        assert!(e.starts_with("Couldn't read this Word document"), "{e}");
        let e = extract_epub(&make_zip(&[("x.txt", "x")])).unwrap_err();
        assert!(e.contains("container.xml"), "{e}");
    }

    pub fn sample_pdf() -> Vec<u8> {
        use pdf_extract::{dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let texts = [
            vec!["Photosynthesis happens in the chloro-", "plasts of plant cells."],
            vec![],
            vec!["Page three talks about taxes."],
        ];
        let mut kids = Vec::new();
        for lines in texts {
            let mut content = String::from("BT /F1 12 Tf 14 TL 72 720 Td ");
            for l in lines {
                content.push_str(&format!("({l}) Tj T* "));
            }
            content.push_str("ET");
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => content_id,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            });
            kids.push(Object::from(page_id));
        }
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => 3,
            "Resources" => resources_id,
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn pdf_pages_and_hyphen_join() {
        let ex = extract_pdf(&sample_pdf()).unwrap();
        assert!(ex.text.contains("chloroplasts of plant cells"), "{:?}", ex.text);
        let pages = ex.pages.unwrap();
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0], (1, 0));
        let p3 = ex.text.find("Page three").unwrap();
        let p3_u16 = bytes_to_utf16(&ex.text, &[p3])[0] as i64;
        assert_eq!(pages[2], (3, p3_u16));
        assert_eq!(super::super::chunk::page_at(&pages, p3_u16), Some(3));
    }

    #[test]
    fn garbage_pdf_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.pdf");
        std::fs::write(&p, b"%PDF-1.4 garbage").unwrap();
        assert!(extract_file(&p, "pdf").is_err());
        let missing = extract_file(&dir.path().join("nope.pdf"), "pdf").unwrap_err();
        assert!(missing.starts_with("Couldn't read the file"), "{missing}");
    }

    #[test]
    fn normalizes_pdf_whitespace() {
        let s = normalize_pdf_page("  Hello    world \r\n\n\n\nmulti-\nline  text\nEnd-\nGame");
        assert_eq!(s, "Hello world\n\nmultiline text\nEnd-\nGame");
    }

    #[test]
    fn kinds_from_extension() {
        assert_eq!(kind_for_path(Path::new("a/B.PDF")), Some("pdf"));
        assert_eq!(kind_for_path(Path::new("x.markdown")), Some("markdown"));
        assert_eq!(kind_for_path(Path::new("x.txt")), Some("text"));
        assert_eq!(kind_for_path(Path::new("x.xyz")), None);
        assert_eq!(kind_for_path(Path::new("noext")), None);
    }
}
