# Implementation plan: first build scope

Source of truth for scope is `docs/SPEC.md`. This file records how it is built and where deviations from the spec were necessary.

## Deviations from the spec (and why)

- **Embeddings: candle instead of fastembed.** fastembed depends on `ort`, which has no prebuilt ONNX Runtime for `x86_64-apple-darwin` (build fails on the dev Mac). candle (pure Rust) runs `sentence-transformers/all-MiniLM-L6-v2` (384 dims) at ~65 ms per 200-token chunk on the 2019 i7. Model files download from Hugging Face on first use into the app data dir. Same code path works on Windows/Linux.
- **sqlite-vec pinned to 0.1.6.** 0.1.10-alpha fails to compile (missing `sqlite-vec-diskann.c`).
- **AI HTTP goes through our own Rust proxy instead of `@tauri-apps/plugin-http`.** The AI SDK gets a custom `fetch` that calls the `http_stream` command; Rust injects the provider's API key / OAuth token from the keychain, only for that provider's own base URL. Keys never enter the webview. Also removes CORS issues.
- **keyring 3** (stable API) instead of 4.

## Architecture

```
src/                         React + TS (Vite)
  lib/ipc.ts                 typed wrappers for every Tauri command + events
  lib/strings.ts             all UI strings (i18n later)
  lib/providers/             provider registry, proxy fetch, AI SDK model factory, capabilities
  lib/chat/                  context assembly, citation parsing, streaming runner
  lib/buddy/                 study-buddy event logic (pure, unit-tested)
  lib/importers/             importer interface: file, paste, url (Readability+turndown), youtube
  lib/research/              deep research: plan → search → fetch → rank
  components/ui/             restyled Radix primitives
  features/{home,space,sources,chat,focus,settings,palette}/
  test/mockBackend.ts        in-memory implementation of all commands for Playwright
src-tauri/src/
  db/                        rusqlite + sqlite-vec, migrations, row types
  commands/                  thin #[tauri::command] wrappers
  ingest/                    extract (pdf/epub/docx/text), chunker, embedder (candle), worker queue
  retrieval.rs               hybrid search: FTS5 bm25 + vec0 knn, reciprocal rank fusion
  focus/                     pure timer state machine + service (tick thread, persistence, tray, window)
  proxy.rs                   streaming HTTP proxy with secret injection
  secrets.rs                 keychain wrapper
  oauth/                     PKCE, loopback server, device code, refresh rotation; chatgpt, xai
  lan.rs                     LAN scan for LM Studio / Ollama
```

## Data model (SQLite, app data dir)

spaces, sources, source_texts, chunks, chunks_fts (FTS5, external content), vec_chunks (vec0, cosine), threads, messages (citations JSON), focus_sessions, focus_events, parking_items, journal_entries, providers (no secrets), settings (key/value JSON).

## Key mechanics

- **Citations.** Retrieval returns numbered passages; each has chunk id, source id, char range and page. The model is told to cite as `[n]`. Stored citations map `n` → chunk; clicking opens the source viewer scrolled to the char range and highlights it. Untagged general knowledge must be wrapped in a `{{general}}…{{/general}}` marker that renders as a "Not from your sources" tag. In strict mode the prompt forbids it.
- **Timer.** State lives in Rust as timestamps (wall clock), not counters: `phase_started_at`, `phase_duration`, `paused_total`, `paused_at`. Remaining time is always derived from `now`, so sleep/wake, UI reloads and window changes can't drift it. Persisted to SQLite on every transition, restored on launch. A 1 s tick thread emits `focus://tick` and drives phase transitions, the tray title, and break fullscreen.
- **Break.** On break start Rust makes the main window fullscreen + always-on-top-off (other apps stay usable) and the UI renders a blocking overlay from the timer state, so reloads keep it. Only "I need the app" pauses it; that writes a `need_app_pause` event the AI sees. Esc and other shortcuts are swallowed while the overlay is up; leaving fullscreen during a break re-enters it.
- **Study buddy.** Pure TS reducer reacts to timer ticks/transitions and emits buddy events (check-in, T-3 recall, block-end quiz, post-break recap, session summary). Events become `buddy` messages in the active thread; the AI turn for each is generated with the timer state in context.
- **Ingestion.** Background worker thread with a queue; extraction and embedding never run on the main thread or the async runtime threads. Progress events per source. Errors stored on the source with a human reason.

## Build order

1. Project scaffold, CLAUDE.md, Tailwind theme, app shell, data model, IPC layer, mock backend.
2. In parallel (separate worktrees): ingestion + retrieval (Rust); focus timer (Rust + UI); provider layer, proxy, secrets, OAuth, LAN discovery, settings UI.
3. Sources UI + importers + source viewer; chat (streaming, markdown, citations, tutor style); study-buddy wiring; deep research.
4. Playwright flows, real-app build + screenshots, LM Studio end-to-end checks, HANDOFF.md.

## Tests

- `cargo test`: timer state machine, chunker, extractors, retrieval fusion, PKCE/refresh/device code with wiremock, proxy auth injection rules.
- Vitest: provider factory + capabilities, proxy fetch adapter, context assembly, citation parsing, buddy reducer.
- Playwright (Vite + mocked IPC): space → import → chat with citation → click citation; focus → break overlay → logged pause.
