# Ideas

★ = from the original brief. Everything else is a proposal; keep, cut, or defer during grilling.

## Spaces ("notebooks")
- ★ Separate spaces per subject (GED, robotics, programming, ...)
- Space templates: "Exam prep" (exam date, subjects, mock exams), "Skill" (projects, practice), "Course" (syllabus import)
- Cross-space search and concept links ("this robotics PID topic uses the calculus from GED Math")
- Per-space AI persona and tutor style
- Export/import a space as a single file (share study packs with friends)

## Sources
- ★ Deep research source finder like NotebookLM Discover / Deep Research, auto-import
- ★ Cloud imports: Google Drive, Dropbox (+ OneDrive, Box, iCloud Drive folder)
- File types: PDF, EPUB, DOCX, PPTX, Markdown, TXT, images (OCR), audio/video (transcription), web URLs, YouTube (transcript)
- Imports from other tools: Anki decks, Obsidian vault folder, Notion export, Quizlet export
- Watched folders: drop a file in, it lands in the space
- Global quick-capture hotkey and a browser extension "send to space"
- Free-resource-first research: OpenStax, Khan Academy, MIT OCW, Wikipedia, arXiv before random blogs
- Credibility score and dedupe on discovered sources
- Every AI claim cites the exact passage; click to jump to it
- Grounding toggle: strict (sources only) vs. sources + general knowledge (clearly marked)

## Studio outputs (NotebookLM parity)
- ★ Audio overview, video overview, slide deck, mind map, reports, flashcards, quizzes, infographics, data tables
- Interactive audio overview: interrupt the hosts and ask a question
- Customize every output: length, depth, audience, language, focus topic
- Exports: PPTX/PDF slides, MP3/MP4, PNG/SVG infographics, CSV/XLSX tables, Anki deck, Markdown/Obsidian
- AI-generated interactive explainers (small HTML simulations, e.g. a PID controller slider, a graph of y=mx+b)
- Generated mini-course: chapters + lessons + checks, built from the space's sources

## Learning science
- Spaced repetition (FSRS) with one daily review queue across all spaces
- Mastery map: topic graph colored by how well you know each node, built from quiz/flashcard results
- Mistake notebook: every wrong answer saved and re-tested later
- Confidence rating before revealing an answer (trains calibration)
- Tutor modes: Socratic (asks, hints, doesn't hand over answers), direct explain, ELI5 ladder
- Feynman mode: you explain a topic (voice or text), AI finds the gaps
- Highlight any text → "quiz me on this" / "explain" / "make a card"
- Exam simulator: timed mock exams in the real format (GED: 4 subjects, on-screen reference calculator-style calculator, RLA extended response graded against the official rubric)
- Readiness score: predicted chance of passing, per subject
- Interleaving: mix topics in practice sessions instead of blocking one topic
- ★ Simulated calculators: reference calculator-style (GED), TI-84-style graphing, scientific, graphing (behavioral re-implementations, no TI ROMs)
- Math rendering (LaTeX) and step-by-step worked solutions
- Code cells for programming spaces (run Python/JS in a sandbox)
- Voice tutor: spoken back-and-forth conversation

## Focus sessions (not only Pomodoro)
- ★ Pomodoro the AI can see; forced fullscreen break with countdown
- Techniques: Pomodoro, 52/17, Flowtime (open-ended, break scales with work), timeboxing, custom intervals
- AI timing awareness: no 10-minute explanation 2 minutes before a break; recap after the break; pick quiz length to fit remaining time
- Session start check-in (energy, mood, time available) adapts session length and difficulty
- Session end recap: what you covered, written to the space's journal, reviews scheduled automatically
- "Where was I?" 30-second recap when reopening a space
- Break suggestions (water, stretch, 20-20-20 eyes)
- Distraction nudge: detect when a blocked app/site is frontmost during focus and nudge (no root hacks)
- Body-doubling mode: AI checks in every N minutes
- Menu bar timer, built-in ambient sound / white noise
- Gentle streaks, no guilt mechanics

## Planning
- ★ AI study plans
- Plan from goal + exam date + weekly hours → schedule; auto-replans when you miss a day
- "Today" view: reviews due, new material, planned sessions
- ~~Calendar sync~~ (cut)
- Progress dashboard: hours, mastery trend, readiness

## AI providers
- ★ OAuth sign-in where the provider allows it (ChatGPT, Grok mentioned), local models, API keys (Claude, OpenRouter, ...)
- API keys: Anthropic, OpenAI, Google Gemini, OpenRouter, xAI, Groq, Mistral, DeepSeek, any OpenAI-compatible endpoint
- Local: Ollama, LM Studio, llama.cpp server
- Per-task model routing: cheap model for flashcards, strong model for tutoring, separate TTS / image / embedding providers
- Cost tracker and monthly budget cap per provider
- Keys stored in the OS keychain
- Local embeddings so search works offline

## Platform
- Local-first: everything on disk, no account required, no telemetry
- Clean UI (Google-like), light + dark, keyboard-first, ⌘K command palette
- Accessibility: read-aloud for any text, dyslexia-friendly font option, adjustable text size
- Multilingual: learn in any language, translate sources
- App exposes an MCP server (Claude Code etc. can read your spaces) and can use MCP servers as tools
- Opt-in "explain what's on my screen" screenshot to the tutor
- Plugin system later

## Known constraints and unknowns
- Anthropic does not allow Claude subscription OAuth in third-party apps → Claude via API key only.
- ChatGPT sign-in (as Codex CLI does) and xAI/Grok OAuth: availability and terms for third-party apps must be verified before building.
- Google Drive / Dropbox OAuth need registered app client IDs (free, but Google's verification process applies for public release).
- Video overview and infographics need TTS + image generation providers; quality depends on which ones the user configures.
