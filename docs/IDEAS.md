# Ideas

★ = part of the original brief. Everything else is a proposal.

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
- Exam simulator: timed mock exams in the real format (GED: 4 subjects, on-screen TI-30XS-style calculator, RLA extended response graded against the official rubric)
- Readiness score: predicted chance of passing, per subject
- Interleaving: mix topics in practice sessions instead of blocking one topic
- ★ Simulated calculators: TI-30XS-style (GED), TI-84-style graphing, scientific, graphing (behavioral re-implementations, no TI ROMs)
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
- Intel Macs have no MLX or Apple Foundation Models (both need Apple Silicon); local LLMs via Ollama run on CPU there, small models only.
- Anthropic does not allow Claude subscription OAuth in third-party apps → Claude via API key only.
- ChatGPT sign-in (as Codex CLI does) and xAI/Grok OAuth: availability and terms for third-party apps must be verified before building.
- Google Drive / Dropbox OAuth need registered app client IDs (free, but Google's verification process applies for public release).
- Video overview and infographics need TTS + image generation providers; quality depends on which ones the user configures.

## More ideas

### Start where you actually are
- Diagnostic placement test when a space is created (GED: level per subject), then the plan starts from there
- Prerequisite check: before a new topic, a 3-question check; if you fail, it teaches the prerequisite first
- Curriculum coverage map: load an official curriculum (GED, SAT, AP, IHK Fachinformatiker, ...) → see which official topics your sources cover, then deep research fills the gaps
- Textbook mode: import a whole book, detect chapters/TOC, turn it into a chapter-by-chapter course

### Practice that adapts
- Adaptive difficulty: question selection based on estimated skill (IRT-style), not random
- Math step checker: type or draw each step; the AI flags the exact wrong step instead of only the final answer
- Photo of handwritten work (iPhone via Continuity Camera) → graded step by step
- "More like this": generate 5 variations of any problem you got wrong
- Error pattern analysis: spots recurring mistake types (sign errors, misreading the question, unit slips)
- Image occlusion flashcards for diagrams (circuits, maps, anatomy)
- Cloze cards auto-made from your own notes and highlights
- Essay coach: live structure feedback while writing, rubric score, revision diff (GED RLA extended response)
- Role reversal: the AI plays a confused student with a wrong idea; you have to correct it
- Debate mode: the AI argues a position, you counter it (social studies, RLA argument analysis)
- Interest-based analogies: explanations use your interests (games, Minecraft modding, robotics) from a learner profile

### ADHD-first focus
- "I don't know where to start" button: breaks the current task into 2–5 minute micro-steps
- Parking lot: dump a distracting thought in one keystroke mid-session; it's shown at the break
- Visual time bar (Time Timer style) and a subtle color shift as the break gets close, against time blindness
- Hyperfocus guard: Flowtime warns after 90 minutes and pushes water + movement
- Low-energy mode: review-only session (flashcards, light reading) instead of new material
- Break menu: you pick from your own list of break activities
- Bionic reading option and a reading ruler/focus line in the source viewer
- Spotify control for a focus playlist that starts and stops with sessions

### Smarter AI
- Learner memory: the tutor remembers strengths, weaknesses and preferences across spaces, on an editable "what the tutor knows about me" page
- Second opinion: ask a second model the same question and compare answers side by side
- Answer check: the AI verifies its own answer against the sources and flags unsupported claims
- LAN model discovery: auto-detect LM Studio / Ollama servers on the network (e.g. a gaming PC) and offer them as providers
- Spotlight-style global hotkey: ask anything with the current space as context, from any app
- Screenshot snip (region) → question or source

### Reading and notes
- Notes editor per space (blocks, backlinks, AI assist), and notes can become sources
- PDF annotation: highlights and margin notes, plus AI margin comments on request
- Reading level slider: rewrite a passage simpler or harder, side by side with the original
- Bilingual view: source in English, explanation in German (or any language) side by side
- Auto glossary: a space wiki of key terms with definitions, linked wherever they appear
- Watch-along: play a YouTube video inside the app; the AI pauses at key points and asks a question
- Lecture capture: record a class → transcript → notes → cards
- Podcast RSS feeds as sources

### More studio outputs
- One-page cheat sheet (printable)
- Timelines (history / social studies)
- Editable diagrams (Mermaid / Excalidraw-style)
- Printable worksheets with an answer key
- Daily 5-minute audio briefing of today's reviews
- Audio overview formats: deep dive, brief, debate, critique, lecture; optional voice clone via Fish Audio
- Math animations in video overviews (Manim-style)

### Insight
- Retention curves and "you forget X fastest" insights
- Best time of day to study, from your own session data
- Review-before-sleep suggestion (sleep helps memory consolidation)

### Platform
- CLI + URL scheme (`learn add notes.pdf --space ged`), Apple Shortcuts actions
- Automatic local backups (snapshots to a folder of your choice)
- Encrypted spaces (password-protected)
- Gentle macOS notifications driven by the plan ("12 cards due, 10 min")
- Optional gamification (XP, chapter "boss" tests), off by default
- Later: study rooms with friends (shared timer), teacher mode (share a space with students), phone companion for flashcard review
