import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Dumbbell, Shuffle, TrendingDown, TrendingUp, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards, qk, useCurriculum, useSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Ability, ErrorType, PracticeItem, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { levelFor, levelFromTheta, skillPercent, targetDifficulty, updateTheta } from "../../lib/practice/irt";
import { classifyError, generateProblem, generateVariation, gradeResponse, type Grade, type TopicSpec, type VariationMode } from "../../lib/practice/problems";
import { curriculumById } from "../../lib/placement/curricula";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { EmptyState, ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Markdown } from "../chat/Markdown";
import { ErrorPatterns } from "./ErrorPatterns";
import { StepCheckSlot } from "./stepCheckSlot";

const qkAbilities = (spaceId: string) => ["abilities", spaceId] as const;

export function PracticeScreen({ spaceId, topicKey }: { spaceId: string; topicKey?: string }) {
  const space = useSpace(spaceId);
  const curriculum = useCurriculum(spaceId);
  const abilities = useQuery({ queryKey: qkAbilities(spaceId), queryFn: () => api.abilitiesList(spaceId) });
  const navigate = useUi((st) => st.navigate);
  const [free, setFree] = useState("");

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

  if (space.isLoading || curriculum.isLoading) return <Skeleton className="m-6 h-64 rounded-[var(--radius-pane)]" />;
  if (space.error || !space.data) return <ErrorState className="pt-24" title={s.space.notFound} error={space.error} />;

  const pick = (key: string) => navigate({ name: "practice", spaceId, topicKey: key });

  return (
    <div className="flex h-full gap-3 px-3 pb-3">
      <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-pane)] bg-surface shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-medium">
            <Dumbbell size={16} className="text-muted" /> {s.practice.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{s.practice.subtitle}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <form
            className="mb-2 flex gap-1.5 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (free.trim()) pick(`free:${free.trim().slice(0, 80)}`);
            }}
          >
            <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder={s.practice.freePlaceholder} aria-label={s.practice.freePlaceholder} className="h-9" />
            <Button type="submit" size="sm" variant="tonal" disabled={!free.trim()}>
              {s.practice.go}
            </Button>
          </form>
          {all.length === 0 && <p className="px-3 py-4 text-xs text-muted">{s.practice.noTopics}</p>}
          <ul data-testid="practice-topics">
            {all.map((t) => {
              const a = abilityByKey.get(t.key);
              return (
                <li key={t.key}>
                  <button
                    onClick={() => pick(t.key)}
                    className={cn("w-full rounded-xl px-3 py-2 text-left hover:bg-surface-2", t.key === topicKey && "bg-accent-soft hover:bg-accent-soft")}
                  >
                    <p className="truncate text-[0.8125rem]">{t.title}</p>
                    {a ? (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${skillPercent(a.theta)}%` }} />
                        </div>
                        <span className="text-[0.6875rem] tabular-nums text-faint">{skillPercent(a.theta)}</span>
                      </div>
                    ) : (
                      <p className="text-[0.6875rem] text-faint">{s.practice.notPractised}</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="border-t border-border p-3">
          <ErrorPatterns spaceId={spaceId} compact />
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-pane)] bg-surface shadow-card">
        {selected ? (
          <Session
            key={selected.key}
            space={space.data}
            topic={selected}
            ability={abilityByKey.get(selected.key) ?? null}
            language={curriculumById(curriculum.data?.curriculumId ?? "")?.language}
            isCurriculumTopic={topics.some((t) => t.key === selected.key)}
          />
        ) : (
          <EmptyState className="flex-1" icon={<Dumbbell size={22} />} title={s.practice.pickTitle} body={s.practice.pickBody} />
        )}
      </section>
    </div>
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
}: {
  space: Space;
  topic: TopicSpec;
  ability: Ability | null;
  language?: string;
  isCurriculumTopic: boolean;
}) {
  const qc = useQueryClient();
  const [item, setItem] = useState<PracticeItem | null>(null);
  const [response, setResponse] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"new" | "grade" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [theta, setTheta] = useState(ability?.theta ?? 0);
  const [n, setN] = useState(ability?.n ?? 0);

  const prefetched = useRef<Promise<PracticeItem> | null>(null);

  const makeNext = async (atTheta: number) => {
    const llm = await resolveChatModel(space);
    const [avoid, hits] = await Promise.all([
      api.practiceRecent(space.id, topic.key, 10),
      api.searchChunks(space.id, `${topic.title} ${topic.description}`, 4).catch(() => []),
    ]);
    const context = hits.length ? hits.map((h) => h.text).join("\n\n") : undefined;
    return api.practiceItemAdd(space.id, await generateProblem(llm, { topic, level: levelFor(targetDifficulty(atTheta)), avoid, context, language }));
  };

  const load = async (variation?: VariationMode) => {
    setBusy("new");
    setError(null);
    setResult(null);
    setResponse("");
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
      const llm = await resolveChatModel(space);
      const grade = await gradeResponse(llm, item, response.trim());
      const after = updateTheta(theta, item.difficulty, grade.correct, n);
      let errorType: ErrorType | null = null;
      let errorNote: string | null = null;
      const correctText = item.kind === "mcq" ? item.options![Number(item.answer)] : item.answer;
      const givenText = item.kind === "mcq" ? item.options![Number(response)] ?? response : response.trim();
      if (!grade.correct) {
        const c = await classifyError(llm, { question: item.question, answer: correctText, solution: item.solution }, givenText).catch(() => null);
        errorType = c?.errorType ?? null;
        errorNote = c?.note ?? null;
      }
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
      if (!grade.correct) {
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
        if (errorType) await api.mistakeSetErrorType(m.id, errorType);
        invalidateCards(space.id);
      }
      if (isCurriculumTopic) {
        const level = levelFromTheta(after, n + 1);
        if (level !== "unknown") await api.topicLevelSet(space.id, topic.key, level, `practice: ${skillPercent(after)}/100 after ${n + 1} problems`);
        qc.invalidateQueries({ queryKey: qk.levels(space.id) });
      }
      qc.invalidateQueries({ queryKey: qkAbilities(space.id) });
      qc.invalidateQueries({ queryKey: ["errorPatterns"] });
      setResult({ grade, before: theta, after, errorType, errorNote });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="practice-session">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-medium">{topic.title}</p>
          <p className="text-xs text-muted" data-testid="practice-skill">
            {s.practice.skill(skillPercent(theta), n)}
            {item && ` · ${s.practice.level(levelFor(item.difficulty))}`}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          {busy === "new" && (
            <div className="space-y-3" aria-live="polite">
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner size={14} /> {s.practice.writing}
              </p>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          )}
          {error != null && busy !== "new" && <ErrorState title={s.practice.loadFailed} error={error} onRetry={() => load()} />}
          {item && busy !== "new" && (
            <div>
              <div className="text-[1.0625rem] leading-relaxed" data-testid="practice-question">
                <Markdown text={item.question} />
              </div>
              {item.kind === "mcq" ? (
                <div className="mt-5 space-y-2" role="radiogroup" aria-label={item.question}>
                  {item.options!.map((o, i) => (
                    <button
                      key={i}
                      role="radio"
                      aria-checked={response === String(i)}
                      disabled={!!result}
                      onClick={() => setResponse(String(i))}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-2xl border px-4 py-2.5 text-left text-sm",
                        result && String(i) === item.answer
                          ? "border-success bg-success/10"
                          : result && response === String(i)
                            ? "border-danger bg-danger-soft"
                            : response === String(i)
                              ? "border-accent bg-accent-soft"
                              : "border-border hover:bg-surface-2",
                      )}
                    >
                      <Markdown text={o} />
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  className="mt-5 flex gap-2"
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
                    placeholder={item.kind === "numeric" ? s.practice.numericPlaceholder : s.practice.shortPlaceholder}
                    aria-label={s.practice.yourAnswer}
                  />
                </form>
              )}
              {!result && (
                <div className="mt-4 flex items-center gap-2">
                  <Button variant="primary" disabled={!response.trim() || busy === "grade"} onClick={submit}>
                    {busy === "grade" && <Spinner size={14} className="text-on-accent" />} {s.practice.check}
                  </Button>
                  {item.kind === "numeric" && <StepCheckSlot spaceId={space.id} problem={item.question} expectedAnswer={item.answer} />}
                  <Button variant="ghost" onClick={() => load()}>
                    {s.practice.skip}
                  </Button>
                </div>
              )}
              {result && (
                <div className="mt-5 space-y-4" data-testid="practice-result">
                  <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3", result.grade.correct ? "bg-success/10" : "bg-danger-soft")}>
                    {result.grade.correct ? <Check size={18} className="mt-0.5 text-success" /> : <X size={18} className="mt-0.5 text-danger" />}
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{result.grade.correct ? s.practice.correct : s.practice.notQuite}</p>
                      {!result.grade.correct && (
                        <p className="mt-0.5">
                          {s.practice.answerWas}{" "}
                          <span className="font-medium">{item.kind === "mcq" ? item.options![Number(item.answer)] : item.answer}</span>
                        </p>
                      )}
                      {result.grade.feedback && <p className="mt-1 text-muted">{result.grade.feedback}</p>}
                      {result.errorType && (
                        <p className="mt-1 text-xs text-muted">
                          {s.practice.errorKind(s.errorTypes[result.errorType])}
                          {result.errorNote ? ` · ${result.errorNote}` : ""}
                        </p>
                      )}
                    </div>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted" data-testid="skill-change">
                      {result.after >= result.before ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-danger" />}
                      {skillPercent(result.before)} → {skillPercent(result.after)}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-border px-4 py-3">
                    <p className="mb-1 text-xs font-medium text-muted">{s.practice.solution}</p>
                    <Markdown text={item.solution} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => load()}>
                      {s.practice.next} <ArrowRight size={15} />
                    </Button>
                    <Button variant="secondary" onClick={() => load("same")}>
                      <Shuffle size={15} /> {s.practice.moreLikeThis}
                    </Button>
                    <Button variant="ghost" onClick={() => load(result.grade.correct ? "harder" : "easier")}>
                      {result.grade.correct ? s.practice.harder : s.practice.easier}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
