# Ponder (ai-learning-app)

Local-first AI learning desktop app (Tauri 2 + React + TS). Specs: `docs/SPEC.md` (source of truth), `docs/PLAN.md` (how it's built + deviations), `docs/OAUTH.md`, `docs/HANDOFF.md` (current state).

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
- `scripts/linux-build.sh` — Linux `.deb`/AppImage in Docker (output in `dist-linux/`).
- Windows compile check (from `src-tauri`; Homebrew's rustc shadows rustup, and the msvc target needs the Windows SDK): `TC=~/.rustup/toolchains/stable-x86_64-apple-darwin/bin; PATH=$TC:$PATH RUSTC=$TC/rustc CARGO_TARGET_DIR=target/win $TC/cargo check --target x86_64-pc-windows-gnu` (needs `brew install mingw-w64`).

## Checking the real app

Tauri WebDriver doesn't work on macOS. Run `bun run tauri dev`, then screenshot the native window (`screencapture -l <windowId>`; window id via CGWindowList). For clicks use real mouse events (CGEvent), not AppleScript `click at` (it doesn't focus web inputs). Don't drive the UI while the user may be using the Mac.

## Layout

- `src/lib/` — `ipc.ts` (every command + event, typed), `types.ts`, `strings.ts` (all UI strings), `queries.ts` (TanStack Query keys/hooks), `providers/` (AI SDK model factory + proxy fetch), `chat/`, `buddy/`, `importers/`, `research/`
- `src/features/<area>/` — screens and components per area; `src/components/ui/` — restyled Radix primitives
- `src/stores/ui.ts` — Zustand UI state (route, theme, panes, dialogs)
- `src/test/mockBackend.ts` — in-memory implementation of all commands; used automatically when not running inside Tauri. `window.__mock` has test hooks (`advance(ms)`, `setScript`, `seedProvider`, `reset`, `emit(event, payload)`, `deepLink(url)`, `db()`).
- `src-tauri/src/` — `db/` (schema + numbered migrations + models), `commands/`, `ingest/`, `retrieval.rs`, `focus/` (timer, distraction nudge), `watch/` (watched folders), `capture.rs` (global quick-capture hotkey), `ask.rs` (ask-anything overlay + screen snip), `proxy.rs`, `secrets.rs`, `oauth/`, `lan.rs`, `backup.rs`, `pack.rs` (study packs), `deeplink.rs` + `cli.rs` (`ponder://`, command line), `mcp.rs` (read-only MCP server, `ponder mcp`), `notes.rs`, `studio.rs`, `exams.rs`, `plans.rs`, `insights.rs`, `music/`
- More `src/lib/` areas: `tts/` (speech services, player, briefing), `studio/` (outputs, explainers), `codecell/` (JS worker, Pyodide worker), `plot/` (graphing engine), `exam/`, `plan/`, `insights/`, `notes/`, `feynman/`, `lecture/`, `ambient.ts`
- New DB tables: add a numbered `.sql` file in `src-tauri/src/db/` and append it to `MIGRATIONS`; never edit an existing migration.

## Conventions

- Every new command: Rust fn in its module, registered in `lib.rs`, wrapper in `src/lib/ipc.ts`, handler in `src/test/mockBackend.ts`. Args are camelCase in JS, snake_case in Rust.
- Commands are `async` so they never run on the main thread. CPU work (extraction, embeddings) runs on the ingest worker thread.
- Errors: Rust returns `AppError` (serialized `{code, message}`); UI shows them via `toastError(title, err, retry?)` or `ErrorState`. Nothing fails silently.
- Every screen/pane has empty, loading (Skeleton) and error states.
- Secrets only via `secrets.rs`: OS keychain in release builds; debug builds use `dev-secrets.json` (0600) in the app data dir, since rebuilt binaries trigger keychain prompts. Never log keys/tokens. AI HTTP goes through `http_stream`, which injects auth in Rust only for the provider's own base URL.
- UI strings go in `src/lib/strings.ts`. Colors via theme tokens (`bg-surface`, `text-muted`, `bg-primary`…), never raw hex in components. There is no accent color.
- Tokens: names live in `src/index.css` (colors, radii, type scale, shadows, `--motion-*`). `--calc-*` only inside the calculator.
- Motion: `src/styles/transitions/<slug>.css` are real transitions.dev snippets (keep the attribution header; edit only as documented there), app-specific motion is in `src/styles/app-motion.css`. Durations/easings come from `--motion-*`. Reduce motion and Visual effects are settings that set `data-motion` on `<html>`; reduced motion removes all animation. WebGL effects only behind Visual effects.
- `studioView` in `src/stores/ui.ts` says which Studio panel is open (`focus`, `microsteps`, `lowEnergy`, `journal`, `flashcards`, `steps`, `plan`, `course`, `settings`, `calculator`, `create`, `feynman`, or `null`). It is not persisted.
- Pixel gate: `bun scripts/design-diff.ts [--port N]` renders the app with `?fixture=design` and compares it to the design artboards. No masks. `region` only for artboards whose design backdrop is outdated; user-requested changes go in `USER_DEVIATIONS`. Run it after any UI change.
- Platform-specific Rust (AppleScript music, NSWorkspace, `screencapture`, file modes) sits behind `cfg` gates with a stub for other OSes; keep the Windows check above green.
- Pyodide is copied into the bundle by `scripts/vite-pyodide.ts` (imported by `vite.config.ts`); bumping pyodide means checking its file list.
- Anything that makes sound in tests runs Chromium with `--mute-audio`; never play audio through the speakers.
- Calculator is clean-room: the builder never reads the reference; `docs/redesign/calculator/` is the only channel.
- Minimal comments. Commit messages: short list of what changed, no AI trailers.

## Dev LLM

Use OpenRouter with cheap models for live checks: `OPENROUTER_API_KEY=… bun scripts/e2e-*.ts` (default `deepseek/deepseek-v4.1-flash`; `anthropic/claude-haiku-4.5` for comparisons). The key is never stored in the repo. LM Studio on the LAN PC (`http://192.168.1.20:1234/v1`, `qwen3.5-9b`) is also a gaming PC: only use it when the user says it's free, and `lms unload --all` afterwards. Qwen reasons by default; `reasoning_effort: "none"` (AI SDK `reasoning: "none"`) turns it off. Don't run models on this Mac.
