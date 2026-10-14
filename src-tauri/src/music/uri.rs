use crate::error::{invalid, AppResult};

const HINT: &str = "Use a Spotify playlist or album link, like https://open.spotify.com/playlist/… or spotify:playlist:…";

fn valid_id(id: &str) -> bool {
    (10..=40).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn kind_ok(kind: &str) -> bool {
    matches!(kind, "playlist" | "album")
}

/// Turns a pasted Spotify playlist/album link or URI into a canonical `spotify:<kind>:<id>` URI.
pub fn parse_playlist(input: &str) -> AppResult<String> {
    let s = input.trim();
    if s.is_empty() {
        return Err(invalid(format!("Enter a Spotify playlist. {HINT}")));
    }
    let parts: Vec<&str> = if let Some(rest) = s.strip_prefix("spotify:") {
        rest.split(':').collect()
    } else {
        let rest = s
            .strip_prefix("https://")
            .or_else(|| s.strip_prefix("http://"))
            .unwrap_or(s);
        let rest = rest.strip_prefix("www.").unwrap_or(rest);
        let Some(path) = rest.strip_prefix("open.spotify.com/") else {
            return Err(invalid(format!("That isn't a Spotify link. {HINT}")));
        };
        let path = path.split(['?', '#']).next().unwrap_or("");
        let mut segs: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        if segs.first().is_some_and(|p| p.starts_with("intl-")) {
            segs.remove(0);
        }
        segs
    };
    match parts.as_slice() {
        [kind, id] if kind_ok(kind) && valid_id(id) => Ok(format!("spotify:{kind}:{id}")),
        _ => Err(invalid(format!(
            "Couldn't read that as a Spotify playlist or album. {HINT}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "37i9dQZF1DXcBWIGoYBM5M";

    #[test]
    fn accepts_uri_and_links() {
        let want = format!("spotify:playlist:{ID}");
        for input in [
            format!("spotify:playlist:{ID}"),
            format!("  https://open.spotify.com/playlist/{ID}?si=abc123  "),
            format!("open.spotify.com/intl-de/playlist/{ID}"),
            format!("http://www.open.spotify.com/playlist/{ID}/"),
            format!("https://open.spotify.com/playlist/{ID}#x"),
        ] {
            assert_eq!(parse_playlist(&input).unwrap(), want, "{input}");
        }
    }

    #[test]
    fn accepts_albums() {
        assert_eq!(
            parse_playlist(&format!("https://open.spotify.com/album/{ID}?si=1")).unwrap(),
            format!("spotify:album:{ID}")
        );
        assert_eq!(
            parse_playlist(&format!("spotify:album:{ID}")).unwrap(),
            format!("spotify:album:{ID}")
        );
    }

    #[test]
    fn rejects_everything_else() {
        for input in [
            "",
            "   ",
            "hello",
            &format!("https://example.com/playlist/{ID}"),
            &format!("https://open.spotify.com.evil.com/playlist/{ID}"),
            &format!("https://open.spotify.com/track/{ID}"),
            &format!("spotify:track:{ID}"),
            "spotify:playlist:",
            "spotify:playlist:short",
            "spotify:playlist:abc\" & quit",
            &format!("spotify:playlist:{ID}:extra"),
            "https://open.spotify.com/playlist/",
        ] {
            let err = parse_playlist(input).unwrap_err().to_string();
            assert!(err.contains("Spotify"), "{input}: {err}");
        }
    }
}
