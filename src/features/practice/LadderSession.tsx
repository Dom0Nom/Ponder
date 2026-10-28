import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleX } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { targetDifficulty, updateTheta } from "../../lib/practice/irt";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { RUNGS, blankOutcome, blanksFor, countsTowardAbility, nextRung, type LadderProblem, type Rung } from "../../lib/practice/ladder";
import { generateLadderProblem, gradeBlanks, gradeResponse, ladderAsItem, type TopicSpec } from "../../lib/practice/problems";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { Collapse, Reveal } from "../../components/motion/Reveal";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { useShake } from "../../components/motion/useShake";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ErrorState } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Markdown } from "../chat/Markdown";

const RUNG_NAMES = [s.ladder.rungNames.worked, s.ladder.rungNames.lastBlank, s.ladder.rungNames.mostBlank, s.ladder.rungNames.cold];

interface Outcome {
  correct: boolean;
  results: boolean[];
  from: Rung;
  to: Rung;
}

export function LadderSession({ space, topic, language, onExit }: { space: Space; topic: TopicSpec; language?: string; onExit: () => void }) {
  const [rung, setRung] = useState<Rung>(0);
  const [problem, setProblem] = useState<LadderProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [fills, setFills] = useState<Record<number, string>>({});
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [dir, setDir] = useState(1);
  const shake = useShake();
  const qc = useQueryClient();
  const recorded = useRef<string | null>(null);
  const last = useRef<LadderProblem | undefined>(undefined);

  const load = async (target: Rung, like?: LadderProblem) => {
    setLoading(true);
    setError(null);
    try {
      const llm = await resolveChatModel(space);
      const p = await generateLadderProblem(llm, { topic, rung: target, like, level: 2 + target, language: language ?? space.language });
      last.current = p;
      setProblem(p);
      setRung(target);
      setFills({});
      setAnswer("");
      setOutcome(null);
      shake.reset();
    } catch (e) {
      setError(e instanceof NoModelError ? new Error(s.chat.noModel) : e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blanks = problem ? blanksFor(rung, problem.steps.length) : [];
  const cold = rung === 3;
  const ready = cold ? answer.trim().length > 0 : blanks.length > 0 && blanks.every((i) => (fills[i] ?? "").trim());

  const recordCold = async (p: LadderProblem, given: string, correct: boolean) => {
    const ability = await api.abilityGet(space.id, topic.key);
    const theta = ability?.theta ?? 0;
    const n = ability?.n ?? 0;
    const difficulty = targetDifficulty(theta);
    const item = await api.practiceItemAdd(space.id, { ...ladderAsItem(p, topic.key), difficulty });
    await api.practiceAttempt(space.id, {
      itemId: item.id,
      topicKey: topic.key,
      topicTitle: topic.title,
      response: given,
      correct,
      thetaBefore: theta,
      thetaAfter: updateTheta(theta, difficulty, correct, n),
    });
    qc.invalidateQueries({ queryKey: ["abilities", space.id] });
  };

  const check = async () => {
    if (!problem || !ready || outcome) return;
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      let results: boolean[];
      if (cold) {
        const correct = (await gradeResponse(llm, ladderAsItem(problem, topic.key), answer.trim())).correct;
        results = [correct];
        if (countsTowardAbility(rung) && recorded.current !== problem.question) {
          await recordCold(problem, answer.trim(), correct);
          recorded.current = problem.question;
        }
      }
      else results = await gradeBlanks(llm, problem, blanks.map((index) => ({ index, response: fills[index] ?? "" })));
      const correct = blankOutcome(results);
      setOutcome({ correct, results, from: rung, to: nextRung(rung, correct) });
      if (!correct) shake.shake();
    } catch (e) {
      toastError(s.ladder.checkFailed, e, check);
    } finally {
      setBusy(false);
    }
  };

  const go = (to: Rung) => {
    setDir(to >= rung ? 1 : -1);
    void load(to, last.current);
  };

  const mastered = outcome?.correct && outcome.from === 3;

  return (
    <div className="h-full overflow-y-auto" data-testid="ladder-session">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-10 pb-12 pt-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="-ms-[9px]" onClick={onExit}>
            <ArrowLeft size={14} className="rtl:rotate-180" /> {s.ladder.back}
          </Button>
          <span className="text-body font-semibold">{s.ladder.title(topic.title)}</span>
        </div>

        <div className="flex flex-col gap-1.5" data-testid="ladder-rung" data-rung={rung}>
          <div className="flex items-center gap-2 text-label text-muted">
            <span className="font-medium text-fg">{RUNG_NAMES[rung]}</span>
            <span className="ms-auto tabular-nums">{s.ladder.rung(rung + 1, RUNGS)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill-faint" role="progressbar" aria-valuemin={1} aria-valuemax={RUNGS} aria-valuenow={rung + 1}>
            <div className="m-progress h-full rounded-full bg-primary" style={{ width: `${((rung + 1) / RUNGS) * 100}%` }} />
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 py-8 text-muted" aria-live="polite">
            <ActivityOrb activity="write" size={32} />
            <span>{s.ladder.writing}</span>
          </div>
        )}
        {error != null && !loading && <ErrorState title={s.ladder.loadFailed} error={error} onRetry={() => void load(rung, last.current)} />}

        {problem && !loading && (
          <div key={`${rung}-${problem.question}`} className="t-page-enter flex flex-col gap-[18px]" style={{ ["--t-page-dir" as string]: dir }}>
            <div className="text-[1.125rem] font-medium leading-[1.5] [&_.prose-chat]:leading-[1.5]" data-testid="ladder-question">
              <Markdown text={problem.question} />
            </div>

            {rung === 0 && <p className="text-muted">{s.ladder.workedHelp}</p>}
            {cold && <p className="text-muted">{s.ladder.coldHelp}</p>}

            {!cold && (
              <ol className="flex flex-col gap-2.5" data-testid="ladder-steps">
                {problem.steps.map((text, i) => {
                  const blank = blanks.includes(i);
                  const verdict = outcome ? outcome.results[blanks.indexOf(i)] : undefined;
                  return (
                    <li key={i} className="flex items-start gap-3" data-testid={blank ? `ladder-blank-${i}` : `ladder-step-${i}`}>
                      <span className="mt-[7px] w-5 shrink-0 text-label tabular-nums text-muted">{i + 1}</span>
                      {blank ? (
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <Input
                            value={fills[i] ?? ""}
                            disabled={!!outcome}
                            onChange={(e) => setFills({ ...fills, [i]: e.target.value })}
                            {...shake.props}
                            placeholder={s.ladder.blankPlaceholder}
                            aria-label={s.ladder.blankLabel(i + 1)}
                            className={cn(shake.cls(verdict === false), "disabled:opacity-100", verdict === true && "border-success", verdict === false && "border-danger")}
                            onKeyDown={(e) => e.key === "Enter" && void check()}
                          />
                          {verdict === false && (
                            <div className="flex gap-1.5 text-label text-fg-secondary">
                              <CircleX size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                              <span>
                                {s.ladder.modelStep} <Markdown text={text} plainInlineMath />
                              </span>
                            </div>
                          )}
                          {verdict === true && <SuccessCircleCheck size={14} />}
                        </div>
                      ) : (
                        <Collapse open noblur className="min-w-0 flex-1">
                          <div className="pt-1 leading-[1.6]">
                            <Markdown text={text} plainInlineMath />
                          </div>
                        </Collapse>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {cold && (
              <Input
                autoFocus
                value={answer}
                disabled={!!outcome}
                onChange={(e) => setAnswer(e.target.value)}
                {...shake.props}
                aria-label={s.ladder.yourAnswer}
                placeholder={s.ladder.yourAnswer}
                className={cn(shake.cls(!!outcome && !outcome.correct), "disabled:opacity-100", outcome && (outcome.correct ? "border-success" : "border-danger"))}
                onKeyDown={(e) => e.key === "Enter" && void check()}
              />
            )}

            {rung === 0 ? (
              <Button variant="primary" className="self-start" onClick={() => go(1)} data-testid="ladder-next">
                <ArrowRight size={15} className="rtl:rotate-180" /> {s.ladder.gotIt}
              </Button>
            ) : (
              !outcome && (
                <Button variant="primary" className="self-start" disabled={!ready || busy} onClick={() => void check()} data-testid="ladder-check">
                  {busy ? s.ladder.checking : s.ladder.check}
                </Button>
              )
            )}

            {outcome && (
              <Reveal
                data-testid="ladder-result"
                className={cn(
                  "flex flex-col gap-2 rounded-card border px-4 py-3.5",
                  outcome.correct ? "border-success-border bg-success-soft" : "border-danger-border bg-danger-soft",
                )}
              >
                <div className={cn("flex items-center gap-2.5 text-input font-semibold", outcome.correct ? "text-success-text" : "text-danger-text")}>
                  {outcome.correct ? <SuccessCircleCheck size={16} /> : <CircleX size={16} />}
                  {mastered ? s.ladder.done : outcome.correct ? s.ladder.correct : s.ladder.notQuite}
                </div>
                {cold && !outcome.correct && (
                  <p>
                    {s.ladder.modelAnswer} {problem.answer}
                  </p>
                )}
                {mastered ? <p className="text-fg-secondary">{s.ladder.doneHelp}</p> : <p className="text-fg-secondary">{outcome.correct ? s.ladder.up : s.ladder.down}</p>}
                <div className="flex gap-2 pt-1">
                  {mastered ? (
                    <>
                      <Button variant="primary" onClick={() => go(3)} data-testid="ladder-next">
                        {s.ladder.again}
                      </Button>
                      <Button variant="secondary" onClick={() => go(0)}>
                        {s.ladder.restart}
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" onClick={() => go(outcome.to)} data-testid="ladder-next">
                      <ArrowRight size={15} className="rtl:rotate-180" /> {s.practice.next}
                    </Button>
                  )}
                </div>
              </Reveal>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
