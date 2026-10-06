# ai-learning-app

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
- `bun scripts/e2e-lmstudio.ts`, `bun scripts/e2e-research.ts` — live checks against LM Studio and real web services (no app needed).

## Checking the real app

Tauri WebDriver doesn't work on macOS. Run `bun run tauri dev`, then screenshot the native window (`screencapture -l <windowId>`; window id via CGWindowList). For clicks use real mouse events (CGEvent), not AppleScript `click at` (it doesn't focus web inputs). Don't drive the UI while the user may be using the Mac.

## Layout

- `src/lib/` — `ipc.ts` (every command + event, typed), `types.ts`, `strings.ts` (all UI strings), `queries.ts` (TanStack Query keys/hooks), `providers/` (AI SDK model factory + proxy fetch), `chat/`, `buddy/`, `importers/`, `research/`
- `src/features/<area>/` — screens and components per area; `src/components/ui/` — restyled Radix primitives
- `src/stores/ui.ts` — Zustand UI state (route, theme, panes, dialogs)
- `src/test/mockBackend.ts` — in-memory implementation of all commands; used automatically when not running inside Tauri. `window.__mock` has test hooks (`advance(ms)`, `setScript`, `seedProvider`, `reset`).
- `src-tauri/src/` — `db/` (schema + numbered migrations + models), `commands/`, `ingest/`, `retrieval.rs`, `focus/`, `watch/` (watched folders), `capture.rs` (global quick-capture hotkey), `proxy.rs`, `secrets.rs`, `oauth/`, `lan.rs`
- New DB tables: add a numbered `.sql` file in `src-tauri/src/db/` and append it to `MIGRATIONS`; never edit an existing migration.

## Conventions

- Every new command: Rust fn in its module, registered in `lib.rs`, wrapper in `src/lib/ipc.ts`, handler in `src/test/mockBackend.ts`. Args are camelCase in JS, snake_case in Rust.
- Commands are `async` so they never run on the main thread. CPU work (extraction, embeddings) runs on the ingest worker thread.
- Errors: Rust returns `AppError` (serialized `{code, message}`); UI shows them via `toastError(title, err, retry?)` or `ErrorState`. Nothing fails silently.
- Every screen/pane has empty, loading (Skeleton) and error states.
- Secrets only via `secrets.rs`: OS keychain in release builds; debug builds use `dev-secrets.json` (0600) in the app data dir, since rebuilt binaries trigger keychain prompts. Never log keys/tokens. AI HTTP goes through `http_stream`, which injects auth in Rust only for the provider's own base URL.
- UI strings go in `src/lib/strings.ts`. Colors via theme tokens (`bg-surface`, `text-muted`, `bg-accent`…), never raw hex in components.
- Minimal comments. Commit messages: short list of what changed, no AI trailers.

## Dev LLM

Use OpenRouter with cheap models for live checks: `OPENROUTER_API_KEY=… bun scripts/e2e-*.ts` (default `deepseek/deepseek-v4.1-flash`; `anthropic/claude-haiku-4.5` for comparisons). The key is never stored in the repo. LM Studio on the LAN PC (`http://192.168.1.20:1234/v1`, `qwen3.5-9b`) is also a gaming PC: only use it when the user says it's free, and `lms unload --all` afterwards. Qwen reasons by default; `reasoning_effort: "none"` (AI SDK `reasoning: "none"`) turns it off. Don't run models on this Mac.
