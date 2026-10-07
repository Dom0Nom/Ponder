import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Camera, Lightbulb, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { invalidateCards, qk } from "../../lib/queries";
import { updateTheta } from "../../lib/practice/irt";
import { advance, firstSentence, INLINE_TOTAL, isDone, makeInlineProblem, rightCount, setResult, splitDisplayMath } from "../../lib/practice/inline";
import { classifyError, gradeResponse, type Grade } from "../../lib/practice/problems";
import { s } from "../../lib/strings";
import type { InlinePracticeMeta, Message, PracticeItem, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { Skeleton } from "../../components/ui/misc";
import { Collapse, Reveal } from "../../components/motion/Reveal";
import { SuccessCheck } from "../../components/motion/SuccessCheck";
import { useShake } from "../../components/motion/useShake";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { toastError } from "../../components/ui/toast";
import { StepCheckerDialog } from "../steps/StepChecker";
import { Markdown } from "./Markdown";

const headBtn = "flex h-[26px] items-center gap-1.5 rounded-btn px-[9px] font-medium text-fg hover:bg-fill";
const resultBtn = "flex h-[30px] items-center gap-1.5 rounded-btn px-2.5 font-medium";

interface Checked {
  grade: Grade;
  response: string;
}

function Dashes({ meta }: { meta: InlinePracticeMeta }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: meta.total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 w-4 rounded-[2px] transition-colors duration-(--motion-fast) ease-smooth",
            i < meta.index ? "bg-fg" : i === meta.index ? (meta.results[i] === "right" ? "bg-fg" : "bg-faint") : "bg-field",
          )}
        />
      ))}
    </span>
  );
}

export function InlinePractice({ message, space }: { message: Message; space: Space }) {
  const meta = message.meta?.practice;
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const [response, setResponse] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<"grade" | "next" | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const next = useRef<Promise<PracticeItem> | null>(null);
  const shake = useShake();

  if (!meta) return null;
  const item = meta.items[meta.index];
  const topic = { key: meta.topicKey, title: meta.topicTitle, description: meta.topicTitle };

  const save = async (patch: InlinePracticeMeta) => {
    await api.updateMessage(message.id, { meta: { ...message.meta, practice: patch } });
    qc.invalidateQueries({ queryKey: qk.messages(message.threadId) });
  };

  const prefetch = () => {
    if (meta.index + 1 >= meta.total || meta.items[meta.index + 1] || next.current) return;
    const context = meta.items.map((i) => i.question).join("\n");
    next.current = makeInlineProblem({ spaceId: space.id, space, topic, context: `Earlier problems (write a different one):\n${context}` });
    next.current.catch(() => {});
  };

  const reset = () => {
    setResponse("");
    setChecked(null);
    setHintOpen(false);
    setWhyOpen(false);
    shake.reset();
  };

  const goNext = async (record?: "skipped") => {
    let cur = meta;
    if (record && cur.results[cur.index] === undefined) cur = setResult(cur, cur.index, record);
    const following = advance(cur);
    if (isDone(following)) {
      await save(following);
      reset();
      return;
    }
    setBusy("next");
    try {
      const nextItem = cur.items[cur.index + 1] ?? (await (next.current ?? makeInlineProblem({ spaceId: space.id, space, topic, context: cur.items.map((i) => i.question).join("\n") })));
      next.current = null;
      await save({ ...following, items: cur.items[cur.index + 1] ? cur.items : [...cur.items, nextItem] });
      reset();
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.practice.inlineFailed, e);
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    const given = response.trim();
    if (!item || !given) return;
    setBusy("grade");
    try {
      const llm = await resolveChatModel(space);
      const ability = await api.abilityGet(space.id, meta.topicKey);
      const theta = ability?.theta ?? 0;
      const n = ability?.n ?? 0;
      const grade = await gradeResponse(llm, item, given);
      const correctText = item.kind === "mcq" ? item.options![Number(item.answer)] : item.answer;
      const givenText = item.kind === "mcq" ? (item.options![Number(given)] ?? given) : given;
      let errorType = null;
      let errorNote: string | null = null;
      if (!grade.correct) {
        const c = await classifyError(llm, { question: item.question, answer: correctText, solution: item.solution }, givenText).catch(() => null);
        errorType = c?.errorType ?? null;
        errorNote = c?.note ?? null;
      }
      await api.practiceAttempt(space.id, {
        itemId: item.id,
        topicKey: meta.topicKey,
        topicTitle: meta.topicTitle,
        response: givenText,
        correct: grade.correct,
        thetaBefore: theta,
        thetaAfter: updateTheta(theta, item.difficulty, grade.correct, n),
        errorType,
      });
      if (!grade.correct) {
        const [m] = await api.mistakesAdd(space.id, [
          {
            origin: "practice",
            question: item.question,
            given: givenText,
            correct: correctText,
            explanation: errorNote ?? item.solution.slice(0, 600),
            topic: meta.topicTitle,
            options: item.options,
          },
        ]);
        if (errorType) await api.mistakeSetErrorType(m.id, errorType);
        invalidateCards(space.id);
      }
      qc.invalidateQueries({ queryKey: ["abilities", space.id] });
      qc.invalidateQueries({ queryKey: ["errorPatterns"] });
      setChecked({ grade, response: given });
      if (!grade.correct) shake.shake();
      await save(setResult(meta, meta.index, grade.correct ? "right" : "wrong"));
      prefetch();
    } catch (e) {
      toastError(s.practice.gradeFailed, e, check);
    } finally {
      setBusy(null);
    }
  };

  if (isDone(meta)) {
    return (
      <div className="overflow-hidden rounded-card border border-field bg-surface" data-testid="inline-practice">
        <div className="flex items-center gap-2.5 py-2.5 pl-4 pr-3">
          <span className="font-semibold">{s.practice.inlineTitle}</span>
          <Dashes meta={meta} />
          <span className="font-medium text-muted" data-testid="inline-practice-done">
            {s.practice.inlineDone(rightCount(meta), meta.total)}
          </span>
          <button
            className={cn(headBtn, "ml-auto")}
            onClick={() => navigate({ name: "practice", spaceId: space.id, topicKey: meta.topicKey, topicTitle: meta.topicTitle })}
          >
            {s.practice.keepPracticing} <ArrowRight size={13} />
          </button>
        </div>
      </div>
    );
  }

  const correct = checked?.grade.correct;
  const parts = item ? splitDisplayMath(item.question) : [];

  return (
    <div className="overflow-hidden rounded-card border border-field bg-surface" data-testid="inline-practice">
      <div className="flex items-center gap-2.5 border-b border-divider py-2.5 pl-4 pr-3">
        <span className="font-semibold">{s.practice.inlineTitle}</span>
        <Dashes meta={meta} />
        <span className="font-medium text-muted">{s.practice.inlineProgress(meta.index + 1, meta.total || INLINE_TOTAL)}</span>
        {item?.hint && (
          <button className={cn(headBtn, "ml-auto", hintOpen && "bg-fill-active")} aria-pressed={hintOpen} onClick={() => setHintOpen(!hintOpen)}>
            <Lightbulb size={13} /> {s.practice.hint}
          </button>
        )}
        <button className={cn(headBtn, !item?.hint && "ml-auto")} disabled={busy === "next"} onClick={() => goNext("skipped")}>
          {s.practice.skip}
        </button>
      </div>
      {!item || busy === "next" ? (
        <div className="flex flex-col gap-3 px-4 py-3.5" aria-live="polite">
          <GeneratingStatus label={s.practice.writing} className="text-muted" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {parts.map((p, i) =>
            p.kind === "math" ? (
              <div key={i} className="flex justify-center rounded-btn bg-fill-subtle py-[18px] text-title-sm [&_.prose-chat]:leading-[1.45] [&_.katex-display]:!my-0 [&_.katex-display]:!py-0">
                <Markdown text={p.text} />
              </div>
            ) : (
              <div key={i} className="text-input leading-[1.45] [&_.prose-chat]:leading-[1.45]" data-testid="inline-practice-question">
                <Markdown text={p.text} />
              </div>
            ),
          )}
          {item.hint && (
            <Collapse open={hintOpen} noblur>
              <p className="flex gap-2 text-body leading-[1.5] text-fg-secondary" data-testid="inline-practice-hint">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-fg" />
                {item.hint}
              </p>
            </Collapse>
          )}
          {item.kind === "mcq" && (
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={item.question}>
              {item.options!.map((o, i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={response === String(i)}
                  disabled={!!checked}
                  onClick={() => setResponse(String(i))}
                  {...(checked && !correct && response === String(i) ? shake.props : {})}
                  className={cn(
                    "flex min-h-9 items-center rounded-btn border px-3 text-left text-input",
                    shake.cls(checked && !correct && response === String(i)),
                    checked && String(i) === item.answer
                      ? "border-success"
                      : checked && response === String(i)
                        ? "border-danger"
                        : response === String(i)
                          ? "border-fg bg-fill-active font-semibold"
                          : "border-control hover:bg-fill",
                  )}
                >
                  <Markdown text={o} />
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!checked) check();
            }}
          >
            {item.kind !== "mcq" && (
              <input
                value={response}
                disabled={!!checked}
                onChange={(e) => setResponse(e.target.value)}
                placeholder={s.practice.answerPlaceholder}
                aria-label={s.practice.yourAnswer}
                {...shake.props}
                className={cn(
                  shake.cls(checked && !correct),
                  "h-9 min-w-0 flex-1 rounded-btn border bg-surface px-3 text-input outline-none placeholder:text-faint",
                  checked ? (correct ? "border-success" : "border-danger") : "border-control focus:border-fg",
                )}
              />
            )}
            {item.kind === "mcq" && <span className="flex-1" />}
            {!checked && (
              <button
                type="submit"
                disabled={!response.trim() || busy === "grade"}
                className="flex h-9 items-center gap-2.5 rounded-btn bg-primary px-3.5 font-medium text-on-primary hover:bg-primary-hover disabled:cursor-default"
              >
                {s.practice.check}
                <span className="text-kbd text-on-primary-muted">↵</span>
              </button>
            )}
            <button
              type="button"
              title={s.practice.photo}
              aria-label={s.practice.photo}
              onClick={() => setStepsOpen(true)}
              className="flex size-9 shrink-0 items-center justify-center rounded-btn border border-control hover:bg-fill"
            >
              <Camera size={15} />
            </button>
          </form>
          {busy === "grade" && <GeneratingStatus label={s.practice.grading} className="text-muted" />}
        </div>
      )}
      {checked && item && (
        <Reveal
          data-testid="inline-practice-result"
          className={cn(
            "flex items-center gap-3 border-t py-3 pl-4 pr-3",
            correct ? "border-success-border bg-success-soft" : "border-danger-border bg-danger-soft",
          )}
        >
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", correct ? "bg-success text-on-success" : "bg-danger text-on-danger")}>
            {correct ? <SuccessCheck size={14} /> : <X size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("font-semibold", correct ? "text-success-text" : "text-danger-text")}>
              {correct ? (item.kind === "numeric" ? s.practice.correctAnswer(item.answer) : s.practice.correct) : s.practice.notQuite}
            </p>
            <p className={cn("text-caption", correct ? "text-success-text-2" : "text-danger-text-2")}>
              {correct ? firstSentence(item.solution) : (checked.grade.feedback ?? firstSentence(item.solution))}
            </p>
          </div>
          {correct ? (
            <>
              <button className={cn(resultBtn, "text-success-text hover:bg-success-soft-hover")} onClick={() => setWhyOpen(!whyOpen)}>
                {s.practice.why}
              </button>
              <button className={cn(resultBtn, "bg-success px-3 text-on-success")} disabled={busy === "next"} onClick={() => goNext()}>
                {s.practice.continue} <ArrowRight size={13} />
              </button>
            </>
          ) : (
            <>
              <button className={cn(resultBtn, "text-danger-text hover:bg-danger-soft-hover")} onClick={() => setStepsOpen(true)}>
                {s.practice.showSteps}
              </button>
              <button
                className={cn(resultBtn, "bg-danger text-on-danger")}
                onClick={() => {
                  setChecked(null);
                  setResponse("");
                }}
              >
                {s.practice.tryAgain}
              </button>
            </>
          )}
        </Reveal>
      )}
      {checked && item && (
        <Collapse open={whyOpen} noblur>
          <div className="border-t border-divider px-4 py-3.5 text-input" data-testid="inline-practice-why">
            <Markdown text={item.solution} />
          </div>
        </Collapse>
      )}
      {item && (
        <StepCheckerDialog open={stepsOpen} onOpenChange={setStepsOpen} spaceId={space.id} problem={item.question} expectedAnswer={item.answer} />
      )}
    </div>
  );
}
