import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Calculator, ChevronDown, ChevronLeft, ChevronRight, Flag, GraduationCap, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { useCurriculum, useSpace, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DATE_NUMERIC, formatDate } from "../../lib/i18n/format";
import type { ExamAttempt, Space, TopicRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { examById, examFor, sectionTopics, type ExamFormat, type ExamLength, type ExamSection } from "../../lib/exam/formats";
import { generateExamQuestions } from "../../lib/exam/generate";
import { generateEssayTask, gradeEssay } from "../../lib/exam/essay";
import { clockText, examResult, remainingMs, type ExamData } from "../../lib/exam/attempt";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { ChoiceOption } from "../../components/ui/choice";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/input";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../components/ui/menu";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { Collapse } from "../../components/motion/Reveal";
import { Markdown } from "../chat/Markdown";

const qkExams = (spaceId: string) => ["exams", spaceId] as const;
const qkExam = (id: string) => ["exam", id] as const;
const SAVE_EVERY_MS = 5000;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const noModel = (e: unknown) => (e instanceof NoModelError ? new Error(s.chat.noModel) : e);

export function ExamScreen({ spaceId, attemptId }: { spaceId?: string; attemptId?: string }) {
  if (attemptId && spaceId) return <AttemptView key={attemptId} spaceId={spaceId} id={attemptId} />;
  return (
    <Page>
      <Header spaceId={spaceId} />
      {spaceId ? (
        <StartView key={spaceId} spaceId={spaceId} />
      ) : (
        <div className="flex h-[260px]">
          <EmptyState className="flex-1" icon={<GraduationCap size={20} />} title={s.exam.pickSpace} body={s.exam.noFormatBody} />
        </div>
      )}
    </Page>
  );
}

function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-full overflow-y-auto">
      <div className={cn("mx-auto flex w-full flex-col gap-[18px] px-10 pb-12 pt-10", wide ? "max-w-[1100px]" : "max-w-[760px]")} data-testid="exam">
        {children}
      </div>
    </div>
  );
}

function Header({ spaceId }: { spaceId?: string }) {
  const navigate = useUi((st) => st.navigate);
  const spaces = useSpaces();
  const space = spaces.data?.find((x) => x.id === spaceId);
  return (
    <div className="flex items-center gap-3">
      <h1 className="text-page font-semibold">{s.exam.title}</h1>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" className="ml-auto" data-testid="exam-space">
            {space?.name ?? s.exam.pickSpace}
            <ChevronDown size={14} className="text-muted" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuRadioGroup value={spaceId ?? ""} onValueChange={(v) => navigate({ name: "exam", spaceId: v })}>
            {(spaces.data ?? []).map((x) => (
              <MenuRadioItem key={x.id} value={x.id}>
                {x.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </div>
  );
}

function StartView({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const space = useSpace(spaceId);
  const curriculum = useCurriculum(spaceId);
  const history = useQuery({ queryKey: qkExams(spaceId), queryFn: () => api.examsList(spaceId) });
  const format = examFor(curriculum.data?.curriculumId);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [length, setLength] = useState<ExamLength>("short");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  if (space.isLoading || curriculum.isLoading) return <Skeleton className="h-64 rounded-card" />;
  if (space.error || !space.data) return <ErrorState title={s.space.notFound} error={space.error} />;
  if (!format || !curriculum.data)
    return (
      <div className="flex h-[260px]">
        <EmptyState className="flex-1" icon={<GraduationCap size={20} />} title={s.exam.noFormat} body={s.exam.noFormatBody} />
      </div>
    );
  const section = format.sections.find((x) => x.id === sectionId) ?? format.sections[0];

  const start = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    const topics = sectionTopics(section, curriculum.data!.topics);
    const count = section.questions[length];
    setProgress({ done: 0, total: count });
    try {
      const llm = await resolveChatModel(space.data);
      const pastIssues = (history.data ?? []).flatMap((a) => (a.data.essay ? [a.data.essay.task.issue] : []));
      const [questions, task] = await Promise.all([
        generateExamQuestions(llm, format, section, topics, count, { signal: ctrl.signal, onProgress: (done, total) => setProgress({ done, total }) }),
        section.essayMinutes ? generateEssayTask(llm, pastIssues, ctrl.signal) : Promise.resolve(undefined),
      ]);
      const data: ExamData = {
        questions,
        answers: questions.map(() => null),
        flags: questions.map(() => false),
        topics: topics.map((t) => ({ id: t.id, title: t.title })),
        essay: task ? { task, text: "" } : undefined,
      };
      const saved = await api.examSave({
        id: "",
        spaceId,
        examId: format.id,
        section: section.id,
        length,
        data,
        score: null,
        scaled: null,
        startedAt: 0,
        completedAt: null,
        timeUsedMs: 0,
      });
      qc.invalidateQueries({ queryKey: qkExams(spaceId) });
      qc.setQueryData(qkExam(saved.id), saved);
      navigate({ name: "exam", spaceId, attemptId: saved.id });
    } catch (e) {
      if (!ctrl.signal.aborted) setError(noModel(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <p className="text-fg-secondary">{s.exam.intro(format.title)}</p>
      <section className="flex flex-col gap-3" data-testid="exam-start">
        <h2 className="text-label font-semibold text-muted">{s.exam.section}</h2>
        <div role="radiogroup" aria-label={s.exam.section} className="grid grid-cols-2 gap-3">
          {format.sections.map((x) => (
            <ChoiceOption
              key={x.id}
              selected={x.id === section.id}
              disabled={!!progress}
              onClick={() => setSectionId(x.id)}
              label={
                <span className="flex flex-col">
                  <span>{x.title}</span>
                  <span className="text-label font-normal text-muted">
                    {(x.essayMinutes ? s.exam.lengthInfoEssay : s.exam.lengthInfo)(x.minutes[length], x.questions[length])}
                    {x.calculator ? ` · ${s.exam.calculatorAllowed}` : ""}
                  </span>
                </span>
              }
            />
          ))}
        </div>
        <h2 className="mt-2 text-label font-semibold text-muted">{s.exam.length}</h2>
        <div role="radiogroup" aria-label={s.exam.length} className="grid grid-cols-2 gap-3">
          {(["short", "full"] as const).map((l) => (
            <ChoiceOption key={l} selected={l === length} disabled={!!progress} onClick={() => setLength(l)} label={s.exam.lengths[l]} />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          {progress ? (
            <>
              <GeneratingStatus label={progress.done ? s.exam.writing(progress.done, progress.total) : section.essayMinutes ? s.exam.writingEssay : s.exam.writing(0, progress.total)} />
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => abort.current?.abort()}>
                {s.exam.cancel}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={start} data-testid="exam-begin">
              {s.exam.start}
            </Button>
          )}
        </div>
        {error ? <ErrorState title={s.exam.startError} error={error} onRetry={start} /> : null}
      </section>
      <History spaceId={spaceId} format={format} query={history} />
    </>
  );
}

function History({ spaceId, format, query }: { spaceId: string; format: ExamFormat; query: UseQueryResult<ExamAttempt[]> }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const remove = async (id: string) => {
    try {
      await api.examDelete(id);
      qc.invalidateQueries({ queryKey: qkExams(spaceId) });
      toast(s.exam.removed);
    } catch (e) {
      toastError(s.exam.loadError, e);
    }
  };
  return (
    <section className="mt-4 flex flex-col gap-2" data-testid="exam-history">
      <h2 className="text-title-sm font-semibold">{s.exam.history}</h2>
      {query.isLoading ? (
        <Skeleton className="h-16 rounded-card" />
      ) : query.error ? (
        <ErrorState title={s.exam.loadError} error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <p className="text-muted">{s.exam.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
          {query.data.map((a) => {
            const section = format.sections.find((x) => x.id === a.section);
            const open = () => navigate({ name: "exam", spaceId, attemptId: a.id });
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <button type="button" className="flex flex-1 items-baseline gap-3 text-left" onClick={open}>
                  <span className="font-medium">{section?.title ?? a.section}</span>
                  <span className="text-label text-muted">
                    {s.exam.lengths[a.length]} · {formatDate(a.startedAt, DATE_NUMERIC)}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {a.completedAt == null ? (
                      <span className="text-muted">{s.exam.inProgress}</span>
                    ) : (
                      <>
                        {a.scaled ?? `${Math.round((a.score ?? 0) * 100)}%`}
                        {format.scale && a.scaled != null ? (
                          <span className={cn("ml-2 text-label", a.scaled >= format.scale.pass ? "text-success" : "text-muted")}>
                            {a.scaled >= format.scale.pass ? s.exam.passed : s.exam.notPassed}
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                </button>
                <Button variant="ghost-muted" size="icon-sm" aria-label={s.exam.remove} onClick={() => remove(a.id)}>
                  <Trash2 size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AttemptView({ spaceId, id }: { spaceId: string; id: string }) {
  const q = useQuery({ queryKey: qkExam(id), queryFn: () => api.examGet(id) });
  const space = useSpace(spaceId);
  const a = q.data;
  const format = a ? examById(a.examId) : null;
  const section = format?.sections.find((x) => x.id === a?.section);
  if (q.isLoading || space.isLoading)
    return (
      <Page>
        <Skeleton className="h-64 rounded-card" />
      </Page>
    );
  if (q.error || !a || !format || !section || !space.data)
    return (
      <Page>
        <ErrorState title={s.exam.loadError} error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  return a.completedAt == null ? (
    <Runner attempt={a} format={format} section={section} />
  ) : (
    <Results attempt={a} format={format} section={section} space={space.data} />
  );
}

function Runner({ attempt, format, section }: { attempt: ExamAttempt; format: ExamFormat; section: ExamSection }) {
  const qc = useQueryClient();
  const [data, setData] = useState<ExamData>(attempt.data);
  const [i, setI] = useState(() => Math.max(0, attempt.data.answers.findIndex((x) => x == null)));
  const [confirm, setConfirm] = useState(false);
  const [, tick] = useState(0);
  const startedAt = useRef(Date.now());
  const usedBefore = useRef(attempt.timeUsedMs);
  const finished = useRef(false);
  const latest = useRef({ data, attempt });
  latest.current = { data, attempt };

  const used = () => usedBefore.current + (Date.now() - startedAt.current);
  const left = remainingMs(section, attempt.length, used());
  const qs = data.questions;
  const essayIndex = data.essay ? qs.length : -1;
  const onEssay = i === essayIndex;
  const unanswered = data.answers.filter((x) => x == null).length;

  const persist = async (patch: Partial<ExamAttempt> = {}) => {
    const { data: d, attempt: a } = latest.current;
    const saved = await api.examSave({ ...a, data: d, timeUsedMs: Math.min(used(), section.minutes[a.length] * 60_000), ...patch });
    qc.setQueryData(qkExam(a.id), saved);
    return saved;
  };

  const finish = async () => {
    if (finished.current) return;
    finished.current = true;
    const { data: d } = latest.current;
    const r = examResult(format, d);
    try {
      await persist({ completedAt: Date.now(), score: r.share, scaled: r.scaled });
      qc.invalidateQueries({ queryKey: qkExams(attempt.spaceId) });
    } catch (e) {
      finished.current = false;
      toastError(s.exam.saveError, e, finish);
    }
  };

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const save = setInterval(() => {
      if (!finished.current) persist().catch((e) => toastError(s.exam.saveError, e));
    }, SAVE_EVERY_MS);
    return () => {
      clearInterval(t);
      clearInterval(save);
      if (!finished.current) persist().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timeUp = useRef(false);
  useEffect(() => {
    if (left <= 0 && !finished.current && !timeUp.current) {
      timeUp.current = true;
      toast(s.exam.timeUp);
      void finish();
    }
  });

  const pick = (k: number) => setData((d) => ({ ...d, answers: d.answers.map((x, n) => (n === i ? k : x)) }));
  const go = (n: number) => setI(Math.max(0, Math.min(n, (essayIndex >= 0 ? essayIndex : qs.length - 1))));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onEssay || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const k = "1234abcd".indexOf(e.key.toLowerCase());
      if (k >= 0 && qs[i] && k % 4 < qs[i].options.length) pick(k % 4);
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const q = qs[i];
  return (
    <div className="flex h-full flex-col" data-testid="exam-runner">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-title font-semibold">{s.exam.resultTitle(format.title, section.title)}</h1>
        <span
          className={cn("ml-auto tabular-nums text-title font-semibold", left < 5 * 60_000 && "text-danger")}
          aria-label={s.exam.timeLeft}
          data-testid="exam-timer"
        >
          {clockText(left)}
        </span>
        {section.calculator ? (
          <Button variant="secondary" size="sm" onClick={() => api.openCalculatorWindow(s.exam.calculatorTitle).catch((e) => toastError(s.exam.calculator, e))}>
            <Calculator size={14} />
            {s.exam.calculator}
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={() => (unanswered ? setConfirm(true) : void finish())} data-testid="exam-finish">
          {s.exam.finish}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
          {onEssay && data.essay ? (
            <EssayPart
              essay={data.essay}
              minutes={section.essayMinutes?.[attempt.length] ?? 45}
              onChange={(text) => setData((d) => ({ ...d, essay: d.essay && { ...d.essay, text } }))}
            />
          ) : q ? (
            <div key={i} className="t-page-enter mx-auto flex max-w-[640px] flex-col gap-4" data-testid="exam-question">
              <div className="flex items-center gap-3">
                <p className="text-label font-semibold text-muted">{s.exam.question(i + 1, qs.length)}</p>
                <Button
                  variant="chrome"
                  size="sm"
                  className="ml-auto"
                  aria-pressed={data.flags[i]}
                  onClick={() => setData((d) => ({ ...d, flags: d.flags.map((x, n) => (n === i ? !x : x)) }))}
                >
                  <Flag size={14} />
                  {data.flags[i] ? s.exam.flagged : s.exam.flag}
                </Button>
              </div>
              <div className="text-title font-medium">
                <Markdown text={q.question} />
              </div>
              <div role="radiogroup" aria-label={s.exam.question(i + 1, qs.length)} className="flex flex-col gap-3">
                {q.options.map((o, k) => (
                  <ChoiceOption key={k} label={<Markdown text={o} />} selected={data.answers[i] === k} onClick={() => pick(k)} />
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" disabled={i === 0} onClick={() => go(i - 1)}>
                  <ChevronLeft size={14} />
                  {s.exam.prev}
                </Button>
                <Button variant="secondary" size="sm" className="ml-auto" disabled={i >= (essayIndex >= 0 ? essayIndex : qs.length - 1)} onClick={() => go(i + 1)}>
                  {s.exam.next}
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <aside className="flex w-[208px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border px-4 py-6" data-testid="exam-navigator">
          <p className="text-label font-semibold text-muted">{s.exam.navigator}</p>
          <p className="text-label text-muted">{s.exam.answered(qs.length - unanswered, qs.length)}</p>
          <div className="grid grid-cols-5 gap-1.5">
            {qs.map((_, n) => (
              <button
                key={n}
                type="button"
                onClick={() => go(n)}
                aria-current={n === i ? "step" : undefined}
                aria-label={s.exam.question(n + 1, qs.length)}
                data-answered={data.answers[n] != null}
                data-flagged={data.flags[n]}
                className={cn(
                  "relative flex h-8 items-center justify-center rounded-item border text-label tabular-nums",
                  n === i ? "border-fg" : "border-control",
                  data.answers[n] != null ? "bg-fill-subtle font-semibold" : "text-muted",
                )}
              >
                {n + 1}
                {data.flags[n] ? <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warn" /> : null}
              </button>
            ))}
          </div>
          {data.essay ? (
            <Button variant={onEssay ? "chrome" : "secondary"} size="sm" aria-pressed={onEssay} onClick={() => setI(essayIndex)} data-testid="exam-essay-tab">
              {s.exam.essay}
              <span className="ml-auto text-label text-muted">{s.exam.essayWords(words(data.essay.text))}</span>
            </Button>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={s.exam.finish}
        body={s.exam.finishConfirm(unanswered)}
        confirmLabel={s.exam.finishYes}
        onConfirm={() => void finish()}
      />
    </div>
  );
}

function EssayPart({ essay, minutes, onChange }: { essay: NonNullable<ExamData["essay"]>; minutes: number; onChange: (t: string) => void }) {
  return (
    <div className="grid h-full grid-cols-2 gap-6" data-testid="exam-essay">
      <div className="flex flex-col gap-4 overflow-y-auto pr-2">
        <p className="text-label font-semibold text-muted">{s.exam.essayPrompt}</p>
        <p className="font-medium">{essay.task.prompt}</p>
        {essay.task.passages.map((p, k) => (
          <article key={k} className="flex flex-col gap-2 rounded-card border border-border px-4 py-3">
            <h3 className="font-semibold">{p.title}</h3>
            <div className="whitespace-pre-wrap text-fg-secondary">{p.text}</div>
          </article>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-label text-muted">{s.exam.essayHint(minutes)}</p>
        <Textarea
          aria-label={s.exam.essayPrompt}
          className="min-h-[360px] flex-1 resize-none"
          placeholder={s.exam.essayPlaceholder}
          value={essay.text}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        <p className="text-label text-muted tabular-nums">{s.exam.essayWords(words(essay.text))}</p>
      </div>
    </div>
  );
}

function Results({ attempt, format, section, space }: { attempt: ExamAttempt; format: ExamFormat; section: ExamSection; space: Space }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const r = useMemo(() => examResult(format, attempt.data), [format, attempt.data]);
  const essay = attempt.data.essay;
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<unknown>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const tried = useRef(false);

  const grade = async () => {
    if (!essay) return;
    setGrading(true);
    setGradeError(null);
    try {
      const llm = await resolveChatModel(space);
      const g = await gradeEssay(llm, essay.task, essay.text);
      const data = { ...attempt.data, essay: { ...essay, grade: g } };
      const nr = examResult(format, data);
      const saved = await api.examSave({ ...attempt, data, score: nr.share, scaled: nr.scaled });
      qc.setQueryData(qkExam(attempt.id), saved);
      qc.invalidateQueries({ queryKey: qkExams(attempt.spaceId) });
    } catch (e) {
      setGradeError(noModel(e));
    } finally {
      setGrading(false);
    }
  };

  useEffect(() => {
    if (essay && !essay.grade && !tried.current) {
      tried.current = true;
      void grade();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topicsById = new Map<string, Pick<TopicRef, "id" | "title">>(attempt.data.topics.map((t) => [t.id, t]));
  return (
    <Page>
      <div className="flex items-center gap-3">
        <h1 className="text-page font-semibold">{s.exam.resultTitle(format.title, section.title)}</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => navigate({ name: "exam", spaceId: attempt.spaceId })}>
          {s.exam.back}
        </Button>
      </div>
      <section className="flex items-center gap-6 rounded-card border border-border px-6 py-5" data-testid="exam-result">
        <div className="flex flex-col">
          <span className="text-timer font-semibold tabular-nums">{r.scaled ?? `${Math.round(r.share * 100)}%`}</span>
          <span className={cn("text-label font-semibold", r.passed ? "text-success" : "text-muted")}>{r.passed ? s.exam.passed : s.exam.notPassed}</span>
        </div>
        <div className="flex flex-col gap-0.5 text-fg-secondary">
          <span>{s.exam.correct(r.correct, r.total)}</span>
          {r.essayPoints != null && essay?.grade ? <span>{s.exam.essayScore(r.essayPoints)}</span> : null}
          {format.scale ? <span className="text-label text-muted">{s.exam.passScore(format.scale.pass, format.scale.max)}</span> : null}
          <span className="text-label text-muted">{s.exam.timeUsed(Math.round(attempt.timeUsedMs / 60_000))}</span>
        </div>
      </section>

      {essay ? (
        <section className="flex flex-col gap-3 rounded-card border border-border px-5 py-4" data-testid="exam-essay-result">
          <h2 className="text-title-sm font-semibold">{s.exam.essay}</h2>
          {grading ? (
            <GeneratingStatus label={s.exam.grading} />
          ) : gradeError ? (
            <ErrorState title={s.exam.gradeError} error={gradeError} onRetry={grade} />
          ) : essay.grade ? (
            <>
              <ul className="flex flex-col gap-2">
                {essay.grade.traits.map((t) => (
                  <li key={t.trait} className="flex gap-3">
                    <span className="w-10 shrink-0 font-semibold tabular-nums">{s.exam.traitScore(t.score)}</span>
                    <span className="flex flex-col">
                      <span className="font-medium">{s.exam.traitNames[t.trait]}</span>
                      {t.reason ? <span className="text-fg-secondary">{t.reason}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {essay.grade.summary ? <p className="text-fg-secondary">{essay.grade.summary}</p> : null}
            </>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-card border border-border px-5 py-4" data-testid="exam-topics">
        <h2 className="text-title-sm font-semibold">{s.exam.byTopic}</h2>
        <ul className="flex flex-col gap-2">
          {r.byTopic.map((t) => {
            const share = t.correct / t.total;
            return (
              <li key={t.topicId} className="flex items-center gap-3" data-topic={t.topicId}>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-fill-subtle">
                  <span className={cn("block h-full rounded-full", share >= 0.6 ? "bg-success" : "bg-danger")} style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
                <span className="w-12 text-right text-label tabular-nums text-muted">
                  {t.correct}/{t.total}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate({ name: "practice", spaceId: attempt.spaceId, topicKey: t.topicId, topicTitle: topicsById.get(t.topicId)?.title })}
                >
                  {s.exam.practise}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setReviewOpen(!reviewOpen)} aria-expanded={reviewOpen} data-testid="exam-review-toggle">
            {s.exam.review}
          </Button>
          <Button variant="primary" className="ml-auto" onClick={() => navigate({ name: "exam", spaceId: attempt.spaceId })}>
            {s.exam.again}
          </Button>
        </div>
        <Collapse open={reviewOpen}>
          <ol className="flex flex-col gap-4 pt-2" data-testid="exam-review">
            {attempt.data.questions.map((q, n) => {
              const a = attempt.data.answers[n];
              return (
                <li key={n} className="flex flex-col gap-2 rounded-card border border-border px-4 py-3">
                  <span className="text-label font-semibold text-muted">{s.exam.question(n + 1, attempt.data.questions.length)}</span>
                  <Markdown text={q.question} />
                  <ul className="flex flex-col gap-1">
                    {q.options.map((o, k) => (
                      <li
                        key={k}
                        className={cn(
                          "rounded-item px-2.5 py-1.5",
                          k === q.answer ? "bg-success-soft" : k === a ? "bg-danger-soft" : "text-fg-secondary",
                        )}
                      >
                        <Markdown text={o} />
                      </li>
                    ))}
                  </ul>
                  {a == null ? <span className="text-label text-muted">{s.exam.noAnswer}</span> : null}
                  {q.explanation ? <p className="text-fg-secondary">{q.explanation}</p> : null}
                </li>
              );
            })}
          </ol>
        </Collapse>
      </section>
    </Page>
  );
}
