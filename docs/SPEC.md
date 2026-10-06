# Spec

Free, MIT-licensed, local-first AI learning platform. Desktop app, macOS first, later Windows, Linux, web. Name not chosen yet; codename `ai-learning-app`.

NotebookLM is the baseline, not the ceiling: sources + grounded AI + generated study material, plus focus sessions the AI is part of, study plans, and real learning-science tools.

## Decisions

| Area | Decision |
|---|---|
| Stack | Tauri 2 (Rust backend) + React + TypeScript + Vite, `bun` as package manager |
| Data | Local-only. SQLite + files in the app data dir. No account, no server, no telemetry. Sync later. |
| Spaces | Called "Spaces". One per subject (GED, robotics, programming, ...). |
| Look | NotebookLM / Google Workspace feel: neutral surfaces, soft rounded cards, one accent color, Inter, lots of whitespace, 3-pane layout (Sources, Chat, Studio). Light + dark + system. Not editorial. |
| UI language | English, strings kept in one place for later i18n. Dyslexia-friendly font option (OpenDyslexic) + text size setting. AI replies in the user's language. |
| Tutor style | Per-space setting: Direct / Socratic / Mixed, switchable in chat. |
| Grounding | Sources first with citations. General knowledge allowed but visibly tagged "not from your sources". Per-space strict toggle (sources only). |
| Web search | Provider built-in search when the active model supports it (OpenAI, Anthropic, Gemini, OpenRouter `:online`, xAI). Free fallback for any model, including local: DuckDuckGo HTML, Wikipedia, arXiv, OpenAlex, OpenStax, YouTube; optional SearXNG URL; optional Brave/Tavily/Exa keys. Page fetch is local: HTTP fetch → Readability → Markdown (turndown). |
| Deep research import | Review list of found sources (summary + credibility score, all pre-checked) → one-click import. |
| AI providers | API keys: Anthropic, OpenAI, Google Gemini, OpenRouter, xAI, Groq, Mistral, DeepSeek, any OpenAI-compatible URL. Local: Ollama, LM Studio, llama.cpp server. OAuth sign-in: ChatGPT via OpenAI's official open-source "Sign in with ChatGPT" path; xAI/Grok via device code, following Hermes Agent (details in `docs/OAUTH.md`). Claude subscription OAuth is not offered (Anthropic disallows it in third-party apps); Claude via API key. |
| Secrets | OS keychain (Rust `keyring` crate). Never in SQLite, never in logs. |
| Focus | Pomodoro, 52/17, Flowtime (break = work/5), timebox, custom. Timer state lives in Rust so it survives UI reloads. |
| Breaks | On break the app window goes fullscreen with a countdown overlay that blocks the app's study UI until the break ends. Other apps stay usable. A small "I need the app" button pauses the break; every pause is logged and the AI sees it. No skip button. |
| AI and timer | Full study buddy: knows timer state at all times; session start check-in (energy, time, goal); plans the block; check-ins every N minutes (configurable, body doubling); at T-3 min proposes quick recall; end-of-block mini quiz; post-break recap; end-of-session summary written to the space journal. Never starts a long answer that can't finish before the break without saying so. |
| TTS | Pluggable. Free local default (bundled CPU voice). Providers: Fish Audio (preferred for quality), OpenAI TTS, Gemini TTS, ElevenLabs. |
| Cloud imports | Google Drive and Dropbox right after the first build, behind the same importer interface as local files. |
| Git | Local commits only. No remote until the user names and publishes it. |

## First build scope

Must work end-to-end and be verified:

**Spaces**
- Create, rename, delete, pick icon/color; per-space settings (tutor style, strict grounding, model)
- Home screen grid of spaces, last-opened recap line

**Sources**
- Import: PDF, EPUB, DOCX, Markdown/TXT, pasted text, web URL, YouTube (transcript)
- Each source: title, type, status (processing/ready/error with reason), summary, toggle "use in chat"
- Pipeline: extract text → chunk (with page/offset metadata) → local embeddings → SQLite FTS5 + vector index (hybrid search)
- Source viewer that can jump to and highlight a cited passage
- Deep research: query → plan → search → fetch → rank → review list → import

**Chat**
- Multiple threads per space, streaming responses, Markdown + LaTeX + code highlighting
- Inline citations `[1]` → click opens the source viewer at the passage
- "Not from your sources" tagging for general knowledge
- Tutor style switch in the composer
- Context includes: selected sources (retrieved chunks), focus session state, space settings

**Providers**
- Settings screen: add/remove providers, test connection, pick default chat model, embedding model (default local), per-space override
- API-key providers + Ollama/LM Studio/OpenAI-compatible
- OAuth provider plumbing (auth-code + PKCE with 127.0.0.1 callback, device code, rotating token refresh, keychain storage) with ChatGPT and xAI implemented per `docs/OAUTH.md`

**Focus**
- Start session from anywhere (toolbar + ⌘⇧F), pick technique, optional goal
- Compact timer in the app header + menu bar (tray) timer
- Break: fullscreen overlay with countdown, break tip, "I need the app" pause (logged)
- Study-buddy events injected into the active chat (check-in, T-3 recall, block-end quiz, post-break recap, session summary)
- Session history per space (duration, technique, pauses, summary)

**App shell**
- 3-pane space layout, collapsible panes, ⌘K command palette, light/dark/system theme, dyslexia font + text size
- Empty states, loading skeletons, error toasts with retry; nothing silently fails

## Roadmap after the first build (in order)

- Cloud connectors: Google Drive, Dropbox (OneDrive, Box later), watched folders, global quick-capture hotkey
- Flashcards + quizzes from sources, FSRS review queue across spaces, mistake notebook
- Study plans: goal + exam date + weekly hours → schedule, Today view, auto re-plan on missed days
- Studio: reports, mind map, slide deck (PPTX/PDF export), data tables (CSV/XLSX), infographics, audio overview (interruptible), video overview
- Simulated calculators: reference calculator-style (GED), TI-84-style graphing, scientific, plain graphing. Behavioral re-implementations, no TI ROMs or trademarks.
- Mastery map (topic graph colored by mastery) + readiness score
- Exam simulator: timed mocks in real formats (GED first: 4 subjects, calculator, RLA essay graded against the rubric)
- Feynman mode + spoken voice tutor
- AI-generated interactive explainers (sandboxed HTML) + code cells (Python/JS sandbox)
- Distraction nudge (frontmost blocked app during focus) + ambient sound
- MCP server (expose spaces to Claude Code etc.) + MCP client (use MCP tools)
- Share study packs: export/import a space as one file
- Windows and Linux builds, then web

Cut: calendar sync.

## Architecture

- **Frontend** (`src/`): React + TS, Tailwind + Radix primitives (shadcn-style, restyled to the Google look), Zustand for UI state, TanStack Query for backend calls. AI calls through the Vercel AI SDK (`ai` + provider packages) with `@tauri-apps/plugin-http` fetch so there's no CORS issue and keys stay out of web requests made by the page.
- **Backend** (`src-tauri/`): Rust. SQLite (`rusqlite` or `sqlx`) with FTS5 + `sqlite-vec`; local embeddings via `fastembed` (ONNX, small model, CPU-friendly); document extraction (PDF via pdfium or `pdf-extract`, DOCX/EPUB parsers); keychain (`keyring`); focus timer state machine emitting Tauri events; OAuth callback server; window control (fullscreen, always-on-top overlay).
- **Provider layer**: one interface `{ id, kind: apiKey|oauth|local, models(), chat(stream), embed?, tts?, webSearch? }`. Capabilities declared per provider so features degrade cleanly (e.g. no built-in search → free fallback).
- **Importer interface**: `{ id, canHandle(input), import(input) → Source }`, so cloud connectors plug in later without touching the pipeline.
- **Data model**: spaces, sources, chunks (+ embeddings), threads, messages (+ citations), focus_sessions, focus_events, settings, providers (no secrets).

## Constraints

- Tauri WebDriver testing is not supported on macOS (WKWebView). UI is tested in the browser via Vite with mocked Tauri IPC (`@tauri-apps/api/mocks`) + Playwright; Rust logic via `cargo test`; TS logic via Vitest.
- YouTube transcript fetching is unofficial and can break; isolate it and fail with a clear message.
