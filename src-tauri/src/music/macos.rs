//! Controls the Spotify desktop app through AppleScript.
use super::MusicBackend;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::process::Command;

pub struct SpotifyAppleScript;

fn osascript(script: &str) -> AppResult<String> {
    let out = Command::new("osascript").arg("-e").arg(script).output()?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(AppError::Other(explain(&String::from_utf8_lossy(&out.stderr))))
    }
}

fn explain(stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.contains("-1743") {
        "macOS blocked control of Spotify. Allow it in System Settings > Privacy & Security > Automation.".into()
    } else if msg.contains("-600") || msg.contains("-10810") {
        "Couldn't reach the Spotify app. Open Spotify once and try again.".into()
    } else {
        format!("Spotify didn't respond: {msg}")
    }
}

/// `uri` must come from `parse_playlist`, which only lets letters, digits and `:` through.
pub fn play_script(uri: &str) -> String {
    format!("tell application \"Spotify\" to play track \"{uri}\"")
}

pub const RESUME_SCRIPT: &str = "tell application \"Spotify\" to play";
pub const RUNNING_SCRIPT: &str = "application \"Spotify\" is running";
pub const PAUSE_SCRIPT: &str =
    "if application \"Spotify\" is running then\ntell application \"Spotify\" to pause\nend if";

fn installed() -> bool {
    let mut paths = vec![PathBuf::from("/Applications/Spotify.app")];
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join("Applications/Spotify.app"));
    }
    if paths.iter().any(|p| p.exists()) {
        return true;
    }
    Command::new("mdfind")
        .arg("kMDItemCFBundleIdentifier == 'com.spotify.client'")
        .output()
        .map(|o| !o.stdout.iter().all(|b| b.is_ascii_whitespace()))
        .unwrap_or(false)
}

impl MusicBackend for SpotifyAppleScript {
    fn name(&self) -> &'static str {
        "spotify-applescript"
    }
    fn available(&self) -> bool {
        installed()
    }
    fn running(&self) -> bool {
        osascript(RUNNING_SCRIPT).is_ok_and(|s| s == "true")
    }
    fn play_playlist(&self, uri: &str) -> AppResult<()> {
        osascript(&play_script(uri)).map(|_| ())
    }
    fn resume(&self) -> AppResult<()> {
        osascript(RESUME_SCRIPT).map(|_| ())
    }
    fn pause(&self) -> AppResult<()> {
        osascript(PAUSE_SCRIPT).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts() {
        assert_eq!(
            play_script("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"),
            "tell application \"Spotify\" to play track \"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M\""
        );
        assert!(PAUSE_SCRIPT.starts_with("if application \"Spotify\" is running"));
    }

    #[test]
    fn explains_permission_denied() {
        assert!(explain("execution error: Not authorized to send Apple events to Spotify. (-1743)").contains("Automation"));
        assert!(explain("weird").contains("weird"));
    }
}
