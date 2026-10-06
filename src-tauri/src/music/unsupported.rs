use super::MusicBackend;
use crate::error::{invalid, AppResult};

pub struct Unsupported;

impl MusicBackend for Unsupported {
    fn name(&self) -> &'static str {
        "none"
    }
    fn available(&self) -> bool {
        false
    }
    fn running(&self) -> bool {
        false
    }
    fn play_playlist(&self, _: &str) -> AppResult<()> {
        Err(invalid("Focus music isn't supported on this platform"))
    }
    fn resume(&self) -> AppResult<()> {
        Err(invalid("Focus music isn't supported on this platform"))
    }
    fn pause(&self) -> AppResult<()> {
        Ok(())
    }
}
