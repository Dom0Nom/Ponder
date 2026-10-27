# Ponder (ai-learning-app)

Local-first AI learning desktop app (Tauri 2 + React + TS). Specs: `docs/SPEC.md` (source of truth), `docs/PLAN.md` (how it's built + deviations), `docs/OAUTH.md`.

## Commands

- `bun install` — deps
- `bun run dev` — Vite only (browser, mocked backend at http://localhost:1420; add `?seed` to get a mock LLM provider)
- `bun run tauri dev` — real app
- `bun run tauri build` — release bundle (`src-tauri/target/release/bundle/macos/`)
- `bun run typecheck` — `tsc --noEmit`
- `bun run test` — Vitest (TS logic)
- `bun run e2e` — Playwright against Vite + mocked IPC (starts the dev server itself; `E2E_PORT=1437 bun run e2e` uses another port)
- `cd src-tauri && cargo test` — Rust logic. Some tests hit the network/model/keychain and are `#[ignore]`; run with `cargo test -- --ignored`.
- `bun scripts/e2e-lmstudio.ts`, `bun scripts/e2e-research.ts`, `bun scripts/e2e-tts.ts` — live checks against LM Studio, real web services and OpenRouter speech (no app needed; TTS writes files, never plays them).
- `bun scripts/stream-check.ts` — real Rust proxy + AI SDK against a hostile mock SSE server (`--live` adds OpenRouter).
- `bun scripts/prompt-eval.ts` — prompt eval harness (see `docs/PROMPTS.md`).
- `bun scripts/context-eval.ts --data <copy of a data folder>` — old vs new chat context on real spaces (needs a debug build; starts `ponder dev-serve`, debug-only, which serves search/read commands for scripts).
- `bun scripts/translate.ts [--langs de,fr]` — machine-translates new or changed keys (OpenRouter); `bun scripts/i18n.ts extract|check`.
- `PONDER_DATA_DIR=<dir> bun run tauri dev` — debug builds use another data folder (a copy of the real database, or empty for a fresh install).
- `scripts/linux-build.sh` — Linux `.deb`/AppImage in Docker (output in `dist-linux/`).
- Windows compile check (from `src-tauri`; Homebrew's rustc shadows rustup, and the msvc target needs the Windows SDK): `TC=~/.rustup/toolchains/stable-x86_64-apple-darwin/bin; PATH=$TC:$PATH RUSTC=$TC/rustc CARGO_TARGET_DIR=target/win $TC/cargo check --target x86_64-pc-windows-gnu` (needs `brew install mingw-w64`).

## Checking the real app

Tauri WebDriver doesn't work on macOS. Run `bun run tauri dev`, then screenshot the native window (`screencapture -l <windowId>`; window id via CGWindowList). For clicks use real mouse events (CGEvent), not AppleScript `click at` (it doesn't focus web inputs). Don't drive the UI while the user may be using the Mac.

## Layout

- `src/lib/` — `ipc.ts` (every command + event, typed), `types.ts`, `strings.ts` (re-exports `s` from `src/locales`), `i18n/` (locale list, formatting helpers, fonts, `languageInstruction`), `queries.ts` (TanStack Query keys/hooks), `providers/` (AI SDK model factory + proxy fetch), `chat/`, `buddy/`, `importers/`, `research/`
- `src/features/<area>/` — screens and components per area; `src/components/ui/` — restyled Radix primitives
- `src/stores/ui.ts` — Zustand UI state (route, theme, panes, dialogs)
- `src/test/mockBackend.ts` — in-memory implementation of all commands; used automatically when not running inside Tauri. `window.__mock` has test hooks (`advance(ms)`, `setScript`, `seedProvider`, `reset`, `emit(event, payload)`, `deepLink(url)`, `db()`).
- `src-tauri/src/` — `db/` (schema + numbered migrations + models), `commands/`, `ingest/`, `retrieval.rs`, `focus/` (timer, distraction nudge), `watch/` (watched folders), `capture.rs` (global quick-capture hotkey), `ask.rs` (ask-anything overlay + screen snip), `proxy.rs`, `secrets.rs`, `oauth/`, `lan.rs`, `backup.rs`, `pack.rs` (study packs), `deeplink.rs` + `cli.rs` (`ponder://`, command line), `mcp.rs` (MCP server, `ponder mcp`; `--write` queues sources/notes), `inbox.rs` (imports what the MCP server queued), `mcp_client.rs` (stdio + Streamable HTTP MCP client for chat tools), `mcp_oauth.rs` (MCP OAuth sign-in), `annotations.rs` (source highlights + notes), `notes.rs`, `studio.rs`, `exams.rs`, `plans.rs`, `insights.rs`, `music/`
- `src/lib/context/` — what the model reads: budget per model window, conversation compaction, search planning, passage expansion, source map, reading tools; used by chat and every generator (`gatherForTask`). Rust side `src-tauri/src/context.rs` (multi-search, range reads, outlines, thread summaries).
- More `src/lib/` areas: `questions/` (shared question kinds + `grade.ts`), `worksheets/`, `session/` (Next engine), `quality/answerCheck.ts`, `tts/` (speech services, player, briefing, `kokoro*.ts` offline voice worker), `studio/` (outputs, explainers), `codecell/` (JS worker, Pyodide worker), `plot/` (graphing engine), `exam/`, `plan/`, `insights/`, `notes/`, `feynman/`, `lecture/`, `ambient.ts`, `video/` (narrated video export), `watchAlong/` (YouTube watch-along), `mcp/` (MCP tools → AI SDK tools), `sources/` (viewer pieces, highlight anchoring, `pdfAnchor.ts` for the pdf.js page view)
- New DB tables: add a numbered `.sql` file in `src-tauri/src/db/` and append it to `MIGRATIONS`; never edit an existing migration. Migrations 010–015 are matched by the objects they create (`DETECTED` in `db/mod.rs`) because they were merged in different orders; later ones go by `user_version`.

## Conventions

- Every new command: Rust fn in its module, registered in `lib.rs`, wrapper in `src/lib/ipc.ts`, handler in `src/test/mockBackend.ts`. Args are camelCase in JS, snake_case in Rust.
- Commands are `async` so they never run on the main thread. CPU work (extraction, embeddings) runs on the ingest worker thread.
- Errors: Rust returns `AppError` (serialized `{code, message}`); UI shows them via `toastError(title, err, retry?)` or `ErrorState`. Nothing fails silently.
- Every screen/pane has empty, loading (Skeleton) and error states.
- Secrets only via `secrets.rs`: OS keychain in release builds; debug builds use `dev-secrets.json` (0600) in the app data dir, since rebuilt binaries trigger keychain prompts. Never log keys/tokens. AI HTTP goes through `http_stream`, which injects auth in Rust only for the provider's own base URL.
- UI strings go in `src/locales/en.ts` (the English source, `s.area.key`). Use `msg<[n: number]>("Week {0}")` for text with arguments (`{0, number}`, `{0, percent}` takes a 0..1 fraction, `{0, minutes}`/`{0, seconds}`) and `plural<[n: number]>({ one: "{0} card", other: "{0} cards" })` for counts (`plural(forms, 1)` picks another argument). No logic or concatenated fragments in strings: split into keys or pass formatted values (`src/lib/i18n/format.ts`: dates, numbers, durations, relative times, lists; never `toLocaleString()` without it). Don't capture `s.x.y` in module-level constants; use functions or getters. After editing en.ts run `bun scripts/i18n.ts extract` (rewrites `src/locales/en.json`, which translators work from); `bun scripts/i18n.ts check` (also run by `bun run test`) fails on bad placeholders or plural categories in `src/locales/<code>.json` and on literal text in `.tsx` (JSX text, `aria-label`/`placeholder`/`title`/`alt`/`label`). A key missing from a language file means "not translated yet": it shows English and only lowers the coverage percentage. Switch language with `setLocale(code)` (`src/locales`), which rewrites `s` in place; `LocaleKey` remounts the tree. Native text (tray, menus, notifications, dialogs) is `native.*` keys read by `src-tauri/src/i18n.rs`; Rust errors the user sees get `invalid_key`/`keyed` with a key in `s.errors`. Prompts stay English; add `languageInstruction(space.language)`.
- RTL (ar, ur, fa): use logical utilities (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/rounded-s`, `margin-inline-start`), never `ml-/pl-/left-/text-left`, except centering with `left-1/2` and the calculator. Mirrored icons, slide directions and `--dir-x` live in `src/styles/rtl.css`; code, math, timers, plots and calculators set `dir="ltr"`.
- Fonts: IBM Plex Sans covers Latin, Greek and Cyrillic; script fallbacks are loaded per language by `src/lib/i18n/fonts.ts` and listed in `--font-fallbacks` (`src/index.css`). Colors via theme tokens (`bg-surface`, `text-muted`, `bg-primary`…), never raw hex in components. There is no accent color.
- Tokens: names live in `src/index.css` (colors, radii, type scale, shadows, `--motion-*`). `--calc-*` only inside the calculator.
- Motion: `src/styles/transitions/<slug>.css` are real transitions.dev snippets (keep the attribution header; edit only as documented there), app-specific motion is in `src/styles/app-motion.css`. Durations/easings come from `--motion-*`. Reduce motion and Visual effects are settings that set `data-motion` on `<html>`; reduced motion removes all animation. WebGL effects only behind Visual effects.
- `studioView` in `src/stores/ui.ts` says which Studio panel is open (`focus`, `microsteps`, `lowEnergy`, `journal`, `flashcards`, `steps`, `plan`, `course`, `settings`, `calculator`, `create`, `feynman`, or `null`). It is not persisted.
- Pixel gate: `bun scripts/design-diff.ts [--port N]` renders the app with `?fixture=design` and compares it to the design artboards. No masks. `region` only for artboards whose design backdrop is outdated; user-requested changes go in `USER_DEVIATIONS`. Run it after any UI change.
- Platform-specific Rust (AppleScript music, NSWorkspace, `screencapture`, file modes) sits behind `cfg` gates with a stub for other OSes; keep the Windows check above green.
- Pyodide is copied into the bundle by `scripts/vite-pyodide.ts` (imported by `vite.config.ts`); bumping pyodide means checking its file list.
- Anything that makes sound in tests runs Chromium with `--mute-audio`; never play audio through the speakers.
- Calculator behaviour is specified in `docs/redesign/calculator/` (`BEHAVIOR.md`, `vectors.json`); the engine tests run every vector.
- Minimal comments. Commit messages: short list of what changed, no AI trailers.

## Dev LLM

Use OpenRouter with cheap models for live checks: `OPENROUTER_API_KEY=… bun scripts/e2e-*.ts` (default `deepseek/deepseek-v4.1-flash`; `anthropic/claude-haiku-4.5` for comparisons). The key is never stored in the repo. For a local model, point `LMSTUDIO_URL` at an LM Studio or Ollama server (default `http://localhost:1234/v1`). Qwen reasons by default; `reasoning_effort: "none"` (AI SDK `reasoning: "none"`) turns it off.
