//! `ponder` command line: turns commands into `ponder://` links and opens them
//! and lists spaces from the database read-only. Runs from the app binary before any window exists.
use crate::error::{invalid, AppResult};
use crate::paths;
use std::io::Write;
use std::path::Path;

pub const SUBCOMMANDS: [&str; 5] = ["open", "ask", "import", "spaces", "help"];

#[derive(Debug, PartialEq)]
pub enum Command {
    Open {
        space: String,
    },
    Ask {
        question: String,
        space: Option<String>,
    },
    Import {
        target: String,
        space: Option<String>,
    },
    Spaces,
    Help,
}

#[derive(Debug, PartialEq)]
pub struct Cli {
    pub command: Command,
    pub db: Option<String>,
    /// print the link instead of opening it
    pub print: bool,
}

pub const USAGE: &str = "Usage:
  ponder open <space>                     open a space
  ponder ask \"<question>\" [--space <s>]   open a space with the question in the composer
  ponder import <url|file> [--space <s>]  open the import dialog for a link or file
  ponder spaces                           list spaces

<space> is a space id or its name. Options: --db <path> (database), --print (print the link, don't open it).";

/// True when the first argument is a command rather than something the GUI launcher passes.
pub fn is_cli_invocation(args: &[String]) -> bool {
    args.get(1)
        .is_some_and(|a| SUBCOMMANDS.contains(&a.as_str()) || a == "--help" || a == "-h")
}

pub fn parse(args: &[String]) -> AppResult<Cli> {
    let mut positional: Vec<String> = vec![];
    let (mut space, mut db, mut print) = (None, None, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--space" | "-s" => {
                space = Some(
                    it.next()
                        .ok_or_else(|| invalid("--space needs a value"))?
                        .clone(),
                )
            }
            "--db" => {
                db = Some(
                    it.next()
                        .ok_or_else(|| invalid("--db needs a path"))?
                        .clone(),
                )
            }
            "--print" => print = true,
            "--help" | "-h" => positional.insert(0, "help".into()),
            _ => positional.push(a.clone()),
        }
    }
    let mut pos = positional.into_iter();
    let name = pos.next().unwrap_or_else(|| "help".into());
    let rest: Vec<String> = pos.collect();
    let one = |what: &str| -> AppResult<String> {
        match rest.as_slice() {
            [x] if !x.trim().is_empty() => Ok(x.clone()),
            _ => Err(invalid(format!("ponder {name} needs {what}.\n\n{USAGE}"))),
        }
    };
    let command = match name.as_str() {
        "open" => Command::Open {
            space: one("a space")?,
        },
        "ask" => Command::Ask {
            question: rest.join(" ").trim().to_string(),
            space,
        },
        "import" => Command::Import {
            target: one("a URL or file")?,
            space,
        },
        "spaces" => Command::Spaces,
        "help" => Command::Help,
        other => return Err(invalid(format!("Unknown command “{other}”.\n\n{USAGE}"))),
    };
    if let Command::Ask { question, .. } = &command {
        if question.is_empty() {
            return Err(invalid(format!("ponder ask needs a question.\n\n{USAGE}")));
        }
    }
    Ok(Cli { command, db, print })
}

fn link(base: &str, params: &[(&str, &str)]) -> String {
    let mut u = url::Url::parse(base).expect("static base");
    if !params.is_empty() {
        u.query_pairs_mut().extend_pairs(params);
    }
    u.to_string()
}

/// The `ponder://` link for a command. `resolve` maps a space id or name to an id.
pub fn to_link(cmd: &Command, resolve: &dyn Fn(&str) -> AppResult<String>) -> AppResult<String> {
    match cmd {
        Command::Open { space } => Ok(format!("ponder://space/{}", resolve(space)?)),
        Command::Ask { question, space } => {
            let mut p = vec![("q", question.as_str())];
            let id = space.as_deref().map(resolve).transpose()?;
            if let Some(id) = &id {
                p.push(("space", id));
            }
            Ok(link("ponder://ask", &p))
        }
        Command::Import { target, space } => {
            let t = target.trim();
            let value = if t.starts_with("http://") || t.starts_with("https://") {
                t.to_string()
            } else {
                let path = Path::new(t).canonicalize().map_err(|_| {
                    invalid(format!("“{t}” is neither a web link nor an existing file."))
                })?;
                url::Url::from_file_path(&path)
                    .map_err(|_| invalid("Can't turn that path into a link."))?
                    .to_string()
            };
            let mut p = vec![("url", value.as_str())];
            let id = space.as_deref().map(resolve).transpose()?;
            if let Some(id) = &id {
                p.push(("space", id));
            }
            Ok(link("ponder://import", &p))
        }
        _ => Err(invalid("This command doesn't open a link.")),
    }
}

pub fn open_url(url: &str) -> std::io::Result<()> {
    let (prog, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else if cfg!(windows) {
        ("rundll32", vec!["url.dll,FileProtocolHandler", url])
    } else {
        ("xdg-open", vec![url])
    };
    let status = std::process::Command::new(prog).args(args).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "{prog} exited with {status}. Is Ponder installed and registered for ponder:// links?"
        )))
    }
}

pub fn run_with(
    args: &[String],
    out: &mut dyn Write,
    opener: &dyn Fn(&str) -> std::io::Result<()>,
) -> AppResult<()> {
    let cli = parse(args)?;
    let resolve_with_db = |key: &str| -> AppResult<String> {
        let path = paths::resolve_db(cli.db.as_deref())?;
        paths::resolve_space(&paths::open_readonly(&path)?, key)
    };
    match &cli.command {
        Command::Help => writeln!(out, "{USAGE}")?,
        Command::Spaces => {
            let conn = paths::open_readonly(&paths::resolve_db(cli.db.as_deref())?)?;
            let spaces = paths::list_spaces(&conn)?;
            if spaces.is_empty() {
                writeln!(out, "No spaces yet.")?;
            }
            for s in spaces {
                writeln!(
                    out,
                    "{}\t{}\t{} source{}",
                    s.id,
                    s.name,
                    s.source_count,
                    if s.source_count == 1 { "" } else { "s" }
                )?;
            }
        }
        cmd => {
            let url = to_link(cmd, &resolve_with_db)?;
            if cli.print {
                writeln!(out, "{url}")?;
            } else {
                opener(&url)?;
            }
        }
    }
    Ok(())
}

/// Entry point for `main`: `args` includes the program name. Returns the exit code.
pub fn run(args: Vec<String>) -> i32 {
    let mut out = std::io::stdout();
    match run_with(&args[1..], &mut out, &open_url) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("ponder: {e}");
            1
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsInfo {
    pub exe_path: String,
    pub db_path: String,
}

/// Real paths for the command line and MCP snippets shown in Settings.
#[tauri::command]
pub async fn integrations_info(
    state: tauri::State<'_, crate::AppState>,
) -> AppResult<IntegrationsInfo> {
    let exe = std::env::current_exe()?;
    Ok(IntegrationsInfo {
        exe_path: exe.to_string_lossy().into_owned(),
        db_path: state.db.path().to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_commands_and_flags() {
        assert_eq!(
            parse(&a(&["open", "Biology"])).unwrap().command,
            Command::Open {
                space: "Biology".into()
            }
        );
        let c = parse(&a(&[
            "ask", "what", "is", "ATP?", "--space", "bio", "--print",
        ]))
        .unwrap();
        assert_eq!(
            c.command,
            Command::Ask {
                question: "what is ATP?".into(),
                space: Some("bio".into())
            }
        );
        assert!(c.print);
        assert_eq!(parse(&a(&["--help"])).unwrap().command, Command::Help);
        assert_eq!(
            parse(&a(&["spaces", "--db", "/x.db"]))
                .unwrap()
                .db
                .as_deref(),
            Some("/x.db")
        );
        assert!(parse(&a(&["open"])).is_err());
        assert!(parse(&a(&["ask"])).is_err());
        assert!(parse(&a(&["bogus"])).is_err());
        assert!(parse(&a(&["ask", "q", "--space"])).is_err());
    }

    #[test]
    fn detects_cli_invocations() {
        assert!(is_cli_invocation(&a(&["ponder", "spaces"])));
        assert!(!is_cli_invocation(&a(&["ponder"])));
        assert!(!is_cli_invocation(&a(&["ponder", "ponder://space/x"])));
    }

    #[test]
    fn builds_links() {
        let id = |k: &str| -> AppResult<String> { Ok(format!("id-{k}")) };
        let open = to_link(
            &Command::Open {
                space: "bio".into(),
            },
            &id,
        )
        .unwrap();
        assert_eq!(open, "ponder://space/id-bio");
        let ask = to_link(
            &Command::Ask {
                question: "why & how?".into(),
                space: Some("bio".into()),
            },
            &id,
        )
        .unwrap();
        assert_eq!(ask, "ponder://ask?q=why+%26+how%3F&space=id-bio");
        let ask = to_link(
            &Command::Ask {
                question: "hi".into(),
                space: None,
            },
            &id,
        )
        .unwrap();
        assert_eq!(ask, "ponder://ask?q=hi");
        let imp = to_link(
            &Command::Import {
                target: "https://example.com/a?b=1".into(),
                space: None,
            },
            &id,
        )
        .unwrap();
        assert_eq!(
            imp,
            "ponder://import?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1"
        );
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("my notes.pdf");
        std::fs::write(&f, b"x").unwrap();
        let imp = to_link(
            &Command::Import {
                target: f.to_string_lossy().into(),
                space: Some("s".into()),
            },
            &id,
        )
        .unwrap();
        assert!(
            imp.starts_with("ponder://import?url=file%3A%2F%2F%2F"),
            "{imp}"
        );
        assert!(
            imp.contains("my%2520notes.pdf") && imp.ends_with("&space=id-s"),
            "{imp}"
        );
        assert!(to_link(
            &Command::Import {
                target: "/no/such/file".into(),
                space: None
            },
            &id
        )
        .is_err());
    }

    fn seeded_db() -> (tempfile::TempDir, String) {
        let (db, dir) = crate::db::test_db();
        let c = db.conn().unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s1','Biology',1,5)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO spaces (id,name,created_at,updated_at) VALUES ('s2','Algebra',1,9)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO sources (id,space_id,title,kind,created_at,updated_at) VALUES ('a','s1','Cells','text',1,1)", []).unwrap();
        let p = db.path().to_string_lossy().into_owned();
        (dir, p)
    }

    #[test]
    fn runs_against_a_database_read_only() {
        let (_dir, db) = seeded_db();
        let opened = RefCell::new(vec![]);
        let opener = |u: &str| -> std::io::Result<()> {
            opened.borrow_mut().push(u.to_string());
            Ok(())
        };
        let mut out = vec![];
        run_with(&a(&["spaces", "--db", &db]), &mut out, &opener).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(text, "s2\tAlgebra\t0 sources\ns1\tBiology\t1 source\n");

        run_with(&a(&["open", "biology", "--db", &db]), &mut vec![], &opener).unwrap();
        run_with(
            &a(&["ask", "hello", "--space", "s2", "--db", &db]),
            &mut vec![],
            &opener,
        )
        .unwrap();
        assert_eq!(
            *opened.borrow(),
            vec![
                "ponder://space/s1".to_string(),
                "ponder://ask?q=hello&space=s2".to_string()
            ]
        );

        let mut out = vec![];
        run_with(
            &a(&["open", "s1", "--print", "--db", &db]),
            &mut out,
            &opener,
        )
        .unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "ponder://space/s1\n");
        assert_eq!(opened.borrow().len(), 2);

        let e = run_with(
            &a(&["open", "Chemistry", "--db", &db]),
            &mut vec![],
            &opener,
        )
        .unwrap_err()
        .to_string();
        assert!(e.contains("No space matches"), "{e}");
    }
}
