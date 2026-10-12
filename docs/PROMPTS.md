# Prompts

Every prompt the app sends to a model, what each one must return, the style rules new prompts follow, and how they are evaluated (`scripts/prompt-eval.ts`).

## Inventory

All calls go through `generateText`/`streamText` from the `ai` SDK; there is no structured-output mode. "chat" = `resolveChatModel` (space override → app default → first provider). "research" = `resolveResearch` (research model setting → chat). Every call except the main tutor turn runs with thinking off (`callOptions`, `providers/model.ts`).

| id | where (src/lib unless noted) | purpose | model | output → parser |
|---|---|---|---|---|
| tutor-system | `chat/context.ts` `buildSystemPrompt`, tutor styles `TUTOR`, `describeFocus` | main tutor reply | chat + user's thinking controls | Markdown/LaTeX, `[n]` citations, `{{general}}…{{/general}}`, `{{remember: …}}`, `{{followup: …}}` → `extractFollowUps`, `extractMemories`, `citations.ts`, `remarkCitations.ts` |
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
| practice-solve-check | `practice/problems.ts` `solveIndependently` | re-solve without the key; disagreements regenerate (3 tries) | chat | last `{"answer": …}` → `parseSolvedAnswer`, `answersAgree` |
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
| audio-answer | `studio/prompts.ts` `audioAnswerPrompt` | hosts answer a listener's interruption | chat | JSON `{lines[]}` → `parseAudioAnswer` |

Deterministic guards already in code: citation numbers are filtered to real passages (`citations.ts`, `remarkCitations.ts`, `parseCheck`); math is re-checked with mathjs (`steps/verify.ts`) and practice answers are re-solved; every JSON parser validates enums, counts and ranges.

The e2e fake LLM (`src/test/mockBackend.ts`) recognises prompts by their opening text ("Solve this problem carefully", "You are a strict fact-checker", "Write ONE practice problem", …). Keep a prompt's first line when rewording it, or update the mock in the same commit.

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
