//! Pure folder scanning and "folder state → actions" reconciliation.
use crate::ingest::extract::kind_for_path;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    pub mtime: i64,
}

#[derive(Debug, Clone)]
pub struct Known {
    pub stamp: Stamp,
    pub source_id: Option<String>,
    pub removed: bool,
}

#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    pub import: Vec<(String, Stamp)>,
    pub reimport: Vec<(String, Stamp, String)>,
    pub removed: Vec<String>,
    pub restored: Vec<String>,
    /// changed files whose size/mtime differ from the previous scan: still being written
    pub pending: HashMap<String, Stamp>,
}

const TEMP_SUFFIXES: &[&str] = &[".tmp", ".temp", ".part", ".partial", ".crdownload", ".download", ".swp"];

/// Hidden files, Office lock files (`~$x.docx`, `.~lock.x#`), editor backups and partial downloads.
pub fn is_ignored(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || name.ends_with('~')
        || name.ends_with('#')
        || TEMP_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

/// Supported, non-ignored files below `root` keyed by `/`-separated relative path.
/// Errors only when `root` itself can't be read; unreadable subfolders are skipped.
pub fn scan_dir(root: &Path, recursive: bool) -> std::io::Result<BTreeMap<String, Stamp>> {
    let mut out = BTreeMap::new();
    if !std::fs::metadata(root)?.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "not a folder"));
    }
    walk(root, "", recursive, &mut out, true)?;
    Ok(out)
}

fn walk(dir: &Path, prefix: &str, recursive: bool, out: &mut BTreeMap<String, Stamp>, top: bool) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if top => return Err(e),
        Err(e) => {
            log::warn!("skipping unreadable folder {}: {e}", dir.display());
            return Ok(());
        }
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name) {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        if ft.is_dir() {
            if recursive {
                walk(&entry.path(), &rel, true, out, false)?;
            }
        } else if ft.is_file() && kind_for_path(Path::new(&name)).is_some() {
            let Ok(meta) = entry.metadata() else { continue };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.insert(rel, Stamp { size: meta.len(), mtime });
        }
    }
    Ok(())
}

/// A new or changed file is acted on only once two consecutive scans saw the same size and mtime,
/// so files that are still being copied or written wait in `pending`.
pub fn reconcile(
    known: &HashMap<String, Known>,
    scanned: &BTreeMap<String, Stamp>,
    prev: &HashMap<String, Stamp>,
) -> Plan {
    let mut plan = Plan::default();
    for (rel, st) in scanned {
        if st.size == 0 {
            continue;
        }
        let k = known.get(rel);
        if let Some(k) = k.filter(|k| k.stamp == *st) {
            if k.removed {
                plan.restored.push(rel.clone());
            }
            continue;
        }
        if prev.get(rel) != Some(st) {
            plan.pending.insert(rel.clone(), *st);
            continue;
        }
        match k.and_then(|k| k.source_id.clone()) {
            Some(id) => plan.reimport.push((rel.clone(), *st, id)),
            None => plan.import.push((rel.clone(), *st)),
        }
    }
    let mut removed: Vec<String> =
        known.iter().filter(|(rel, k)| !k.removed && !scanned.contains_key(*rel)).map(|(r, _)| r.clone()).collect();
    removed.sort();
    plan.removed = removed;
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(size: u64, mtime: i64) -> Stamp {
        Stamp { size, mtime }
    }

    fn known(stamp: Stamp, source: Option<&str>, removed: bool) -> Known {
        Known { stamp, source_id: source.map(String::from), removed }
    }

    #[test]
    fn ignores_temp_and_hidden_files() {
        for n in [".DS_Store", ".~lock.notes.docx#", "~$report.docx", "draft.md~", "a.pdf.part", "x.crdownload", ".hidden.md"] {
            assert!(is_ignored(n), "{n}");
        }
        for n in ["notes.md", "Report 2024.pdf", "a~b.txt"] {
            assert!(!is_ignored(n), "{n}");
        }
    }

    #[test]
    fn new_files_wait_for_a_stable_stamp() {
        let scanned = BTreeMap::from([("a.md".to_string(), st(10, 1))]);
        let p = reconcile(&HashMap::new(), &scanned, &HashMap::new());
        assert!(p.import.is_empty());
        assert_eq!(p.pending.get("a.md"), Some(&st(10, 1)));

        // still growing
        let grown = BTreeMap::from([("a.md".to_string(), st(20, 2))]);
        let p = reconcile(&HashMap::new(), &grown, &p.pending);
        assert!(p.import.is_empty());
        assert_eq!(p.pending.get("a.md"), Some(&st(20, 2)));

        let p = reconcile(&HashMap::new(), &grown, &p.pending);
        assert_eq!(p.import, vec![("a.md".to_string(), st(20, 2))]);
        assert!(p.pending.is_empty());
    }

    #[test]
    fn known_files_are_reimported_only_when_changed() {
        let k = HashMap::from([("a.md".to_string(), known(st(10, 1), Some("s1"), false))]);
        let same = BTreeMap::from([("a.md".to_string(), st(10, 1))]);
        assert_eq!(reconcile(&k, &same, &HashMap::new()), Plan::default());

        let changed = BTreeMap::from([("a.md".to_string(), st(12, 5))]);
        let prev = HashMap::from([("a.md".to_string(), st(12, 5))]);
        let p = reconcile(&k, &changed, &prev);
        assert_eq!(p.reimport, vec![("a.md".to_string(), st(12, 5), "s1".to_string())]);

        // the user deleted the source: a later change imports it again
        let k = HashMap::from([("a.md".to_string(), known(st(10, 1), None, false))]);
        assert!(reconcile(&k, &same, &HashMap::new()).import.is_empty());
        assert_eq!(reconcile(&k, &changed, &prev).import.len(), 1);
    }

    #[test]
    fn deleted_and_restored_files_and_empty_files() {
        let k = HashMap::from([
            ("gone.md".to_string(), known(st(10, 1), Some("s1"), false)),
            ("back.md".to_string(), known(st(5, 1), Some("s2"), true)),
            ("still-gone.md".to_string(), known(st(5, 1), Some("s3"), true)),
        ]);
        let scanned = BTreeMap::from([("back.md".to_string(), st(5, 1)), ("empty.txt".to_string(), st(0, 9))]);
        let p = reconcile(&k, &scanned, &HashMap::new());
        assert_eq!(p.removed, vec!["gone.md".to_string()]);
        assert_eq!(p.restored, vec!["back.md".to_string()]);
        assert!(p.pending.is_empty() && p.import.is_empty());
    }

    #[test]
    fn scan_dir_filters_and_recurses() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        std::fs::write(r.join("a.md"), "x").unwrap();
        std::fs::write(r.join("b.TXT"), "x").unwrap();
        std::fs::write(r.join("c.xyz"), "x").unwrap();
        std::fs::write(r.join(".DS_Store"), "x").unwrap();
        std::fs::write(r.join("~$d.docx"), "x").unwrap();
        std::fs::create_dir_all(r.join("sub/deeper")).unwrap();
        std::fs::write(r.join("sub/deeper/e.pdf"), "x").unwrap();
        std::fs::create_dir_all(r.join(".git")).unwrap();
        std::fs::write(r.join(".git/f.md"), "x").unwrap();

        let all: Vec<String> = scan_dir(r, true).unwrap().into_keys().collect();
        assert_eq!(all, vec!["a.md", "b.TXT", "sub/deeper/e.pdf"]);
        let top: Vec<String> = scan_dir(r, false).unwrap().into_keys().collect();
        assert_eq!(top, vec!["a.md", "b.TXT"]);
        assert!(scan_dir(&r.join("missing"), true).is_err());
        assert!(scan_dir(&r.join("a.md"), true).is_err());
    }
}
