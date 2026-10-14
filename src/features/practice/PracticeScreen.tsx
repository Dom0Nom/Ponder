import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleX, Lightbulb, ListChecks, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../../lib/ipc";
import { gatherForTask } from "../../lib/context/task";
import { invalidateCards, qk, useCurriculum, useSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Ability, ErrorType, PracticeItem, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { levelFor, levelFromTheta, skillPercent, targetDifficulty, updateTheta } from "../../lib/practice/irt";
import { classifyError, generateProblem, generateVariation, gradeResponse, type Grade, type TopicSpec, type VariationMode } from "../../lib/practice/problems";
import { curriculumById } from "../../lib/placement/curricula";
import { useUi } from "../../stores/ui";
import { NumberPop } from "../../components/motion/NumberPop";
import { Collapse, Reveal } from "../../components/motion/Reveal";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { useShake } from "../../components/motion/useShake";
import { Button } from "../../components/ui/button";
import { ChoiceOption } from "../../components/ui/choice";
import { Input } from "../../components/ui/input";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { toastError } from "../../components/ui/toast";
import { Markdown } from "../chat/Markdown";
import { StepCheckerPanel } from "../steps/StepChecker";
import { LadderSession } from "./LadderSession";
import { PracticeHub } from "./PracticeHub";

const qkAbilities = (spaceId: string) => ["abilities", spaceId] as const;

export function PracticeScreen({ spaceId, topicKey }: { spaceId: string; topicKey?: string }) {
  const space = useSpace(spaceId);
  const curriculum = useCurriculum(spaceId);
  const abilities = useQuery({ queryKey: qkAbilities(spaceId), queryFn: () => api.abilitiesList(spaceId) });
  const navigate = useUi((st) => st.navigate);
  const [ladder, setLadder] = useState(false);

  const topics: TopicSpec[] = useMemo(
    () => (curriculum.data?.topics ?? []).map((t) => ({ key: t.id, title: t.title, description: t.description })),
    [curriculum.data],
  );
  const abilityByKey = new Map((abilities.data ?? []).map((a) => [a.topicKey, a]));
  const freeTopics: TopicSpec[] = (abilities.data ?? [])
    .filter((a) => a.topicKey.startsWith("free:"))
    .map((a) => ({ key: a.topicKey, title: a.topicTitle, description: a.topicTitle }));
  const all = [...topics, ...freeTopics];
  const selected = all.find((t) => t.key === topicKey) ?? (topicKey?.startsWith("free:") ? { key: topicKey, title: topicKey.slice(5), description: topicKey.slice(5) } : undefined);

  const selectedTitle = selected?.title;
  useEffect(() => {
    useUi.setState((st) =>
      st.route.name === "practice" && selectedTitle && st.route.topicTitle !== selectedTitle
        ? { route: { ...st.route, topicTitle: selectedTitle } }
        : st,
    );
  }, [selectedTitle]);

  if (space.isLoading || curriculum.isLoading) return <Skeleton className="m-6 h-64 rounded-pane" />;
  if (space.error || !space.data) return <ErrorState className="pt-24" title={s.space.notFound} error={space.error} />;

  const pick = (key: string) => {
    const t = all.find((x) => x.key === key);
    navigate({ name: "practice", spaceId, topicKey: key, topicTitle: t?.title ?? (key.startsWith("free:") ? key.slice(5) : undefined) });
  };

  if (selected && abilities.isLoading) return <Skeleton className="m-6 h-64 rounded-pane" />;
  if (selected && abilities.error && !abilities.data) {
    return <ErrorState className="pt-24" title={s.practice.loadFailed} error={abilities.error} onRetry={() => abilities.refetch()} />;
  }

  if (selected && ladder)
    return <LadderSession key={selected.key} space={space.data} topic={selected} language={curriculumById(curriculum.data?.curriculumId ?? "")?.language} onExit={() => setLadder(false)} />;
  if (!selected) return <PracticeHub spaceId={spaceId} topics={all} abilityByKey={abilityByKey} onPick={pick} />;
  return (
    <Session
      key={selected.key}
      space={space.data}
      topic={selected}
      ability={abilityByKey.get(selected.key) ?? null}
      language={curriculumById(curriculum.data?.curriculumId ?? "")?.language}
      isCurriculumTopic={topics.some((t) => t.key === selected.key)}
      onLadder={() => setLadder(true)}
    />
  );
}

interface Result {
  grade: Grade;
  before: number;
  after: number;
  errorType: ErrorType | null;
  errorNote: string | null;
}

function Session({
  space,
  topic,
  ability,
  language,
  isCurriculumTopic,
  onLadder,
}: {
  space: Space;
  topic: TopicSpec;
  ability: Ability | null;
  language?: string;
  isCurriculumTopic: boolean;
  onLadder: () => void;
}) {
  const qc = useQueryClient();
  const [item, setItem] = useState<PracticeItem | null>(null);
  const [response, setResponse] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const shake = useShake();
  const [busy, setBusy] = useState<"new" | "grade" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [theta, setTheta] = useState(ability?.theta ?? 0);
  const [n, setN] = useState(ability?.n ?? 0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const prefetched = useRef<Promise<PracticeItem> | null>(null);
  const progress = useRef<{
    itemId: string;
    response: string;
    grade?: Grade;
    errorType?: ErrorType | null;
    errorNote?: string | null;
    attempted?: boolean;
    mistakeId?: string;
    errorTypeSet?: boolean;
    levelSet?: boolean;
  } | null>(null);

  const makeNext = async (atTheta: number) => {
    const llm = await resolveChatModel(space);
    const [avoid, hits] = await Promise.all([
      api.practiceRecent(space.id, topic.key, 10),
      gatherForTask({ spaceId: space.id, topic: topic.title, queries: [`${topic.title} ${topic.description}`], maxTokens: 3_000 })
        .then((m) => m.passages)
        .catch(() => []),
    ]);
    const context = hits.length ? hits.map((h) => h.text).join("\n\n") : undefined;
    return api.practiceItemAdd(space.id, await generateProblem(llm, { topic, level: levelFor(targetDifficulty(atTheta)), avoid, context, language: language ?? space.language }));
  };

  const load = async (variation?: VariationMode) => {
    setBusy("new");
    setError(null);
    setResult(null);
    shake.reset();
    setResponse("");
    setShowHint(false);
    const pending = prefetched.current;
    prefetched.current = null;
    try {
      if (variation && item) {
        const llm = await resolveChatModel(space);
        setItem(await api.practiceItemAdd(space.id, await generateVariation(llm, item, variation)));
      } else {
        setItem(await (pending?.catch(() => makeNext(theta)) ?? makeNext(theta)));
      }
    } catch (e) {
      setError(e instanceof NoModelError ? new Error(s.chat.noModel) : e);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!item || !response.trim()) return;
    setBusy("grade");
    try {
      const givenText = item.kind === "mcq" ? item.options![Number(response)] ?? response : response.trim();
      if (progress.current?.itemId !== item.id || progress.current.response !== givenText) progress.current = { itemId: item.id, response: givenText };
      const p = progress.current;
      const correctText = item.kind === "mcq" ? item.options![Number(item.answer)] : item.answer;
      if (!p.grade) {
        const llm = await resolveChatModel(space);
        p.grade = await gradeResponse(llm, item, response.trim());
        if (!p.grade.correct) {
          const c = await classifyError(llm, { question: item.question, answer: correctText, solution: item.solution }, givenText).catch(() => null);
          p.errorType = c?.errorType ?? null;
          p.errorNote = c?.note ?? null;
        }
      }
      const grade = p.grade;
      const errorType = p.errorType ?? null;
      const errorNote = p.errorNote ?? null;
      const after = updateTheta(theta, item.difficulty, grade.correct, n);
      if (!p.attempted) {
        await api.practiceAttempt(space.id, {
          itemId: item.id,
          topicKey: topic.key,
          topicTitle: topic.title,
          response: givenText,
          correct: grade.correct,
          thetaBefore: theta,
          thetaAfter: after,
          errorType,
        });
        p.attempted = true;
      }
      if (!grade.correct) {
        if (!p.mistakeId) {
          const [m] = await api.mistakesAdd(space.id, [
            {
              origin: "practice",
              question: item.question,
              given: givenText,
              correct: correctText,
              explanation: errorNote ?? item.solution.slice(0, 600),
              topic: topic.title,
              options: item.options,
            },
          ]);
          p.mistakeId = m.id;
          invalidateCards(space.id);
        }
        if (errorType && !p.errorTypeSet) {
          await api.mistakeSetErrorType(p.mistakeId, errorType);
          p.errorTypeSet = true;
        }
      }
      if (isCurriculumTopic) {
        const level = levelFromTheta(after, n + 1);
        if (level !== "unknown" && !p.levelSet) {
          await api.topicLevelSet(space.id, topic.key, level, `practice: ${skillPercent(after)}/100 after ${n + 1} problems`);
          p.levelSet = true;
        }
        qc.invalidateQueries({ queryKey: qk.levels(space.id) });
      }
      qc.invalidateQueries({ queryKey: qkAbilities(space.id) });
      qc.invalidateQueries({ queryKey: ["errorPatterns"] });
      setResult({ grade, before: theta, after, errorType, errorNote });
      if (!grade.correct) shake.shake();
      prefetched.current = makeNext(after);
      prefetched.current.catch(() => {});
      setTheta(after);
      setN(n + 1);
    } catch (e) {
      toastError(s.practice.gradeFailed, e, submit);
    } finally {
      setBusy(null);
    }
  };

  const answerText = item ? (item.kind === "mcq" ? item.options![Number(item.answer)] : item.answer) : "";
  const ok = result?.grade.correct;

  return (
    <div className="flex h-full min-h-0" data-testid="practice-session">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-10 pb-12 pt-10">
          <div className="flex items-center gap-3">
            <span className="text-body font-semibold">{item ? s.practice.level(levelFor(item.difficulty)) : ""}</span>
            <span className="text-muted" data-testid="practice-skill">
              {s.practice.problems(n)}
            </span>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={onLadder} data-testid="open-ladder">
              {s.ladder.open}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => load()} disabled={busy != null}>
              {s.practice.skip}
            </Button>
          </div>
          {busy === "new" && (
            <div className="flex flex-col gap-3" aria-live="polite">
              <GeneratingStatus label={s.practice.writing} className="text-muted" />
              <Skeleton className="h-6 w-3/4 rounded-btn" />
              <Skeleton className="h-[72px] rounded-pane" />
              <Skeleton className="h-9 rounded-control" />
            </div>
          )}
          {error != null && busy !== "new" && <ErrorState title={s.practice.loadFailed} error={error} onRetry={() => load()} />}
          {item && busy !== "new" && (
            <div key={item.id} className="t-page-enter flex flex-col gap-[18px]">
              <div className="practice-question text-[1.125rem] font-medium leading-[1.5] [&_.prose-chat]:leading-[1.5]" data-testid="practice-question">
                <Markdown text={item.question} />
              </div>
              {item.kind === "mcq" ? (
                <>
                  <div className="flex flex-col gap-2" role="radiogroup" aria-label={item.question}>
                    {item.options!.map((o, i) => (
                      <ChoiceOption
                        key={i}
                        label={<Markdown text={o} />}
                        selected={response === String(i)}
                        state={result && String(i) === item.answer ? "correct" : result && response === String(i) ? "wrong" : "idle"}
                        disabled={!!result}
                        onClick={() => setResponse(String(i))}
                      />
                    ))}
                  </div>
                  <Button variant="primary" className="self-start" disabled={!response.trim() || !!result || busy === "grade"} onClick={submit}>
                    {s.practice.check}
                  </Button>
                </>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <Input
                    autoFocus
                    value={response}
                    disabled={!!result}
                    onChange={(e) => setResponse(e.target.value)}
                    {...shake.props}
                    placeholder={item.kind === "numeric" ? s.practice.numericPlaceholder : s.practice.shortPlaceholder}
                    aria-label={s.practice.yourAnswer}
                    className={cn(shake.cls(!!result && !ok), "min-w-0 flex-1 disabled:opacity-100", result && (ok ? "border-success" : "border-danger"))}
                  />
                  <Button type="submit" variant="primary" disabled={!response.trim() || !!result || busy === "grade"}>
                    {s.practice.check}
                  </Button>
                  {item.kind === "numeric" && (
                    <Button variant="secondary" onClick={() => setStepsOpen(true)} data-testid="practice-check-steps">
                      <ListChecks size={15} /> {s.practice.checkSteps}
                    </Button>
                  )}
                </form>
              )}
              {item.hint && !result && (
                <div className="flex flex-col gap-1.5">
                  <Button variant="ghost" size="sm" className="-ms-[9px] self-start" aria-expanded={showHint} onClick={() => setShowHint(!showHint)}>
                    <Lightbulb size={14} /> {s.practice.hint}
                  </Button>
                  <Collapse open={showHint} noblur>
                    <div className="flex gap-2 text-fg-secondary" data-testid="practice-hint">
                      <Lightbulb size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <Markdown text={item.hint} />
                    </div>
                  </Collapse>
                </div>
              )}
              {busy === "grade" && <GeneratingStatus label={s.practice.grading} className="text-muted" />}
              {result && (
                <>
                  <Reveal
                    data-testid="practice-result"
                    className={cn(
                      "flex flex-col gap-1.5 rounded-card border px-4 pb-3.5 pt-3.5",
                      ok ? "border-success-border bg-success-soft" : "border-danger-border bg-danger-soft",
                    )}
                  >
                    <div className={cn("flex h-[23px] items-center gap-2.5 text-input font-semibold", ok ? "text-success-text" : "text-danger-text")}>
                      {ok ? <SuccessCircleCheck size={16} /> : <CircleX size={16} />}
                      {ok ? s.practice.correct : s.practice.notQuite}
                      <span className="ms-auto flex items-center gap-1 text-label font-normal tabular-nums text-muted" data-testid="skill-change">
                        {result.after >= result.before ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-danger" />}
                        {skillPercent(result.before)} → <NumberPop text={String(skillPercent(result.after))} popKey={result.after} onMount />
                      </span>
                    </div>
                    {!ok && (
                      <p>
                        {[`${s.practice.answerWas} ${answerText}`, result.errorType && s.practice.errorKind(s.errorTypes[result.errorType])]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {(result.grade.feedback || result.errorNote) && (
                      <p className="text-fg-secondary">{[result.grade.feedback, result.errorNote].filter(Boolean).join(" ")}</p>
                    )}
                  </Reveal>
                  <Reveal className="flex flex-col gap-2 rounded-card border border-border px-4 pb-3.5 pt-3.5" index={1}>
                    <p className="text-label font-semibold text-muted">{s.practice.solution}</p>
                    <div className="practice-solution text-input leading-[1.7] [&_.prose-chat]:leading-[1.7] [&_p]:m-0">
                      <Markdown text={item.solution} plainInlineMath />
                    </div>
                  </Reveal>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => load()}>
                      <ArrowRight size={15} /> {s.practice.next}
                    </Button>
                    <Button variant="secondary" onClick={() => load("same")}>
                      {s.practice.moreLikeThis}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => load("easier")}>
                      {s.practice.easier}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => load("harder")}>
                      {s.practice.harder}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {stepsOpen && item && (
        <div className="w-[340px] flex-none border-s border-border">
          <StepCheckerPanel spaceId={space.id} problem={item.question} expectedAnswer={item.answer} onClose={() => setStepsOpen(false)} />
        </div>
      )}
    </div>
  );
}
