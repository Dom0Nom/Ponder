import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { Calculator, Camera, Check, ListChecks, Lightbulb, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Textarea } from "../../components/ui/input";
import { EmptyState, ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toast } from "../../components/ui/toast";
import { Markdown } from "../chat/Markdown";
import { api } from "../../lib/ipc";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { invalidateCards, useSpace } from "../../lib/queries";
import { checkSteps, type StepCheckResult, type StepVerdict } from "../../lib/steps/check";
import type { Transcription } from "../../lib/steps/vision";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { imageFromClipboard } from "./image";
import { PhotoDialog } from "./PhotoDialog";

export interface StepCheckerProps {
  spaceId: string;
  problem?: string;
  expectedAnswer?: string;
  onResult?(r: StepCheckResult): void;
}

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function Tex({ tex, className }: { tex: string; className?: string }) {
  const html = useMemo(() => {
    const t = tex.trim().replace(/^\$+|\$+$/g, "");
    try {
      return katex.renderToString(t, { throwOnError: false, displayMode: false });
    } catch {
      return null;
    }
  }, [tex]);
  return html ? <span className={className} dangerouslySetInnerHTML={{ __html: html }} /> : <span className={className}>{tex}</span>;
}

function StepRow({ n, text, verdict, isFirstWrong }: { n: number; text: string; verdict?: StepVerdict; isFirstWrong: boolean }) {
  const [showFix, setShowFix] = useState(false);
  const wrong = verdict && !verdict.ok;
  return (
    <li
      data-testid="step-row"
      data-status={verdict ? (verdict.ok ? "ok" : "wrong") : "unchecked"}
      className={cn(
        "rounded-xl px-3 py-2",
        isFirstWrong ? "border border-danger bg-danger-soft" : wrong ? "bg-surface-2" : "",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs text-muted">{s.steps.stepN(n)}</span>
        <Tex tex={text} className="min-w-0 flex-1 overflow-x-auto" />
        {verdict &&
          (verdict.ok ? (
            <span className="flex items-center gap-1 text-xs text-success" title={verdict.checkedBy === "calc" ? s.steps.byCalc : undefined}>
              <Check size={15} aria-label={s.steps.stepOk} />
              {verdict.checkedBy === "calc" && <Calculator size={12} aria-hidden />}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-danger">
              <X size={15} aria-hidden /> {s.steps.stepWrong}
            </span>
          ))}
      </div>
      {isFirstWrong && verdict && (
        <div className="mt-2 space-y-2 border-t border-danger/30 pt-2 text-sm" data-testid="first-wrong">
          {verdict.issue && <Markdown text={verdict.issue} />}
          {verdict.checkedBy === "calc" && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Calculator size={12} aria-hidden /> {s.steps.byCalc}
            </p>
          )}
          {verdict.hint && (
            <div className="flex gap-2 text-muted">
              <Lightbulb size={15} className="mt-0.5 shrink-0" aria-label={s.steps.hint} />
              <Markdown text={verdict.hint} />
            </div>
          )}
          {verdict.fix &&
            (showFix ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="step-fix">
                <span className="text-xs text-muted">{s.steps.fix}:</span>
                <Tex tex={verdict.fix} />
                <Button size="sm" variant="ghost" onClick={() => setShowFix(false)}>
                  {s.steps.hideFix}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="tonal" onClick={() => setShowFix(true)}>
                {s.steps.showFix}
              </Button>
            ))}
          <p className="text-xs text-muted">{s.steps.laterUnchecked}</p>
        </div>
      )}
    </li>
  );
}

export function StepChecker({ spaceId, problem: initialProblem, expectedAnswer, onResult }: StepCheckerProps) {
  const space = useSpace(spaceId);
  const [problem, setProblem] = useState(initialProblem ?? "");
  const [text, setText] = useState("");
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

  const check = async () => {
    if (!lines.length) return setError(new Error(s.steps.needSteps));
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
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
      if (!ac.signal.aborted) setError(e instanceof NoModelError ? new Error(s.chat.noModel) : e);
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const fromPhoto = (t: Transcription) => {
    if (t.problem && !problem.trim()) setProblem(t.problem);
    setText(t.steps.join("\n"));
    setResult(null);
    setError(null);
    setReadNote(s.steps.readDone(t.steps.length));
  };

  return (
    <div
      className="space-y-4"
      data-testid="step-checker"
      onPaste={(e) => {
        const f = imageFromClipboard(e);
        if (f && !photoOpen) {
          e.preventDefault();
          setPasted(f);
          setPhotoOpen(true);
        }
      }}
    >
      <div>
        <Label htmlFor="step-problem">{s.steps.problem}</Label>
        <Input id="step-problem" value={problem} placeholder={s.steps.problemPlaceholder} onChange={(e) => setProblem(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="step-lines">{s.steps.steps}</Label>
        <Textarea
          id="step-lines"
          rows={5}
          className="font-mono"
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
        <p className="mt-1 text-xs text-muted">{readNote ?? s.steps.stepsHint}</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setPasted(null);
            setPhotoOpen(true);
          }}
        >
          <Camera size={16} /> {s.steps.usePhoto}
        </Button>
        <Button variant="primary" disabled={busy || !lines.length} onClick={check}>
          {busy ? <Spinner className="text-on-accent" /> : <ListChecks size={16} />}
          {busy ? s.steps.checking : s.steps.check}
        </Button>
      </div>

      {error != null && !busy ? (
        <ErrorState title={s.steps.checkFailed} error={error} onRetry={lines.length ? check : undefined} className="py-4" />
      ) : null}

      {lines.length === 0 ? (
        <EmptyState icon={<ListChecks size={20} />} title={s.steps.emptyTitle} body={s.steps.emptyBody} className="py-6" />
      ) : (
        <div className="space-y-2" aria-live="polite">
          {fresh && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="step-summary">
              <p className={cn("font-medium", fresh.firstWrong == null ? "text-success" : "text-danger")}>
                {fresh.firstWrong == null ? s.steps.allGood : s.steps.firstWrong(fresh.firstWrong + 1)}
              </p>
              {fresh.summary && <p className="text-muted">{fresh.summary}</p>}
              {fresh.finalCorrect != null && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    fresh.finalCorrect ? "bg-success/15 text-success" : "bg-danger-soft text-danger",
                  )}
                >
                  {fresh.finalCorrect ? s.steps.finalRight : s.steps.finalWrong}
                </span>
              )}
            </div>
          )}
          {busy && <Skeleton className="h-4 w-48" />}
          {!fresh && !busy && <p className="text-xs font-medium text-muted">{s.steps.preview}</p>}
          <ol className="space-y-1">
            {lines.map((l, i) => (
              <StepRow
                key={`${i}:${l}`}
                n={i + 1}
                text={l}
                verdict={fresh?.verdicts[i]}
                isFirstWrong={fresh?.firstWrong === i}
              />
            ))}
          </ol>
        </div>
      )}

      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} spaceId={spaceId} initialImage={pasted} onRead={fromPhoto} />
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  spaceId: string;
  problem?: string;
  expectedAnswer?: string;
  onResult?(r: StepCheckResult): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.steps.title} className="w-[min(720px,calc(100vw-32px))]">
      <div className="pb-4">
        <StepChecker spaceId={spaceId} problem={problem} expectedAnswer={expectedAnswer} onResult={onResult} />
      </div>
    </Dialog>
  );
}

/** Temporary Studio entry point until the practice screen embeds the checker. */
export function StepCheckerButton({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <ListChecks size={15} className="text-muted" /> {s.steps.title}
      </h3>
      <p className="text-xs text-muted">{s.steps.cardHint}</p>
      <Button size="sm" className="mt-3" data-testid="step-checker-button" onClick={() => setOpen(true)}>
        {s.steps.open}
      </Button>
      <StepCheckerDialog open={open} onOpenChange={setOpen} spaceId={spaceId} />
    </div>
  );
}
