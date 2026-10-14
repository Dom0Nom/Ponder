# Prompts

Every prompt the app sends to a model, what each one must return, the style rules new prompts follow, and how they are evaluated (`scripts/prompt-eval.ts`).

## Inventory

All calls go through `generateText`/`streamText` from the `ai` SDK; there is no structured-output mode. "chat" = `resolveChatModel` (space override → app default → first provider). "research" = `resolveResearch` (research model setting → chat). Every call except the main tutor turn runs with thinking off (`callOptions`, `providers/model.ts`).

| id | where (src/lib unless noted) | purpose | model | output → parser |
|---|---|---|---|---|
| tutor-system | `chat/context.ts` `buildSystemPrompt`, tutor styles `TUTOR`, `describeFocus` | main tutor reply | chat + user's thinking controls | Markdown/LaTeX, `[n]` citations, `{{general}}…{{/general}}`, `{{remember: …}}`, `{{followup: …}}` → `extractFollowUps`, `extractMemories`, `citations.ts`, `remarkCitations.ts` |
| tutor-voice | `chat/context.ts` `VOICE_INSTRUCTION` (appended last when `voice` is set; `runTurn({ voice: true })`) | tutor reply in a spoken conversation: ≤4 short sentences (~60 words), no Markdown/LaTeX/lists, ≤1 question, math in words, `[n]` kept (not spoken), first part + "want me to go on?" for long requests | chat + user's thinking controls | text → `plainAnswer` → read aloud |
| tutor-history | `chat/context.ts` `historyMessages`, `chat/runner.ts` buddy wrapper | last 12 turns, buddy notes and events | – | strips `{{general}}` |
| buddy-instruction | `buddy/prompts.ts` `buddyInstruction` | focus-timer events: session start, check-in, recall, block quiz, post-break, session summary (normal and low-energy) | chat, thinking off | Markdown; quiz answers below `---`; summary saved to the journal |
| topic-start / lesson-study | `placement/flows.ts` | start a topic, re-teach prerequisites, study a chapter | chat | as tutor |
| second-opinion | `chat/secondOpinion.ts` (reuses `buildSystemPrompt`) | same question, other model | picked model | as tutor |
| self-check | `chat/selfCheck.ts` `checkPrompt` | claim-by-claim fact check against cited passages | chat | JSON `[{claim, verdict, passages, note}]` → `parseCheck` |
| micro-steps | `focus/microSteps.ts` `microStepPrompt` | goal → 4–7 tiny steps | chat | JSON `[{text, minutes}]` → `parseMicroSteps` |
| mcq-quiz | `placement/logic.ts` `generateQuiz` | placement, prerequisites, lesson check, Quiz me | chat | JSON `[{topicId, question, options[4], answer, explanation}]` → `parseQuiz` |
| custom-curriculum | `placement/customCurriculum.ts` | syllabus → 5–25 topics | chat | JSON `{title, topics[]}` → `parseCustomCurriculum` |
| practice-problem | `practice/problems.ts` `generateProblem`, `FORMAT`, `LEVEL_WORDS` (`practice/irt.ts`) | one problem at level 1–5 | chat | JSON `{kind, question, options, answer, solution, hint, level}` → `parseProblem` |
| practice-variation | `practice/problems.ts` `generateVariation` | "More like this" | chat | as above |
| answer-check | `quality/answerCheck.ts` `choicePrompt`, `numberPrompt` (both open "Solve this problem carefully"); used by `exam/generate.ts`, `placement/logic.ts` `generateQuiz` (quizzes, placement, lesson checks) and `practice/problems.ts` | solve every generated question blind: step by step, then list every option that is correct (two or more = ambiguous, none = wrong). Disagreement or ambiguity drops the question; dropped ones are rewritten once in one batch and checked again. Solver = `helperModel` when set and different, else the same model at temperature 0, thinking off. Failed or unparseable solver calls keep the question. Settings → Models → "Check answer keys" (default on) | helper or chat | last `{"correct": ["B"]}` → `parseChoices`, `choiceVerdict`; numeric: last `{"answer": …}` → `parseSolvedAnswer`, `numberVerdict` |
| grade-short | `practice/problems.ts` `gradeResponse` | grade a free-text answer (mcq/numeric graded in code) | chat | JSON `{correct, feedback}` |
| classify-error | `practice/problems.ts` `classifyError` | mistake type from a closed list | chat | JSON `{errorType, note}`, unknown → `other` |
| flashcards | `srs/generate.ts` `generateCards` | basic + cloze cards with a supporting quote | chat | JSON → `parseCards`, `locateQuote`, `expandCloze` |
| research-system | `research/prompts.ts` `DEFAULT_RESEARCH_SYSTEM_PROMPT` (user-editable setting) | system prompt for query/plan/rank | research | – |
| research-query | `research/prompts.ts` `buildQueryPrompt` | suggest what to search for in this space | research | text ≤30 words → `cleanQuery` |
| research-plan | `research/deepResearch.ts` `planQueries` | 3–5 queries + ISO language | research | JSON `{language, queries}` |
| research-rank | `research/deepResearch.ts` `rankPrompt` | relevance/credibility per page, batches of 4 | research | JSON → `applyRatings`, `filterAndSort` |
| research-gaps | `research/reportPrompts.ts` `gapPrompt` | what the kept sources miss, 0–3 new queries; rounds 2 and 3 | research | JSON `{gaps, queries}` → `parseGaps` (drops repeats, caps at 3) |
| research-report | `research/reportPrompts.ts` `reportPrompt` | cited Markdown report from the ticked sources | research | Markdown → `finishReport` (invented `[n]` removed, source list appended in code) |
| research-model-search | `research/reportPrompts.ts` `modelSearchPrompt` | ask the model's own web search for pages on the question | research (OpenRouter `:online`, OpenAI, Anthropic, Gemini, xAI tools) | URLs taken from provider citations only → `parseOpenRouterCitations`, `sourcesToResults` |
| step-check | `steps/check.ts` `stepCheckPrompt` | grade worked math steps; mathjs overrides | chat | JSON `{steps[], finalCorrect, summary}` → `parseModelVerdicts`, `mergeVerdicts` |
| vision-transcribe | `steps/vision.ts` `TRANSCRIBE_PROMPT` | read handwritten math from a photo | vision model | JSON `{problem, steps[]}` → `parseTranscription` |
| source-summary | `sources/summary.ts` | 2–3 sentence summary per source | chat | text |
| studio-outputs | `studio/prompts.ts` `outputPrompt` | reports, cheat sheets, worksheets, timelines, tables, mind maps, diagrams, slides, infographics, audio overview scripts | chat | JSON per kind → `parseOutput` |
| exam-questions-rich | `exam/generate.ts` `examQuestionPrompt` (sections with `kinds`, GED), pieces in `questions/prompts.ts` `questionKindsPrompt`, `STIMULUS_RULES` | exam questions of several kinds (mc, multi, fill, dropdown, drag, hotspot) with optional passage, table, chart or plane stimulus | chat, thinking off | JSON `[{topicId, kind, prompt, …}]` → `parseQuestions` (invalid questions dropped), `toQuiz` |
| worksheet | `worksheets/prompts.ts` `worksheetPrompt` | whole sheet in the chosen preset, language, size, task types, option count and label rules; German style names, Operatoren and Anforderungsbereiche | chat, thinking off | JSON `{title, instructions, tasks[]}` → `parseSheet` (drops unusable tasks, rescales points) → `checkKeys` hook |
| worksheet-task | `worksheets/prompts.ts` `regenerateTaskPrompt` | rewrite one task, avoiding the others' questions | chat | JSON task → `parseTask` |
| worksheet-open-grade | `worksheets/prompts.ts` `openGradePrompt` | grade open answers against key and rubric in steps of 0.5 with a one-sentence reason | chat | JSON `[{id, points, reason}]` → `gradeOpenParts` |
| worksheet-paper-read | `worksheets/prompts.ts` `paperReadPrompt` | read a photo of a filled paper sheet into "task.part: answer" lines | vision | JSON `{problem, steps[]}` → `parseTranscription` → `paperResponses` |
| audio-answer | `studio/prompts.ts` `audioAnswerPrompt` | hosts answer a listener's interruption | chat | JSON `{lines[]}` → `parseAudioAnswer` |

Deterministic guards already in code: citation numbers are filtered to real passages (`citations.ts`, `remarkCitations.ts`, `parseCheck`); math is re-checked with mathjs (`steps/verify.ts`) and every generated question is re-solved (`quality/answerCheck.ts`); every JSON parser validates enums, counts and ranges.

The e2e fake LLM (`src/test/mockBackend.ts`) recognises prompts by their opening text ("Solve this problem carefully", "You are a strict fact-checker", "Write ONE practice problem", …). Keep a prompt's first line when rewording it, or update the mock in the same commit.

### Rich questions and worksheets (new)

Not run yet (no live checks in this pass). `prompt-eval --only worksheets` has six cases: international en, Arbeitsblatt de, Klassenarbeit de (40 points), IHK de (100 points), GED en, US en (5 options, several correct, A B C). Checks: parsed, at least 3 tasks, point sum, language, option count, several keys for "multi". The solver check for keys comes from the answer-key check (`src/lib/quality/keyHook.ts` is the hook point until `answerCheck.ts` lands). Mock-backend replies match the first lines "Write a worksheet for a learner", "Rewrite ONE task of a worksheet", "You grade open answers on a worksheet" and, for exams, "Write questions of several kinds for a timed".

## Research

Sources read (2026-10-12):

1. Anthropic, Claude prompting best practices (platform.claude.com/docs/…/claude-prompting-best-practices): give the reason behind a rule; documents first, question last; tag each document with its source; quote relevant passages before answering; 3–5 varied examples; say what to do rather than what not to do.
2. Anthropic, Prompting Claude Sonnet 5.5: for JSON tasks that need reasoning, let the model think first but keep reasoning out of the visible reply; parse the last JSON value; treat `max_tokens` stops as failures.
3. Anthropic, Citations docs: pass sources as titled documents; citations are exact spans.
4. Anthropic, Define success criteria / develop tests: anchored 1–5 scales, binary checks for specific properties, a different model as grader.
5. OpenAI, GPT-4.1 prompting guide: later instructions win conflicts; every behaviour shown in an example must also be a stated rule; pair a mandatory action with a fallback; repeat key rules after long context.
6. Simon Willison on ChatGPT study mode, and the published study-mode / Gemini Guided Learning prompts (github.com/asgeirtj/system_prompts_leaks): one question per turn, two tries before revealing, a release valve after 2–3 failed attempts, no effusive praise, reply in the learner's language. Proprietary text: ideas only, nothing copied.
7. LearnLM: Improving Gemini for Learning (arXiv 2412.16429): split pedagogy into hard constraints and soft guidelines; vague guidelines get ignored; conditional rules work.
8. Unifying AI Tutor Evaluation, MRBench (arXiv 2412.09416): eight tutor dimensions (mistake identification and location, revealing the answer, guidance, actionability, coherence, tone, human-likeness); GPT-4 revealed the answer in ~47% of turns; small LLM judges correlate poorly with humans, so deterministic checks carry the weight.
9. Teaching an LLM Tutor to Withhold the Answer (arXiv 2608.12292): hint ladder with a code-enforced ceiling, deterministic leak detector before an LLM check; "ground every claim" made models invent citations, so cite only what was given this turn.
10. open-notebook and Khoj prompts (read, not copied): citation ids must be copied exactly and never invented; say so when the source text is missing.

Takeaways applied to Ponder's prompts:

- **Grounded chat:** numbered passages, then the rule; cite only numbers shown; a fixed behaviour when nothing matched; outside knowledge in `{{general}}` markers.
- **Socratic:** one guiding question per turn, never the final answer while the learner is still working, a release valve when they're stuck or ask directly (move one step, then explain), confirm correct steps plainly.
- **JSON contracts:** schema + example at the end, `Return JSON only`, closed enums with one-line definitions, a source quote field where grounding matters, parsers that validate rather than trust.
- **Graders:** solve or read the reference first, name the exact mistake and where, keep the learner-visible parts free of the answer.
- **Buddy/ADHD:** short, one next action, no throat-clearing, no inflated praise, conditional low-energy rules with the reason stated.
- **Language:** every learner-facing prompt says which language to write in (the learner's latest message, the material, or the question) and keeps quotes in their original language.

## Style guide

Every prompt in the app (and every prompt added later) follows these rules and gets cases in `scripts/prompt-eval.ts`.

1. **Open with the job in one sentence**, naming who reads the output ("for a learner", "for the app's parser"). Keep the first line stable once shipped (the mock backend matches it).
2. **Material before instructions, output contract last.** Wrap long material in `"""` or tags and label it (PASSAGES, PROBLEM, STEPS).
3. **State rules positively and give the reason** when it isn't obvious ("the learner sees issue and hint first, so they must not contain the corrected line").
4. **Hard constraints are short and checkable** (counts, word limits, enums, "one question"); soft guidance comes after them.
5. **Every mandatory behaviour has a fallback** ("if the passages don't contain the answer, say so and suggest a source").
6. **Language:** say exactly whose language to use. Learner-facing text never switches language on its own.
7. **Grounding:** only cite ids that appear in the prompt; mark anything else as general knowledge (chat) or leave it out (cards, quizzes, summaries).
8. **Tone:** plain and warm, no "Great question!", no filler, no guilt.
9. **JSON:** end with `Return JSON only:` and one example object using placeholder values; enums listed inline; the parser validates every field and the prompt never relies on the model getting a field right without a check.
10. **No requests for visible reasoning** in learner-facing output. Where a task needs computation (solve-check, step-check), ask the model to work it out before writing the JSON.
11. **Thinking off by default** for utility prompts (`llm.options({ thinking: false })`); the tutor uses the user's controls.

## Evaluation

`scripts/prompt-eval.ts` runs 15 prompts over 74 fixed cases (English and German, GED math, science, social studies and RLA material, plus German school/IHK topics). For each case it records:

- **Deterministic checks**: parse success, counts, word and sentence limits, language (stop-word heuristic), citation ids within range, answer leaks (regex on known answers), hint leaks, planted-error detection, strict-mode markers, banned praise, visible reasoning.
- **LLM judge**: `anthropic/claude-haiku-4.5` scores the dimensions that apply to the prompt (grounding, withholding, diagnosis, guidance, calibration, tone, language/format) on anchored 1–5 scales. The generator is `deepseek/deepseek-v4.1-flash`, so the judge is a different model family.

```
OPENROUTER_API_KEY=… bun scripts/prompt-eval.ts --samples 2 --out .native-bin/new.json
bun scripts/prompt-eval.ts --root <baseline worktree> --samples 2 --out .native-bin/old.json
bun scripts/prompt-eval.ts --compare .native-bin/old.json .native-bin/new.json
```

Not covered: vision-transcribe (needs photos of handwriting), tutor-history and second-opinion (same prompt as the tutor), practice-variation and solve-check (exercised inside practice-problem).

A rewrite is kept only when its judge mean is higher and its deterministic pass rate is not lower than the old prompt's on the same cases.

## Results (2026-10-12)

Baseline = the prompts before this pass; new = rewrites. 2 samples per case (practice-problem and classify-error re-run with 4 samples on both sides because the first run was close). deepseek-v4.1-flash generates, claude-haiku-4.5 judges.

| prompt | checks old → new | judge old → new | kept |
|---|---|---|---|
| tutor-system | 96% → 98% | 4.69 → 4.75 | yes: no opening praise or emoji; Socratic release valve (show the next step when stuck, explain after two failed tries); focus replies fit the minutes left (≤8 min: word budget of 30/min, 60–250); low energy under 100 words |
| buddy-instruction | 75% → 100% | 4.07 → 4.90 | yes: no praise, emoji or follow-up markers in buddy notes; word limits for session start (110) and post-break (90) |
| mcq-quiz | 90% → 100% | 4.25 → 4.79 | yes: "exactly N per topic, M in total", plus `capPerTopic` in code |
| step-check | 90% → 95% | 4.72 → 4.81 | yes: a worked example of an issue/hint that names the mistake without the corrected value |
| grade-short | 98% → 100% | 4.48 → 4.56 | yes: at most two plain sentences in the question's language |
| practice-problem | 97% → 96% (99% → 92% in the first run) | 4.40 → 4.61 | no: hint wording and "work it out first" lowered the check rate (more regenerations); reverted |
| classify-error | 94% → 93% | 4.60 → 4.77 | no: sharper type definitions didn't fix the 15%-of-80 case and added "units" answers; reverted |

Unchanged prompts moved by up to ±0.36 between runs (micro-steps 4.47 → 4.83, custom-curriculum 5.00 → 4.78, research-query 3.08 → 2.83), so judge differences under ~0.3 are noise; the check rate decides close calls.

### Voice tutor prompt (new, 2026-10-12)

`tutor-voice`: 5 cases (EN grounded, DE grounded, math in words, long request, Socratic), 2 samples, deepseek-v4.1-flash judged by claude-haiku-4.5. Checks 99% (word, sentence, question limits, no Markdown or LaTeX, language, citations, no emoji; one reply carried a `{{followup}}` line, which `runTurn` strips before the text is spoken), judge 4.06. The judge scores calibration 2 on replies that put a "want me to go on?" question after three sentences; the deterministic limits pass. Long requests: first part plus an offer to continue (5/5).

### Exam prompts (new, 2026-10-12)

| prompt | checks | judge | notes |
|---|---|---|---|
| exam-questions | 100% | 5.00 | per-topic counts, 4 options, no "all of the above", no figures |
| essay-task | 83% → 94% | 5.00 | first run reused an avoided issue; fixed with a random issue area per try and `repeatsIssue` rejection in code. One passage of 6 came in under 250 words (parser accepts ≥120) |
| essay-grade | 100% | 5.00 | strong essay 5–6, weak 0–2, off-topic 0 |

### Studio output prompts (new, 2026-10-12)

`studio-outputs`: one case per kind plus a German report and mind map, built from a 2-source photosynthesis set and a German civics script (`src/lib/studio/prompts.ts`).

| run | checks | judge | notes |
|---|---|---|---|
| first | 100% | 4.73 | table mixed stages, people and the equation in one table; timeline mixed history with process steps; German report padded short material to 400 words by repeating facts |
| after rewrite | 100% | 4.77 / 4.57 | report padding fixed ("or shorter when the material is short"); table usually one item type now but deepseek still mixes sometimes; timeline still mixes in the raw reply, so `parseOutput` keeps the larger group (steps vs dated events). The judge scores the raw reply, so it doesn't see that fix |

### Audio overview prompts (new, 2026-10-12)

Two-host script (`audio` kind, styles deep dive, brief, critique, debate) plus the "ask the hosts" interruption prompt. `prompt-eval --only studio-outputs` with deepseek-v4.1-flash, judged by claude-haiku-4.5: 13 cases, checks 98%, judge 4.74. Audio cases: brief en 5/3/5 (grounding/calibration/format; packs in two extra topics), deep dive de 5/5/5, debate en 5/5/5. The deep dive on the short German material came out at 431 words; the prompt now allows shorter deep dives for short material instead of padding, and the check accepts 300–1600 words.

Open findings for later passes: classify-error labels "15% of 80 = 1200" inconsistently (concept/procedure/units); practice-problem hints sometimes name an intermediate number; research-query scores low because the judge wants more specific queries than a ≤30-word suggestion allows; studio table sometimes mixes item types with deepseek-v4.1-flash.

## Context builder eval (2026-10-14)

`scripts/context-eval.ts` runs 43 questions on a copy of the real GED (221 sources), Robotics (240) and C (295) spaces through the old pipeline (latest message → 8 passages of ~800 chars, last 12 turns, passages in the system prompt) and the new one (`src/lib/context/`: source map, planned search, section/neighbour expansion, chapter references, reading tools, compaction). Same answer model (`deepseek/deepseek-v4.1-flash`, cost cap 200k tokens), judge `anthropic/claude-haiku-4.5`. Cases: 6 follow-ups, 7 "summarize chapter N / section N.M", 5 comparisons, 5 questions no keyword matches, 4 table/page facts, 12 plain, 3 threads of 30+ turns that refer back to turn 2, and one 200-turn thread across two compactions (cap 12k tokens) asking about turn 3. 9 cases are German.

| pipeline | correctness | source recall | citations valid | prompt tokens | $/answer | s/answer |
|---|---|---|---|---|---|---|
| old | 0.746 | 0.907 | 0.837 | 2.1k | 0.0006 | 6.7 |
| new (first run) | 0.895 | 1.000 | 0.883 | 106k | 0.016 | 21.6 |
| new + fixes (kept) | **0.947** | **1.000** | **0.898** | 107k | 0.017 | 20.2 |
| new + fixes, passages capped at 30k | 0.903 | 1.000 | 0.868 | 50k | 0.008 | 15.2 |

Per kind (old → kept): follow-ups 0.83 → 0.97, chapters 0.72 → 0.95, comparisons 0.91 → 0.98, no-keyword 0.81 → 0.97, tables 0.69 → 0.81, plain 0.84 → 0.94, long threads 0.21 → 1.00, 200-turn compaction 0.00 → 1.00.

Fixes after the first run: the learner's message is marked "My message (answer this)" after the passages (a follow-up was answered as the previous question), and source names with numbers ("University Physics Volume 1" vs "Volume 2") are told apart when resolving chapters. The 30k passage cap was cheaper and faster but lost on chapters and long threads, so the cap isn't used; the per-message cost cap (Settings → Models, default 200k for paid API models) is the limit.

Latency: building the context took 3–6 s in a debug build (remote query embedding 1–3 s, range reads ~1 s after batching per source; they were 4–6 s before), plus ~2 s for the search plan on follow-ups; the first answer token came 1–5 s later with ~110k-token prompts.
