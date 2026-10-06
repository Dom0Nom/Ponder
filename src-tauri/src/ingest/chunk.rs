//! Paragraph-aware chunker. All offsets it returns are UTF-16 code unit indices into the text.

pub const TARGET_CHARS: usize = 1000;
pub const MAX_CHARS: usize = 1500;
pub const OVERLAP_CHARS: usize = 150;

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub text: String,
    pub start: i64,
    pub end: i64,
    pub page: Option<i64>,
    pub heading: Option<String>,
}

pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
/// Slice by UTF-16 code unit indices, the way JS `String.prototype.slice` does.
pub fn utf16_slice(s: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}

/// Converts ascending-or-not byte offsets (on char boundaries) to UTF-16 offsets in one pass.
pub fn bytes_to_utf16(s: &str, byte_offsets: &[usize]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..byte_offsets.len()).collect();
    order.sort_by_key(|&i| byte_offsets[i]);
    let mut out = vec![0; byte_offsets.len()];
    let mut chars = s.char_indices().peekable();
    let mut u16pos = 0;
    for i in order {
        let target = byte_offsets[i];
        while let Some(&(b, c)) = chars.peek() {
            if b >= target {
                break;
            }
            u16pos += c.len_utf16();
            chars.next();
        }
        out[i] = u16pos;
    }
    out
}

fn clen(text: &str, a: usize, b: usize) -> usize {
    text[a..b].chars().count()
}

#[derive(Debug, Clone, Copy)]
struct Block {
    start: usize,
    end: usize,
    heading: bool,
}

fn heading_level(line: &str) -> Option<usize> {
    let hashes = line.bytes().take_while(|&b| b == b'#').count();
    if (1..=6).contains(&hashes) && line[hashes..].starts_with([' ', '\t']) {
        Some(hashes)
    } else {
        None
    }
}

/// Paragraphs (separated by blank lines) with Markdown heading lines as their own blocks.
/// Ranges are trimmed byte ranges.
fn blocks(text: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut cur: Option<(usize, usize)> = None;
    let mut pos = 0;
    for line in text.split_inclusive('\n') {
        let line_start = pos;
        pos += line.len();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some((s, e)) = cur.take() {
                out.push(Block { start: s, end: e, heading: false });
            }
            continue;
        }
        let lead = line.len() - line.trim_start().len();
        let s = line_start + lead;
        let e = s + trimmed.len();
        if heading_level(trimmed).is_some() {
            if let Some((cs, ce)) = cur.take() {
                out.push(Block { start: cs, end: ce, heading: false });
            }
            out.push(Block { start: s, end: e, heading: true });
            continue;
        }
        cur = Some(match cur {
            Some((cs, _)) => (cs, e),
            None => (s, e),
        });
    }
    if let Some((s, e)) = cur {
        out.push(Block { start: s, end: e, heading: false });
    }
    out
}

/// Sentence ranges within [a, b), trimmed.
fn sentences(text: &str, a: usize, b: usize) -> Vec<(usize, usize)> {
    let slice = &text[a..b];
    let mut out = Vec::new();
    let mut start = 0;
    let mut iter = slice.char_indices().peekable();
    while let Some((_, c)) = iter.next() {
        if matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？') {
            if let Some(&(j, n)) = iter.peek() {
                if n.is_whitespace() {
                    push_trimmed(slice, start, j, a, &mut out);
                    start = j;
                }
            }
        }
    }
    push_trimmed(slice, start, slice.len(), a, &mut out);
    out
}

fn push_trimmed(slice: &str, s: usize, e: usize, base: usize, out: &mut Vec<(usize, usize)>) {
    let part = &slice[s..e];
    let t = part.trim();
    if !t.is_empty() {
        let lead = part.len() - part.trim_start().len();
        out.push((base + s + lead, base + s + lead + t.len()));
    }
}

/// Splits [a, b) into pieces of at most `max` chars, preferring whitespace.
fn hard_split(text: &str, a: usize, b: usize, max: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut s = a;
    while s < b {
        if clen(text, s, b) <= max {
            out.push((s, b));
            break;
        }
        let mut limit = s;
        for (n, (i, c)) in text[s..b].char_indices().enumerate() {
            if n == max {
                break;
            }
            limit = s + i + c.len_utf8();
        }
        let cut = text[s..limit]
            .char_indices()
            .rev()
            .find(|(_, c)| c.is_whitespace())
            .map(|(i, _)| s + i)
            .filter(|&i| i > s)
            .unwrap_or(limit);
        let piece = text[s..cut].trim_end();
        out.push((s, s + piece.len()));
        s = cut;
        while s < b && text[s..].starts_with(char::is_whitespace) {
            s += text[s..].chars().next().unwrap().len_utf8();
        }
    }
    out
}

/// Start position ~OVERLAP_CHARS before `pos`, snapped forward to a word start, never at or before `floor`.
fn overlap_start(text: &str, floor: usize, pos: usize) -> usize {
    let mut p = pos;
    for (n, (i, _)) in text[floor..pos].char_indices().rev().enumerate() {
        p = floor + i;
        if n + 1 >= OVERLAP_CHARS {
            break;
        }
    }
    if p <= floor {
        return pos;
    }
    // move to the start of the next word so chunks don't begin mid-word
    let prev_is_space = text[..p].chars().next_back().map(char::is_whitespace).unwrap_or(true);
    if !prev_is_space {
        if let Some(off) = text[p..pos].find(char::is_whitespace) {
            p += off;
        } else {
            return pos;
        }
    }
    while p < pos && text[p..].starts_with(char::is_whitespace) {
        p += text[p..].chars().next().unwrap().len_utf8();
    }
    if p >= pos {
        pos
    } else {
        p
    }
}

/// Splits one long paragraph into pieces ≤ TARGET (sentence-packed) with overlap between pieces.
fn split_long(text: &str, a: usize, b: usize) -> Vec<(usize, usize)> {
    let mut units = Vec::new();
    for (s, e) in sentences(text, a, b) {
        if clen(text, s, e) > MAX_CHARS {
            units.extend(hard_split(text, s, e, TARGET_CHARS));
        } else {
            units.push((s, e));
        }
    }
    let mut pieces: Vec<(usize, usize)> = Vec::new();
    let mut cur: Option<(usize, usize)> = None;
    for (s, e) in units {
        cur = match cur {
            None => Some((s, e)),
            Some((cs, ce)) => {
                if clen(text, cs, e) <= TARGET_CHARS {
                    Some((cs, e))
                } else {
                    pieces.push((cs, ce));
                    Some((s, e))
                }
            }
        };
    }
    if let Some(c) = cur {
        pieces.push(c);
    }
    for i in 1..pieces.len() {
        let floor = pieces[i - 1].0;
        let (s, e) = pieces[i];
        let ns = overlap_start(text, floor, s);
        if clen(text, ns, e) <= MAX_CHARS {
            pieces[i] = (ns, e);
        }
    }
    pieces
}

fn heading_text(text: &str, b: Block) -> String {
    let t = text[b.start..b.end].trim_start_matches('#').trim();
    t.chars().take(200).collect()
}

/// `pages`: ascending (page, utf16_start) pairs.
pub fn chunk_text(text: &str, pages: Option<&[(i64, i64)]>) -> Vec<Chunk> {
    let blocks = blocks(text);
    // (byte_start, byte_end, heading block index)
    let mut ranges: Vec<(usize, usize, Option<usize>)> = Vec::new();
    let mut cur: Option<(usize, usize, usize)> = None; // start, end, char len
    let mut last_heading: Option<usize> = None;
    let mut cur_heading: Option<usize> = None;

    let flush = |cur: &mut Option<(usize, usize, usize)>, h: Option<usize>, ranges: &mut Vec<(usize, usize, Option<usize>)>| {
        if let Some((s, e, _)) = cur.take() {
            ranges.push((s, e, h));
        }
    };

    for (bi, b) in blocks.iter().enumerate() {
        let blen = clen(text, b.start, b.end);
        if b.heading {
            if cur.map(|c| c.2 >= 200).unwrap_or(false) {
                flush(&mut cur, cur_heading, &mut ranges);
            }
            last_heading = Some(bi);
        }
        if blen > MAX_CHARS {
            flush(&mut cur, cur_heading, &mut ranges);
            let pieces = split_long(text, b.start, b.end);
            let n = pieces.len();
            for (i, (s, e)) in pieces.into_iter().enumerate() {
                if i + 1 == n {
                    cur = Some((s, e, clen(text, s, e)));
                    cur_heading = last_heading;
                } else {
                    ranges.push((s, e, last_heading));
                }
            }
            continue;
        }
        match cur {
            None => {
                cur = Some((b.start, b.end, blen));
                cur_heading = last_heading;
            }
            Some((s, e, len)) => {
                let new_len = len + clen(text, e, b.end);
                if new_len <= TARGET_CHARS {
                    cur = Some((s, b.end, new_len));
                } else {
                    flush(&mut cur, cur_heading, &mut ranges);
                    cur = Some((b.start, b.end, blen));
                    cur_heading = last_heading;
                }
            }
        }
    }
    flush(&mut cur, cur_heading, &mut ranges);

    let mut offs = Vec::with_capacity(ranges.len() * 2);
    for &(s, e, _) in &ranges {
        offs.push(s);
        offs.push(e);
    }
    let u16 = bytes_to_utf16(text, &offs);
    ranges
        .into_iter()
        .enumerate()
        .filter(|(_, (s, e, _))| !text[*s..*e].trim().is_empty())
        .map(|(i, (s, e, h))| {
            let start = u16[i * 2] as i64;
            Chunk {
                text: text[s..e].to_string(),
                start,
                end: u16[i * 2 + 1] as i64,
                page: pages.and_then(|p| page_at(p, start)),
                heading: h.map(|bi| heading_text(text, blocks[bi])).filter(|h| !h.is_empty()),
            }
        })
        .collect()
}

pub fn page_at(pages: &[(i64, i64)], offset: i64) -> Option<i64> {
    let idx = pages.partition_point(|&(_, o)| o <= offset);
    if idx == 0 {
        pages.first().map(|p| p.0)
    } else {
        Some(pages[idx - 1].0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_invariant(text: &str, chunks: &[Chunk]) {
        for c in chunks {
            assert_eq!(utf16_slice(text, c.start as usize, c.end as usize), c.text);
            assert!(!c.text.trim().is_empty());
            assert!(c.text.chars().count() <= MAX_CHARS, "chunk too long: {}", c.text.chars().count());
        }
    }

    #[test]
    fn utf16_helpers_with_umlauts_and_emoji() {
        let s = "Grüße 🙂 aus Köln";
        assert_eq!(utf16_len(s), s.encode_utf16().count());
        assert_eq!(utf16_len("🙂"), 2);
        let b = s.find("aus").unwrap();
        let u = bytes_to_utf16(s, &[b, 0, s.len()]);
        assert_eq!(u[1], 0);
        assert_eq!(u[0], 9); // G r ü ß e ␠ 🙂(2) ␠
        assert_eq!(u[2], utf16_len(s));
        assert_eq!(utf16_slice(s, u[0], u[2]), "aus Köln");
        assert_eq!(utf16_slice(s, 6, 8), "🙂");
    }

    #[test]
    fn small_paragraphs_pack_into_one_chunk() {
        let text = "Erste Zeile über Äpfel.\n\nZweiter Absatz 🍎 mit Emoji.\n\n\nDritter.";
        let chunks = chunk_text(text, None);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start, 0);
        assert_eq!(chunks[0].end as usize, utf16_len(text));
        check_invariant(text, &chunks);
    }

    #[test]
    fn splits_on_paragraphs_and_tracks_headings_and_pages() {
        let para = |w: &str| format!("{} ", w).repeat(100).trim().to_string(); // 500-800 chars
        let text = format!(
            "# Intro\n\n{}\n\n{}\n\n## Größe 😀\n{}\n\n{}\n\n{}\n\n### Ende\n\n{}",
            para("alpha"),
            para("beta"),
            para("gamma"),
            para("delta"),
            para("epsilon"),
            para("zeta")
        );
        let ps = text.find("delta").unwrap();
        let page2 = bytes_to_utf16(&text, &[ps])[0] as i64;
        let pages = vec![(1, 0), (2, page2)];
        let chunks = chunk_text(&text, Some(&pages));
        check_invariant(&text, &chunks);
        assert!(chunks.len() >= 3);
        assert_eq!(chunks[0].heading.as_deref(), Some("Intro"));
        assert_eq!(chunks[0].page, Some(1));
        let g = chunks.iter().find(|c| c.text.contains("gamma")).unwrap();
        assert_eq!(g.heading.as_deref(), Some("Größe 😀"));
        assert!(g.text.starts_with("## Größe"));
        let d = chunks.iter().find(|c| c.text.starts_with("delta")).unwrap();
        assert_eq!(d.page, Some(2));
        let z = chunks.iter().find(|c| c.text.contains("zeta")).unwrap();
        assert_eq!(z.heading.as_deref(), Some("Ende"));
        for w in chunks.windows(2) {
            assert!(w[0].end <= w[1].start, "no overlap across paragraph boundaries");
        }
    }

    #[test]
    fn long_paragraph_splits_on_sentences_with_overlap() {
        let mut text = String::from("Kurz.\n\n");
        for i in 0..80 {
            text.push_str(&format!("Satz Nummer {i} erklärt Photosynthese 🌱 ausführlich. "));
        }
        let text = text.trim_end().to_string();
        let chunks = chunk_text(&text, None);
        check_invariant(&text, &chunks);
        assert!(chunks.len() >= 3);
        for w in chunks.windows(2).skip(1) {
            assert!(w[1].start < w[0].end, "pieces inside a paragraph overlap");
            let overlap = w[0].end - w[1].start;
            assert!(overlap > 50 && overlap < 400, "overlap {overlap}");
        }
        for c in &chunks[1..] {
            assert!(!c.text.starts_with(char::is_whitespace));
        }
    }

    #[test]
    fn giant_word_without_spaces_is_hard_split() {
        let text = "x".repeat(5000);
        let chunks = chunk_text(&text, None);
        check_invariant(&text, &chunks);
        assert!(chunks.len() >= 4);
    }

    #[test]
    fn whitespace_only_text_yields_nothing() {
        assert!(chunk_text("  \n\n \t\n", None).is_empty());
        assert!(chunk_text("", None).is_empty());
    }

    #[test]
    fn page_lookup() {
        let pages = [(1, 0), (2, 100), (3, 100), (4, 250)];
        assert_eq!(page_at(&pages, 0), Some(1));
        assert_eq!(page_at(&pages, 99), Some(1));
        assert_eq!(page_at(&pages, 100), Some(3));
        assert_eq!(page_at(&pages, 1000), Some(4));
    }
}
