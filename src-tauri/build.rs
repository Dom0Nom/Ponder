use std::path::PathBuf;

/// Lists the message files in `../src/locales` so `i18n.rs` can embed whichever languages exist.
fn embed_locales() {
    let dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../src/locales");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .filter_map(|p| {
                    let code = p.file_stem()?.to_str()?.to_string();
                    Some((code, p.canonicalize().ok()?))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    let mut out = String::from("pub const FILES: &[(&str, &str)] = &[\n");
    for (code, path) in &files {
        out.push_str(&format!(
            "    ({code:?}, include_str!({:?})),\n",
            path.display().to_string()
        ));
    }
    out.push_str("];\n");
    let dest = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("locales.rs");
    std::fs::write(dest, out).unwrap();
}

fn main() {
    embed_locales();
    tauri_build::build()
}
