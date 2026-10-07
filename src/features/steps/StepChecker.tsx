import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { Calculator, Camera, Check, Eye, EyeOff, Lightbulb, Pencil, X } from "lucide-react";
import * as D from "@radix-ui/react-dialog";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toast } from "../../components/ui/toast";
import { Markdown } from "../chat/Markdown";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { api } from "../../lib/ipc";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { invalidateCards, useSpace } from "../../lib/queries";
import { checkSteps, type StepCheckResult, type StepVerdict } from "../../lib/steps/check";
import type { Transcription } from "../../lib/steps/vision";
import { s } from "../../lib/strings";
import { cn, plainMath } from "../../lib/utils";
import { imageFromClipboard } from "./image";
import { PhotoDialog } from "./PhotoDialog";

export interface StepCheckerProps {
  spaceId: string;
  problem?: string;
  expectedAnswer?: string;
  onResult?(r: StepCheckResult): void;
}

const LABEL = "text-label font-semibold text-muted";

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function Tex({ tex, className }: { tex: string; className?: string }) {
  const plain = plainMath(tex);
  const html = useMemo(() => {
    const t = tex.trim().replace(/^\$+|\$+$/g, "");
    try {
      return katex.renderToString(t, { throwOnError: false, displayMode: false });
    } catch {
      return null;
    }
  }, [tex]);
  if (plain != null) return <span className={cn("font-math", className)}>{plain}</span>;
  return html ? <span className={className} dangerouslySetInnerHTML={{ __html: html }} /> : <span className={className}>{tex}</span>;
}

function StepRow({
  n,
  text,
  verdict,
  afterWrong,
  isFirstWrong,
}: {
  n: number;
  text: string;
  verdict?: StepVerdict;
  afterWrong: boolean;
  isFirstWrong: boolean;
}) {
  return (
    <li
      data-testid="step-row"
      data-status={verdict ? (verdict.ok ? "ok" : "wrong") : "unchecked"}
      className={cn("group/row flex items-center gap-2.5 px-3 py-[9px] [&+&]:border-t [&+&]:border-divider", isFirstWrong && "bg-danger-soft")}
    >
      <span className="w-11 shrink-0 text-label text-muted">{s.steps.stepN(n)}</span>
      <Tex tex={text} className="min-w-0 flex-1 overflow-x-auto text-title-sm" />
      {!verdict || afterWrong ? (
        <span className="text-label text-faint" aria-hidden>
          —
        </span>
      ) : verdict.ok ? (
        <span className="flex h-[23.8px] items-center gap-1 text-success" title={verdict.checkedBy === "calc" ? s.steps.byCalc : undefined}>
          {verdict.checkedBy === "calc" && <Calculator size={12} className="opacity-0 group-hover/row:opacity-100" aria-hidden />}
          <Check size={15} aria-label={s.steps.stepOk} />
        </span>
      ) : (
        <span className="flex h-[23.8px] items-center">
          <X size={15} className="text-danger" aria-label={s.steps.stepWrong} />
        </span>
      )}
    </li>
  );
}

function FirstWrong({ verdict, note }: { verdict: StepVerdict; note?: string }) {
  const [showHint, setShowHint] = useState(false);
  const [showFix, setShowFix] = useState(false);
  return (
    <div className="flex flex-col gap-1.5" data-testid="first-wrong">
      <div className="-ml-[9px] flex gap-0.5">
        <Button variant="ghost" size="sm" aria-expanded={showHint} onClick={() => setShowHint(!showHint)}>
          <Lightbulb size={14} /> {s.steps.hint}
        </Button>
        {verdict.fix && (
          <Button variant="ghost" size="sm" aria-expanded={showFix} onClick={() => setShowFix(!showFix)}>
            {showFix ? <EyeOff size={14} /> : <Eye size={14} />} {showFix ? s.steps.hideFix : s.steps.showFix}
          </Button>
        )}
      </div>
      {showHint && (
        <div className="flex flex-col gap-1.5">
          {note && <p className="text-label text-muted">{note}</p>}
          {verdict.issue && (
            <div className="text-fg-secondary">
              <Markdown text={verdict.issue} />
            </div>
          )}
          {verdict.checkedBy === "calc" && (
            <p className="flex items-center gap-1.5 text-label text-muted">
              <Calculator size={12} aria-hidden /> {s.steps.byCalc}
            </p>
          )}
          {verdict.hint && (
            <div className="flex gap-2 text-fg-secondary">
              <Lightbulb size={14} className="mt-0.5 shrink-0" aria-label={s.steps.hint} />
              <Markdown text={verdict.hint} />
            </div>
          )}
          <p className="text-label text-muted">{s.steps.laterUnchecked}</p>
        </div>
      )}
      {showFix && verdict.fix && (
        <div className="flex flex-wrap items-center gap-2 rounded-pane bg-fill-subtle px-3 py-2" data-testid="step-fix">
          <span className="text-label text-muted">{s.steps.fix}:</span>
          <Tex tex={verdict.fix} />
        </div>
      )}
    </div>
  );
}

export function StepCheckerPanel({
  spaceId,
  problem: initialProblem,
  expectedAnswer,
  onResult,
  onBack,
  onClose,
}: StepCheckerProps & { onBack?: () => void; onClose?: () => void }) {
  const space = useSpace(spaceId);
  const [problem, setProblem] = useState(initialProblem ?? "");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ steps: string[]; r: StepCheckResult } | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [pasted, setPasted] = useState<Blob | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setProblem(initialProblem ?? ""), [initialProblem]);
  useEffect(() => () => abort.current?.abort(), []);

  const lines = linesOf(text);
  const fresh = result && result.steps.join("\n") === lines.join("\n") ? result.r : null;
  const summaryNote = fresh
    ? [fresh.summary, fresh.finalCorrect != null && (fresh.finalCorrect ? s.steps.finalRight : s.steps.finalWrong)].filter(Boolean).join(" · ")
    : "";

  const check = async () => {
    if (!lines.length) return setError(new Error(s.steps.needSteps));
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
    setEditing(false);
    try {
      const llm = await resolveChatModel(space.data);
      const r = await checkSteps(llm, { problem, steps: lines, expectedAnswer }, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setResult({ steps: lines, r });
      onResult?.(r);
      if (r.firstWrong != null) {
        const v = r.verdicts[r.firstWrong];
        try {
          await api.mistakesAdd(spaceId, [
            {
              origin: s.steps.origin,
              question: problem.trim() || lines[0],
              given: lines[r.firstWrong],
              correct: v.fix ?? v.issue ?? s.steps.calcHint,
              explanation: v.fix ? (v.issue ?? null) : (v.hint ?? null),
            },
          ]);
          invalidateCards(spaceId);
          toast.success(s.steps.saved);
        } catch (e) {
          console.error(e);
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof NoModelError ? new Error(s.chat.noModel) : e);
        setEditing(true);
      }
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const fromPhoto = (t: Transcription) => {
    if (t.problem && !problem.trim()) setProblem(t.problem);
    setText(t.steps.join("\n"));
    setResult(null);
    setError(null);
    setEditing(true);
    setReadNote(s.steps.readDone(t.steps.length));
  };

  const firstWrong = fresh?.firstWrong ?? null;

  return (
    <div
      className="h-full min-h-0"
      onPaste={(e) => {
        const f = imageFromClipboard(e);
        if (f && !photoOpen) {
          e.preventDefault();
          setPasted(f);
          setPhotoOpen(true);
        }
      }}
    >
      <StudioSubpanel
        title={s.steps.title}
        testId="step-checker"
        onBack={onBack}
        onClose={onClose}
        footer={
          <>
            <Button variant="primary" disabled={busy || !lines.length} onClick={check}>
              {busy && <Spinner size={14} className="text-on-primary" />}
              {busy ? s.steps.checking : s.steps.check}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPasted(null);
                setPhotoOpen(true);
              }}
            >
              <Camera size={15} /> {s.steps.usePhoto}
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>{s.steps.problem}</span>
          <Input value={problem} placeholder={s.steps.problemPlaceholder} onChange={(e) => setProblem(e.target.value)} />
        </label>
        <div className={cn("group flex flex-col", editing ? "gap-1.5" : "gap-3.5")}>
          <div className="relative flex items-center">
            <span className={LABEL}>{s.steps.yourSteps}</span>
            {!editing && (
              <Button variant="ghost" size="sm" className="absolute right-0 top-1/2 h-6 -translate-y-1/2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => setEditing(true)}>
                <Pencil size={14} /> {s.steps.edit}
              </Button>
            )}
          </div>
          {editing ? (
            <>
              <Textarea
                aria-label={s.steps.steps}
                rows={5}
                className="min-h-[72px] text-title-sm"
                value={text}
                placeholder={s.steps.stepsPlaceholder}
                onChange={(e) => {
                  setText(e.target.value);
                  setReadNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void check();
                  }
                }}
              />
              <p className="text-label text-muted">{readNote ?? s.steps.stepsHint}</p>
            </>
          ) : busy ? (
            <ol className="rounded-card border border-border" aria-live="polite">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="px-3 py-[9px] [&+&]:border-t [&+&]:border-divider">
                  <Skeleton className="h-5 rounded-kbd" />
                </li>
              ))}
            </ol>
          ) : (
            <ol className="rounded-card border border-border [&_.katex]:text-[1em]" aria-live="polite">
              {lines.map((l, i) => (
                <StepRow
                  key={`${i}:${l}`}
                  n={i + 1}
                  text={l}
                  verdict={fresh?.verdicts[i]}
                  afterWrong={firstWrong != null && i > firstWrong}
                  isFirstWrong={firstWrong === i}
                />
              ))}
            </ol>
          )}
        </div>
        {error != null && !busy && (
          <ErrorState size="sm" title={s.steps.checkFailed} error={error} onRetry={lines.length ? check : undefined} />
        )}
        {fresh && !editing && !busy && (
          <div className="flex flex-col gap-1.5" data-testid="step-summary">
            <p className={cn("font-semibold", firstWrong == null ? "text-success" : "text-danger-text")}>
              {firstWrong == null ? s.steps.allGood : s.steps.firstWrong(firstWrong + 1)}
            </p>
            {firstWrong != null ? (
              <FirstWrong verdict={fresh.verdicts[firstWrong]} note={summaryNote} />
            ) : (
              summaryNote && <p className="text-label text-muted">{summaryNote}</p>
            )}
          </div>
        )}
        <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} spaceId={spaceId} initialImage={pasted} onRead={fromPhoto} />
      </StudioSubpanel>
    </div>
  );
}

export function StepCheckerDialog({
  open,
  onOpenChange,
  spaceId,
  problem,
  expectedAnswer,
  onResult,
}: StepCheckerProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="t-modal-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          onFocusOutside={(e) => e.preventDefault()}
          className="t-modal fixed left-1/2 top-1/2 z-50 h-[min(640px,calc(100vh-48px))] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-dialog border border-border bg-surface shadow-dialog outline-none"
        >
          <D.Title className="sr-only">{s.steps.title}</D.Title>
          <D.Description className="sr-only">{s.steps.title}</D.Description>
          <StepCheckerPanel spaceId={spaceId} problem={problem} expectedAnswer={expectedAnswer} onResult={onResult} onClose={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
