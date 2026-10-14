# Roadmap: learning engine and GED fidelity



Outside the app: take the official GED Ready test per subject (ged.com) for a real baseline. The app's score is an estimate; GED Ready is the only official predictor.

## Order

1. GED fixes
2. Answer-key check
3. Rich questions
4. Confidence and mixed practice
5. Next (session engine)
6. Mastery retest
7. Mistake patterns
8. Score band
9. Essay grader calibration
10. Worked → faded examples
11. Goals without a date + goal → skill graph
12. NumPy in Python cells
13. Projects and build log
14. Lab cards


> Animation lines in this file are the minimum. `docs/redesign/07-motion-prominent.md` supersedes them (orbs for waits over 0.5 s, Libraries.dev effects per section 3, re-picked snippets, one metal CTA per screen).

## Animation sources

Same rules as `docs/redesign/04-motion.md`: one pick per spot, durations and easings from `--motion-*`, Reduce motion removes everything.

| Short | Source | How it's used in code |
|---|---|---|
| **TD** | transitions.dev free snippets | `src/styles/transitions/<slug>.css` classes (`.t-page-enter`, `.t-acc`, `.t-dropdown`…) and the hookups in `src/components/motion/` (`NumberPop`, `TextSwap`, `IconSwap`, `SuccessCheck`, `Reveal`/`Collapse`, `ThinkingLine`, `useShake`, `usePageSlide`, `useSlidingPill`, `LearnChevron`) |
| **TO** | thinking-orbs 0.3.2 | `ActivityOrb activity=…` (`search`, `think`, `write`, `cards`, `grade`, `plan`, `research`, `read`, `listen`). Only for AI or model waits of 2 s or more that have no text slot; under 2 s, nothing |
| **FX** | Libraries.dev accent effects: border-beam 1.4.1, metal-fx 2.0.11 | `ResearchBeam`, `MetalButton`. Decision 11 allows exactly two spots (deep-research panel, "Start session"), behind Visual effects. No new spots without a decision |
| own | `src/styles/app-motion.css` | Only where no TD snippet fits; uses `--motion-*` tokens so the global reduce rule covers it |

Not used anywhere new: the 11 rejected TD snippets (§7.1 of `04-motion.md`), including `spinning-counter`, `card-tilt`, `like-button` and `input-clear-dissolve`. Plots and live data never animate: values must be readable at once.

---

## 1. GED fixes (GED only)

- **What:** Math gets a no-calculator part (the first 5 questions, own timer split, calculator unlocks after it). Social Studies gets the calculator (the real test allows the reference calculator there). A formula sheet panel in Math and Science exams and in Math practice, matching the official GED formula sheet (area, perimeter, volume, surface area, slope, quadratic formula, Pythagorean theorem, simple interest, distance, total cost).
- **Where:** `src/lib/exam/formats.ts` (`parts` on a section: `[{ questions: 5, calculator: false }, { calculator: true }]`; Social Studies `calculator: true`), `src/features/exam/ExamScreen.tsx`, new `src/features/exam/FormulaSheet.tsx`, strings in `strings.ts`.
- **Animation:**
  - Formula sheet opens as a side panel: TD `panel-reveal` (`.t-panel-slide`, X axis, like Studio/Sources).
  - Calculator button while locked: TD `icon-swap` Lock → Calculator when Part 2 starts, label via TD `text-states-swap` ("Calculator after part 1" → "Calculator").
  - Part change: timer digits via TD `number-pop-in` (`NumberPop`, the `.m-timer` pattern focus already uses); next question TD `page-side-by-side` (`.t-page-enter`), as today.
- **Tests:** Vitest for part timing; e2e: calculator locked for 5 questions then available; formula sheet opens in Math and Science, not in RLA.

## 2. Answer-key check (generic)

- **What:** every generated question (exam, practice, quiz) is solved blind by a second call (other model if one is set, else the same model at temperature 0 with a solver prompt). Questions where the solver's answer differs, or where it finds two correct options, are dropped and regenerated once. The exam header can show "3 questions replaced".
- **Where:** new `src/lib/quality/answerCheck.ts` used by `src/lib/exam/generate.ts`, `src/lib/practice/problems.ts`, `src/lib/srs/quizSpace.ts`. Setting in Settings → Models ("Check answer keys", default on). Prompts go into `docs/PROMPTS.md` and the eval harness.
- **Animation:**
  - While checking (seconds per batch): TO `grade` (solving) in the existing generation row, same size as today.
  - "N questions replaced": TD `number-pop-in` for N, label via TD `text-states-swap`.
- **Tests:** Vitest with a scripted mock model (agree, disagree, two correct); `prompt-eval.ts` cases for the solver prompt.

## 3. Rich questions (generic)

- **What:** one question schema for all practice, quizzes and exams:
  - `kind`: `mc` | `multi` (select all) | `fill` (number or short text) | `dropdown` (inline selects in a sentence or passage; RLA editing) | `drag` (order items or drop into categories) | `hotspot` (click a point on a coordinate plane, chart or table cell).
  - `stimulus`: `passage`, `table`, `chart` (bar, line, scatter, from data), `plane` (coordinate plane from the plot engine). Science and Social Studies questions are built around these. Maps and photos are out (can't be generated reliably); they become tables or text.
  - Grading per kind in one function; partial credit for `multi` and `drag` where the exam scores it.
- **Where:** `src/lib/questions/` (schema, `grade.ts`, generation prompt pieces shared by exam/practice/quiz), `src/components/questions/` (one renderer per kind + `Stimulus.tsx`), chart drawing in `src/lib/plot/` (new `charts.ts` for bar/line/scatter from data, reusing `ticks.ts` and `draw.ts`). Exam attempts and practice answers store `kind` and the raw response (new migration `016_questions.sql`).
- **Animation:**
  - Next question: TD `page-side-by-side` (`.t-page-enter`), as today.
  - `mc` / `multi` picks: unchanged; `multi` boxes use TD `checkbox-check` (`.t-check`).
  - `dropdown`: Radix menu with TD `menu-dropdown` (`.t-dropdown`).
  - `fill`: TD `.t-input`; wrong → TD `error-state-shake` (`useShake`); right → TD `success-check` (`SuccessCheck`).
  - `drag`: lifting and dropping is own (`.m-drag-lift`, `.m-drop-settle` in `app-motion.css`: scale 1.02 + shadow token while held, settle with `--motion-fast`). Keyboard alternative (pick up with Space, move with arrows) with no motion difference.
  - `hotspot`: the placed marker is own (`.m-hotspot-pin`: scale-in with `--motion-fast`); after checking, the correct region fades in (own opacity transition) and the marker gets TD `success-check` or TD `error-state-shake`.
  - Stimulus loading (chart data being generated): TD `skeleton-reveal` (`Skeleton` → `.t-skel` cross-fade) in a fixed-size slot.
  - Generating the question set: TO `write` (composing), as practice does today.
  - Explanation after answering: TD `accordion` (`Collapse`), like practice's "Why?".
- **Tests:** Vitest per kind (grading, partial credit, generation JSON validation); e2e per kind with keyboard and mouse; design-diff for any changed artboard (practice, exam).

## 4. Confidence and mixed practice (generic)

- **What:**
  - Before submitting any practice answer, exam answer (practice mode only, not timed mocks) or card review, a 3-step "How sure?" (Guess · Unsure · Sure). One key each (G/U/S); skippable in Low energy.
  - Calibration in Insights: per topic, how often "Sure" was right; overconfident topics get extra review.
  - Practice draws from several topics by default ("Mixed"), including due reviews; single-topic practice stays as an option.
- **Where:** `src/lib/practice/` (mixer in a new `mix.ts`), `src/lib/srs/scheduler.ts` (confidence feeds FSRS: a wrong "Sure" lapses harder), `src/lib/insights/analytics.ts` (calibration), migration `017_confidence.sql` (column on practice answers, card reviews, exam answers).
- **Animation:**
  - "How sure?" control: `Segmented` with TD `tabs-sliding` (`useSlidingPill`), like every other segmented control.
  - Topic tag shown on each mixed question: TD `text-states-swap` when it changes.
  - Calibration numbers in Insights: TD `number-pop-in` on load; chart bars don't animate.
- **Tests:** Vitest for the mixer (no topic twice in a row unless only one is due) and calibration math; e2e for G/U/S keys.

## 5. Next (session engine, generic)

- **What:** one button that answers "what do I do now". `next(goal, minutesAvailable)` returns a short list of blocks:
  - warm-up retrieval (due cards and retests),
  - new material (the frontier topic in the skill graph, worked example first; see 10),
  - mixed practice (4),
  - a 1-minute reflection (Explain it back on one item, or "what was hardest?").
  The list adapts to energy (Low energy drops new material) and to the plan's Today tasks when a plan exists. It replaces the decision, not the existing screens: each block opens the screen that already exists.
- **Where:** new `src/lib/session/engine.ts` (pure, unit-tested; inputs from `srs`, `plan`, `insights`, `practice`), `src/features/session/` (Next card on Home and in the space header, block runner), ⌘K "Next", a Focus session can start from it.
- **Animation:**
  - Block to block: TD `page-side-by-side` (`.t-page-enter`).
  - Block checklist: TD `checkbox-check`; block done: TD `success-check`.
  - "Next: …" label on the card: TD `text-states-swap`; total minutes: TD `number-pop-in`.
  - Start button: **open decision.** Next starts a session, which is what "Start session" did; reusing FX `MetalButton` there keeps decision 11 at two spots only if it replaces the old button rather than adding a third.
  - No orb: `next()` is local and instant.
- **Tests:** Vitest for block selection (due cards first, Low energy, empty goal, nothing due); e2e: Home → Next → runs through blocks; design-diff with a `USER_DEVIATIONS` entry for the Home card.

## 6. Mastery retest (generic)

- **What:** a topic only counts as mastered after a passing mixed check at least 3 days after it was learned. Retests are scheduled into Next and Review. Wrong answers in a topic also queue its prerequisite (from the skill graph or curriculum) for a short check. Locked topics on the mastery map show what they wait for.
- **Where:** `src/lib/insights/analytics.ts` (mastery state), `src/lib/session/engine.ts` (retests), `src/lib/placement/` (prerequisite edges), migration `018_mastery.sql` (per-topic evidence: last learned, retest due, passed at).
- **Animation:**
  - Topic becomes mastered: TD `success-check` on the row + TD `number-pop-in` on the mastered count.
  - Topic unlocks: TD `icon-swap` Lock → topic icon.
  - Retests due add to the sidebar Review count, which already uses TD `notification-badge`.
  - Mastery-map node colour change: own (fill transition with `--motion-base`).
- **Tests:** Vitest for the state machine (learned → retest due → mastered / back to learning); e2e with `__mock.advance()` over 3 days.

## 7. Mistake patterns (generic)

- **What:** after each mock and weekly from practice, group wrong answers by error type (misread the question, unit/sign slip, trap option, missing concept, ran out of time), with examples and one "Practice this" per pattern that feeds Next. Uses the existing mistake notebook.
- **Where:** `src/lib/srs/mistakes.ts` (tagging), new `src/lib/insights/patterns.ts`, a Patterns section in Insights and on the exam result screen.
- **Animation:**
  - Tagging the attempt (model call): TO `think` (breathing) in the result section.
  - Pattern list appearing: TD `texts-reveal` (`.t-stagger`).
  - Examples per pattern: TD `accordion`.
  - "Practice this" rows: TD `learn-more-hover` (`LearnChevron`).
- **Tests:** Vitest for grouping; e2e: finish a mock with scripted wrong answers → patterns shown.

## 8. Score band (generic)

- **What:** exam results show a range and a tier instead of one number, e.g. "172–184 · College Ready". The range comes from the number of questions and from how many attempts the estimate is based on; it narrows over mocks. Tiers come from the exam format (GED: 145 pass, 165 College Ready, 175 College Ready + Credit). Text says it's an estimate and points to GED Ready.
- **Where:** `src/lib/exam/formats.ts` (`tiers`), `src/lib/exam/attempt.ts` (band), the result screen and Insights readiness.
- **Animation:** band numbers TD `number-pop-in`; tier label TD `text-states-swap` when it changes between mocks.
- **Tests:** Vitest for band width (fewer questions → wider) and tier lookup.

## 9. Essay grader calibration (generic: any rubric)

- **What:** a check that runs the RLA grader over the scored sample essays GED publishes and reports agreement per trait. Grading uses temperature 0 and two passes; if they differ by more than one point on a trait, a third pass decides. Same harness works for any rubric (IHK, SAT essays later).
- **Where:** `src/lib/exam/essay.ts`, cases in `scripts/prompt-eval.ts` (anchor essays as eval data, not shipped in the app), results in `docs/PROMPTS.md`.
- **Animation:** grading in the app keeps its current TO `grade`; the harness is a script, no UI.
- **Tests:** eval run with the anchor set; Vitest for the two-pass merge.

## 10. Worked → faded examples (generic)

- **What:** per topic, a ladder: a fully worked example, then a near-identical problem with the last steps blank, then one with most steps blank, then a cold problem. Moving up needs a correct answer; a miss steps down once. The step checker grades the blanks.
- **Where:** `src/lib/practice/ladder.ts`, generation in `src/lib/practice/problems.ts`, UI in `src/features/practice/`.
- **Animation:**
  - Rung change: TD `page-side-by-side`.
  - Worked steps: TD `accordion` (like the worked solution today).
  - Blanks: TD `.t-input` + `error-state-shake` / `success-check`.
  - Rung indicator: own `.m-progress` (already in `app-motion.css`).
  - Generating the next rung: TO `write`.
- **Tests:** Vitest for ladder moves; e2e through all rungs with the mock model.

## 11. Goals without a date + goal → skill graph (generic)

- **What:**
  - A Goal is an exam with a date or a skill without one ("build a robot arm"). Without a date, the schedule runs on weekly minutes and milestones instead of a countdown.
  - "What do you want to learn?": one sentence → the model proposes a skill graph (topics with prerequisites, from fundamentals up) → you edit it (remove, rename, mark "I know this") → each topic gets "Find sources" via deep research, preferring free material (OpenStax, MIT OCW, official docs). Bundled curricula and pasted syllabi become two more ways to seed the same graph.
- **Where:** `src/lib/plan/schedule.ts` (date optional), `src/lib/placement/` (merge `curricula.ts` and the custom syllabus path into one graph builder), new `src/features/goal/GoalWizard.tsx` (from the empty space state and New space), migration `019_goals.sql`.
- **Animation:**
  - Wizard: TD `modal`; its steps TD `page-side-by-side`.
  - Building the graph: TO `plan` (weaving), same as the syllabus plan today.
  - Proposed topics appearing: TD `texts-reveal`; edit checkboxes TD `checkbox-check`.
  - Finding sources per topic: TO `research` per row; the deep-research panel keeps its FX `ResearchBeam`.
  - Schedule header with or without a date: TD `text-states-swap` ("exam in 52 days" ↔ "3 h a week").
- **Tests:** Vitest for graph validation (no cycles, every prerequisite exists) and dateless scheduling; e2e: empty space → wizard → graph → schedule.

## 12. NumPy in Python cells (generic: any quantitative subject)

- **What:** bundle `numpy`, `matplotlib` and `sympy` wheels with Pyodide (offline). Matplotlib figures render as cell output. SymPy lets the step checker handle derivatives, matrices and simplification.
- **Where:** `scripts/vite-pyodide.ts` (file list; per CLAUDE.md, check it when bumping), `src/lib/codecell/pyWorker.ts` (`loadPackage` from the bundled files), `src/lib/steps/` (SymPy path).
- **Animation:** first package load (several seconds): TO `plan` (weaving, as the search model load uses) + TD `text-states-swap` "Loading NumPy…" → "Ready"; figure output TD `skeleton-reveal`.
- **Tests:** Vitest can't run Pyodide; e2e runs a NumPy cell and a Matplotlib figure. Note bundle size in HANDOFF.

## 13. Projects and build log (generic: any hands-on skill)

- **What:** a project in a space: milestones linked to skill-graph topics, dated log entries with photos, notes and code results. A milestone whose topics aren't mastered says "blocked on X → study X" and feeds Next.
- **Where:** `src-tauri/src/projects.rs` + migration `020_projects.sql`, `src/features/projects/`, photos stored like capture images.
- **Animation:**
  - New log entry: TD `panel-reveal` (in-flow new row).
  - Milestone done: TD `checkbox-check` + `success-check`.
  - Photo thumbnails: TD `skeleton-reveal`.
  - "Blocked on X" rows: TD `learn-more-hover`.
- **Tests:** cargo tests for the model; e2e: create project, log entry, milestone blocked → Next suggests the topic.

## 14. Lab cards (generic: physics, control, statistics, economics)

- **What:** saved interactive models with sliders and a live plot (PID step response, pendulum, 2-link arm, supply/demand). Built from an explainer, then kept, versioned per space and reopenable from chat.
- **Where:** `src/lib/studio/` (explainer → lab card), stored with Studio outputs.
- **Animation:**
  - Open a lab card: TD `page-side-by-side`.
  - Making one: TO `write`.
  - Slider moves and plot updates: none (instant, it's data).
- **Tests:** Vitest for parameter persistence; e2e: create, edit a slider, reopen.

---

## Open decisions

- **Next button and metal-fx:** reuse `MetalButton` on Next only if Next replaces "Start session" (keeps decision 11 at two accent spots).
- **Mixed practice as the default:** recommended; single-topic stays one click away.
- **Clutter:** the generic-architecture review flagged several Studio formats, video export and ambient sound as low learning value. Proposal: keep them, move the rarely used Studio formats behind "More" in Create.
