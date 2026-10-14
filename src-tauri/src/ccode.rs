//! Runs C snippets from chat answers with the system compiler in a temp dir.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

const COMPILE_LIMIT: Duration = Duration::from_secs(5);
const RUN_LIMIT: Duration = Duration::from_secs(5);
const OUTPUT_CAP: usize = 64 * 1024;
#[cfg(unix)]
const MEMORY_LIMIT: u64 = 512 * 1024 * 1024;
const MAX_SOURCE: usize = 256 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct CDiagnostic {
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CRun {
    pub ok: bool,
    /// "compile", "run" or "none" (no compiler found)
    pub stage: String,
    pub output: String,
    pub diagnostics: Vec<CDiagnostic>,
    pub compiler: Option<String>,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
    pub compile_ms: u64,
    pub run_ms: u64,
}

impl CRun {
    fn empty(stage: &str) -> Self {
        CRun {
            ok: false,
            stage: stage.into(),
            output: String::new(),
            diagnostics: vec![],
            compiler: None,
            exit_code: None,
            timed_out: false,
            truncated: false,
            compile_ms: 0,
            run_ms: 0,
        }
    }
}

fn on_path(name: &str) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ""] } else { &[""] };
    std::env::split_paths(&std::env::var_os("PATH")?).find_map(|d| {
        exts.iter().map(|e| d.join(format!("{name}{e}"))).find(|p| p.is_file())
    })
}

/// The first of cc/clang/gcc that is on PATH and actually runs (the macOS /usr/bin shims fail without the Xcode tools).
async fn find_compiler() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["gcc", "clang", "cc"] } else { &["cc", "clang", "gcc"] };
    for n in names {
        if let Some(p) = on_path(n) {
            let ok = tokio::time::timeout(
                Duration::from_secs(5),
                Command::new(&p).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status(),
            )
            .await;
            if matches!(ok, Ok(Ok(s)) if s.success()) {
                return Some(p);
            }
        }
    }
    None
}

pub fn parse_diagnostics(stderr: &str, file: &str) -> Vec<CDiagnostic> {
    let mut out = vec![];
    for l in stderr.lines() {
        let Some(pos) = l.find(file) else { continue };
        let rest = l[pos + file.len()..].strip_prefix(':').unwrap_or("");
        let mut it = rest.splitn(4, ':');
        let (Some(a), Some(b), Some(c), Some(d)) = (it.next(), it.next(), it.next(), it.next()) else {
            continue;
        };
        let (Ok(line), Ok(col)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) else {
            continue;
        };
        let sev = c.trim();
        if !matches!(sev, "error" | "warning" | "note" | "fatal error") {
            continue;
        }
        out.push(CDiagnostic { line, column: col, severity: sev.replace("fatal ", ""), message: d.trim().to_string() });
    }
    out
}

fn compiler_name(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

#[cfg(unix)]
fn limit(cmd: &mut Command, cpu_secs: u64) {
    unsafe {
        cmd.pre_exec(move || {
            let set = |res, v: u64| {
                let l = libc::rlimit { rlim_cur: v as _, rlim_max: v as _ };
                libc::setrlimit(res, &l);
            };
            // best effort: macOS ignores RLIMIT_AS, so the data segment limit is set as well
            set(libc::RLIMIT_CPU as _, cpu_secs);
            set(libc::RLIMIT_AS as _, MEMORY_LIMIT);
            set(libc::RLIMIT_DATA as _, MEMORY_LIMIT);
            set(libc::RLIMIT_CORE as _, 0);
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn limit(_cmd: &mut Command, _cpu_secs: u64) {}

async fn drain<R: tokio::io::AsyncRead + Unpin>(mut r: R, cap: usize) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut over = false;
    loop {
        match r.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if buf.len() < cap {
                    let take = n.min(cap - buf.len());
                    buf.extend_from_slice(&chunk[..take]);
                    over |= take < n;
                } else {
                    over = true;
                }
            }
        }
    }
    (buf, over)
}

pub async fn run(code: &str, stdin: &str) -> AppResult<CRun> {
    if code.len() > MAX_SOURCE {
        return Err(AppError::Invalid("The code is too long to run".into()));
    }
    let Some(cc) = find_compiler().await else {
        return Ok(CRun::empty("none"));
    };
    let dir = tempfile::Builder::new().prefix("ponder-c-").tempdir()?;
    let exe = dir.path().join(if cfg!(windows) { "main.exe" } else { "main" });
    std::fs::write(dir.path().join("main.c"), code)?;

    let mut res = CRun::empty("compile");
    res.compiler = Some(compiler_name(&cc));
    let t0 = Instant::now();
    let mut cmd = Command::new(&cc);
    cmd.current_dir(dir.path())
        .args(["main.c", "-o"])
        .arg(&exe)
        .args(["-std=gnu11", "-Wall", "-fno-color-diagnostics"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cfg!(windows) {
        cmd.arg("-lm");
    }
    limit(&mut cmd, 5);
    let child = cmd.spawn()?;
    let out = match tokio::time::timeout(COMPILE_LIMIT, child.wait_with_output()).await {
        Ok(o) => o?,
        Err(_) => {
            res.timed_out = true;
            res.compile_ms = t0.elapsed().as_millis() as u64;
            res.output = "The compiler took too long.".into();
            return Ok(res);
        }
    };
    res.compile_ms = t0.elapsed().as_millis() as u64;
    let errs = String::from_utf8_lossy(&out.stderr).to_string();
    res.diagnostics = parse_diagnostics(&errs, "main.c");
    if !out.status.success() {
        res.output = errs.chars().take(8000).collect();
        return Ok(res);
    }

    res.stage = "run".into();
    let t1 = Instant::now();
    let mut cmd = Command::new(&exe);
    cmd.current_dir(dir.path()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    limit(&mut cmd, 5);
    let mut child = cmd.spawn()?;
    if let Some(mut si) = child.stdin.take() {
        let data = stdin.as_bytes().to_vec();
        tokio::spawn(async move {
            let _ = si.write_all(&data).await;
        });
    }
    let so = drain(child.stdout.take().unwrap(), OUTPUT_CAP);
    let se = drain(child.stderr.take().unwrap(), OUTPUT_CAP);
    let waited = tokio::time::timeout(RUN_LIMIT, async {
        let ((o, oo), (e, eo)) = tokio::join!(so, se);
        let st = child.wait().await;
        (o, e, oo || eo, st)
    })
    .await;
    res.run_ms = t1.elapsed().as_millis() as u64;
    match waited {
        Ok((mut o, e, over, st)) => {
            o.extend_from_slice(&e);
            res.truncated = over || o.len() > OUTPUT_CAP;
            o.truncate(OUTPUT_CAP);
            res.output = String::from_utf8_lossy(&o).to_string();
            let st = st?;
            res.exit_code = st.code();
            res.ok = st.success();
        }
        Err(_) => {
            res.timed_out = true;
        }
    }
    Ok(res)
}

#[tauri::command]
pub async fn run_c(code: String, stdin: Option<String>) -> AppResult<CRun> {
    run(&code, &stdin.unwrap_or_default()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn have_cc() -> bool {
        find_compiler().await.is_some()
    }

    #[tokio::test]
    async fn hello_world() {
        if !have_cc().await {
            return;
        }
        let r = run("#include <stdio.h>\nint main(void){puts(\"hi\");return 0;}", "").await.unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(r.output.trim(), "hi");
        assert_eq!(r.stage, "run");
    }

    #[tokio::test]
    async fn compile_error_has_line() {
        if !have_cc().await {
            return;
        }
        let r = run("#include <stdio.h>\nint main(void){\n  int x = ;\n  return 0;\n}", "").await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.stage, "compile");
        assert!(r.diagnostics.iter().any(|d| d.line == 3 && d.severity == "error"), "{r:?}");
    }

    #[tokio::test]
    async fn infinite_loop_times_out() {
        if !have_cc().await {
            return;
        }
        let r = run("int main(void){for(;;){}}", "").await.unwrap();
        assert!(r.timed_out);
        assert!(!r.ok);
    }

    #[tokio::test]
    async fn reads_stdin() {
        if !have_cc().await {
            return;
        }
        let code = "#include <stdio.h>\nint main(void){int a,b;scanf(\"%d %d\",&a,&b);printf(\"%d\\n\",a+b);return 0;}";
        let r = run(code, "2 40\n").await.unwrap();
        assert_eq!(r.output.trim(), "42");
    }

    #[tokio::test]
    async fn output_is_capped() {
        if !have_cc().await {
            return;
        }
        let code = "#include <stdio.h>\nint main(void){for(int i=0;i<200000;i++)puts(\"0123456789\");return 0;}";
        let r = run(code, "").await.unwrap();
        assert!(r.truncated);
        assert!(r.output.len() <= OUTPUT_CAP);
    }

    #[test]
    fn parses_gcc_and_clang_lines() {
        let d = parse_diagnostics("main.c:3:11: error: expected expression\n  int x = ;\n", "main.c");
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].line, d[0].column), (3, 11));
        let d = parse_diagnostics("/tmp/x/main.c:7:5: warning: unused variable 'y' [-Wunused-variable]", "main.c");
        assert_eq!(d[0].severity, "warning");
    }
}
