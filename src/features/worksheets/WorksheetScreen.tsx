import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Check, ChevronDown, Copy, Download, Pencil, Printer, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BorderBeam } from "border-beam";
import { useIsDark } from "../../app/useTheme";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { IconSwap } from "../../components/motion/IconSwap";
import { NumberPop } from "../../components/motion/NumberPop";
import { Reveal } from "../../components/motion/Reveal";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { effectiveLanguage } from "../../lib/i18n/language";
import { api } from "../../lib/ipc";
import { useSpace } from "../../lib/queries";
import { answerText } from "../../lib/questions/grade";
import { s } from "../../lib/strings";
import { utf8 } from "../../lib/studio/export";
import { toDocx, toMarkdown } from "../../lib/worksheets/export";
import { gradeOpenParts, regenerateTask, sheetMaterial, generateSheet, NoMaterialError } from "../../lib/worksheets/generate";
import { partAnswerText, partKey, partPrompt, scoreSheet } from "../../lib/worksheets/grade";
import { optionLabel, sheetLabels } from "../../lib/worksheets/labels";
import { paperResponses } from "../../lib/worksheets/paper";
import { paperReadPrompt } from "../../lib/worksheets/prompts";
import { gradeFor, scaleRows, validThresholds } from "../../lib/worksheets/presets";
import { emptyAttempt, type Attempt, type PartResponse, type Part, type Sheet, type Task, type WorksheetDoc } from "../../lib/worksheets/types";
import { useUi } from "../../stores/ui";
import { PhotoDialog } from "../steps/PhotoDialog";
import { PartView } from "./PartView";
import { SheetPrint } from "./SheetPrint";

export const qkWorksheets = (spaceId: string) => ["worksheets", spaceId] as const;
export const qkWorksheet = (id: string) => ["worksheet", id] as const;

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const noModel = (e: unknown) => (e instanceof NoModelError ? new Error(s.chat.noModel) : e instanceof NoMaterialError ? new Error(s.outputs.noMaterial) : e);

export function WorksheetScreen({ spaceId, worksheetId }: { spaceId: string; worksheetId: string }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const setStudioView = useUi((st) => st.setStudioView);
  const space = useSpace(spaceId);
  const q = useQuery({ queryKey: qkWorksheet(worksheetId), queryFn: () => api.worksheetGet(worksheetId) });
  const [doc, setDoc] = useState<WorksheetDoc | null>(null);
  const [printKey, setPrintKey] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<null | "task" | "variant">(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [exported, setExported] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<WorksheetDoc | null>(null);
  const dark = useIsDark();

  useEffect(() => {
    if (!unsaved.current) setDoc(q.data ?? null);
  }, [q.data]);

  const save = (next: WorksheetDoc) =>
    api
      .worksheetSave(next)
      .then((saved) => {
        if (unsaved.current === next) {
          unsaved.current = null;
          qc.setQueryData(qkWorksheet(saved.id), saved);
        }
        void qc.invalidateQueries({ queryKey: qkWorksheets(spaceId) });
      })
      .catch((e) => toastError(s.errors.generic, e));

  useEffect(
    () => () => {
      if (saveTimer.current && unsaved.current) {
        clearTimeout(saveTimer.current);
        void save(unsaved.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const persist = (next: WorksheetDoc, now = false) => {
    setDoc(next);
    unsaved.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (now) return void save(next);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save(next);
    }, 500);
  };

  const back = () => {
    navigate({ name: "space", spaceId });
    setStudioView("worksheet");
  };

  if (q.isLoading || space.isLoading) return <Shell><Skeleton className="h-96 rounded-card" /></Shell>;
  if (q.error) return <Shell><ErrorState title={s.worksheets.loadFailed} error={q.error} onRetry={() => q.refetch()} /></Shell>;
  if (!q.data || !doc) return <Shell><ErrorState title={s.worksheets.notFound} error={null} onRetry={back} /></Shell>;

  const sheet = doc.sheet;
  const attempt: Attempt = doc.attempt ?? emptyAttempt();
  const language = sheet.options.language;
  const l = sheetLabels(language);
  const checked = attempt.checkedAt != null;
  const score = scoreSheet(sheet, attempt);
  const grade = checked ? gradeFor(sheet.options.scale, score.share) : null;
  const spaceLanguage = effectiveLanguage(space.data?.language);

  const setSheet = (next: Sheet) => persist({ ...doc, sheet: next, title: next.title }, false);
  const setTask = (id: string, patch: (t: Task) => Task) => setSheet({ ...sheet, tasks: sheet.tasks.map((t) => (t.id === id ? patch(t) : t)) });
  const setAttempt = (next: Attempt) => persist({ ...doc, attempt: next });

  const answer = (task: Task, pi: number, r: PartResponse) => {
    const cur = attempt.responses[task.id] ?? task.parts.map(() => null);
    setAttempt({ ...attempt, checkedAt: null, responses: { ...attempt.responses, [task.id]: cur.map((x, i) => (i === pi ? r : x)) } });
  };

  const addMistakes = async (a: Attempt) => {
    const s2 = scoreSheet(sheet, a);
    const items = sheet.tasks.flatMap((t, ti) =>
      t.parts.flatMap((p, pi) => {
        if (s2.tasks[ti].credits[pi] >= 1) return [];
        const given = partAnswerText(p, a.responses[t.id]?.[pi]);
        if (!given) return [];
        const og = p.kind === "open" ? a.open[`${t.id}:${pi}`] : undefined;
        return [
          {
            origin: "worksheet",
            question: partPrompt(p),
            given,
            correct: partKey(p),
            explanation: og?.reason || ("explanation" in p ? (p.explanation ?? null) : null),
            topic: sheet.title,
            options: p.kind === "mc" || p.kind === "multi" ? p.options : null,
          },
        ];
      }),
    );
    if (items.length) await api.mistakesAdd(spaceId, items);
    return items.length;
  };

  const check = async (base: Attempt = attempt) => {
    setChecking(true);
    try {
      let open = base.open;
      const needsModel = sheet.tasks.some((t) => t.parts.some((p, i) => p.kind === "open" && base.responses[t.id]?.[i] && !open[`${t.id}:${i}`]));
      if (needsModel) {
        const llm = await resolveChatModel(space.data).catch((e) => {
          throw noModel(e);
        });
        open = { ...open, ...(await gradeOpenParts(llm, sheet, base)) };
      }
      const next: Attempt = { ...base, open, checkedAt: Date.now() };
      persist({ ...doc, attempt: next }, true);
      setShakeKey((k) => k + 1);
      if (!base.checkedAt) {
        const n = await addMistakes(next).catch(() => 0);
        if (n) toast.success(s.worksheets.mistakesAdded(n));
      }
    } catch (e) {
      toastError(s.worksheets.checkFailed, noModel(e));
    } finally {
      setChecking(false);
    }
  };

  const reset = () => persist({ ...doc, attempt: emptyAttempt() }, true);

  const exportAs = async (kind: "md" | "mdKey" | "mdKeyOnly" | "docx" | "docxKey") => {
    try {
      const ext = kind.startsWith("docx") ? "docx" : "md";
      const bytes = kind.startsWith("docx") ? await toDocx(sheet, { key: kind === "docxKey" }) : utf8(toMarkdown(sheet, { key: kind !== "md", keyOnly: kind === "mdKeyOnly" }));
      const path = await api.exportFile(sheet.title + (kind === "mdKeyOnly" ? ` (${l.key})` : ""), ext, bytes);
      if (path) {
        toast.success(s.outputs.exported(path));
        setExported(true);
        setTimeout(() => setExported(false), 2200);
      }
    } catch (e) {
      toastError(s.outputs.exportFailed, e);
    }
  };

  const print = async () => {
    try {
      await api.printWindow();
    } catch (e) {
      toastError(s.outputs.printFailed, e);
    }
  };

  const remakeTask = async (task: Task) => {
    setBusy("task");
    try {
      const llm = await resolveChatModel(space.data).catch((e) => {
        throw noModel(e);
      });
      const material = await sheetMaterial(spaceId, sheet.options, llm);
      const next = await regenerateTask(llm, sheet, task.id, material.text);
      const responses = { ...attempt.responses };
      delete responses[task.id];
      persist({ ...doc, sheet: { ...sheet, tasks: sheet.tasks.map((t) => (t.id === task.id ? next : t)) }, attempt: { ...attempt, responses, checkedAt: null } }, true);
    } catch (e) {
      toastError(s.worksheets.failed, noModel(e));
    } finally {
      setBusy(null);
    }
  };

  const variantB = async () => {
    setBusy("variant");
    try {
      const llm = await resolveChatModel(space.data).catch((e) => {
        throw noModel(e);
      });
      const material = await sheetMaterial(spaceId, sheet.options, llm);
      const avoid = sheet.tasks.flatMap((t) => t.parts.map(partPrompt));
      const made = await generateSheet(llm, sheet.options, material, { avoid });
      const { replaced: _r, ...rest } = made;
      const saved = await api.worksheetSave({ spaceId, title: `${made.title} (B)`, sheet: { ...rest, title: `${made.title} (B)` }, attempt: null });
      void qc.invalidateQueries({ queryKey: qkWorksheets(spaceId) });
      navigate({ name: "worksheet", spaceId, worksheetId: saved.id });
    } catch (e) {
      toastError(s.worksheets.failed, noModel(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    try {
      await api.worksheetDelete(doc.id);
      qc.removeQueries({ queryKey: qkWorksheet(doc.id) });
      await qc.invalidateQueries({ queryKey: qkWorksheets(spaceId) });
      back();
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };

  const rows = scaleRows(sheet.options.scale, score.max);
  const thresholds = sheet.options.scale.thresholds;
  const setThreshold = (i: number, v: number) => {
    const t = thresholds.map((x, k) => (k === i ? v : x));
    if (validThresholds(t)) setSheet({ ...sheet, options: { ...sheet.options, scale: { ...sheet.options.scale, thresholds: t } } });
  };

  const content = (
    <>
      <article className="print-root flex flex-col gap-5" data-testid="worksheet" data-checked={checked}>
        <header className="flex flex-col gap-1.5 print:hidden">
          <span className="text-label font-semibold text-muted">
            {s.worksheets.presets[sheet.options.preset].name} · {score.max} {l.points} · {sheet.sources?.join(", ")}
          </span>
          <h1 className="text-page font-semibold" data-testid="worksheet-title">{sheet.title}</h1>
          {sheet.instructions && <p className="text-fg-secondary">{sheet.instructions}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-body text-muted">
            {[l.name, l.className, l.date].map((f) => (
              <span key={f} className="flex min-w-32 flex-1 border-b border-border-hover pb-0.5">{f}:</span>
            ))}
          </div>
        </header>
        <ol className="flex flex-col gap-4 print:hidden" data-testid="worksheet-tasks">
          {sheet.tasks.map((task, ti) => {
            const ts = score.tasks[ti];
            const full = checked && ts.points >= ts.max;
            const bad = checked && ts.points < ts.max;
            const isEditing = editing === task.id;
            return (
              <Reveal as="li" index={ti} key={task.id} data-testid="worksheet-task" data-task={task.id}>
                <section
                  className={`rounded-card border px-4 py-3.5 ${full ? "border-success" : bad ? "border-danger" : "border-border"} ${bad ? "t-input is-shaking" : ""}`}
                  key={bad ? `${task.id}-${shakeKey}` : task.id}
                  aria-label={`${l.task} ${ti + 1}`}
                >
                  <div className="flex flex-wrap items-center gap-2 pb-2">
                    <h2 className="text-title font-semibold">
                      {l.task} {ti + 1}: {l.types[task.type]}
                    </h2>
                    <span className="text-label text-muted" data-testid="task-points">
                      {checked ? `${pts(ts.points)} / ${pts(task.points)}` : `${pts(task.points)} ${l.points}`}
                    </span>
                    {full && (
                      <span className="text-success" data-testid="task-ok">
                        <SuccessCircleCheck size={16} />
                      </span>
                    )}
                    <span className="ms-auto flex items-center gap-1 print:hidden">
                      <Button variant="ghost-muted" size="icon-sm" title={s.worksheets.editTask} aria-label={s.worksheets.editTask} aria-pressed={isEditing} onClick={() => setEditing(isEditing ? null : task.id)}>
                        <Pencil size={13} />
                      </Button>
                      <Button variant="ghost-muted" size="icon-sm" title={s.worksheets.regenerateTask} aria-label={s.worksheets.regenerateTask} disabled={!!busy} onClick={() => void remakeTask(task)} data-testid="regenerate-task">
                        <RefreshCw size={13} className={busy === "task" ? "animate-spin" : undefined} />
                      </Button>
                    </span>
                  </div>
                  {isEditing ? (
                    <TaskEditor task={task} onChange={(fn) => setTask(task.id, fn)} />
                  ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-fg-secondary">{task.correctFalse ? `${task.instruction} ${l.correctFalse}` : task.instruction}</p>
                      {task.passage && <p className="rounded-card border border-border bg-fill-faint px-3.5 py-3">{task.passage}</p>}
                      {task.parts.map((_, pi) => (
                        <PartView
                          key={pi}
                          task={task}
                          pi={pi}
                          value={attempt.responses[task.id]?.[pi]}
                          onChange={(r) => answer(task, pi, r)}
                          reveal={checked}
                          labelStyle={sheet.options.labelStyle}
                          language={language}
                          open={attempt.open}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </Reveal>
            );
          })}
        </ol>
        {checked && (
          <section className="flex flex-col gap-3 rounded-card border border-border bg-fill-faint px-4 py-3.5 print:hidden" data-testid="worksheet-result">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-page font-semibold" data-testid="result-points">
                <NumberPop text={pts(score.points)} popKey={score.points} onMount />
              </span>
              <span className="text-fg-secondary">
                {l.from} {pts(score.max)} {l.points}
              </span>
              {grade && (
                <span className="font-semibold" data-testid="result-grade">
                  {l.grade}: <NumberPop text={grade.label} popKey={grade.label} onMount />
                </span>
              )}
            </p>
            {rows.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="grade-scale">
                <span className="text-label font-semibold text-muted">{l.gradeScale}</span>
                <div className="flex flex-wrap gap-2">
                  {rows.map((r, i) => (
                    <label key={r.grade} className="flex flex-col items-start gap-1 text-label text-muted">
                      <span>
                        {r.grade}: {r.min === r.max ? pts(r.min) : `${pts(r.min)}–${pts(r.max)}`}
                      </span>
                      {i < thresholds.length && (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          aria-label={s.worksheets.thresholdLabel(r.grade)}
                          defaultValue={thresholds[i]}
                          onChange={(e) => setThreshold(i, Number(e.target.value))}
                          className="h-8 w-20"
                        />
                      )}
                    </label>
                  ))}
                </div>
                <span className="text-label text-muted">{s.worksheets.thresholdHelp}</span>
              </div>
            )}
          </section>
        )}
        <SheetPrint sheet={sheet} withKey={printKey} />
      </article>
    </>
  );

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost-muted" size="sm" onClick={back} className="-ms-2">
          <ArrowLeft size={14} />
          {space.data ? s.common.backTo(space.data.name) : s.outputs.back}
        </Button>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-body text-fg-secondary">
            <Switch checked={printKey} onCheckedChange={setPrintKey} label={s.worksheets.printKey} />
            {s.worksheets.printKey}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPhoto(true)} disabled={checking} data-testid="paper-photo">
            <Camera size={13} />
            {s.worksheets.photo}
          </Button>
          {checked ? (
            <Button variant="secondary" size="sm" onClick={reset} data-testid="worksheet-retry">
              <RefreshCw size={13} />
              {s.worksheets.tryAgain}
            </Button>
          ) : null}
          <Button variant="primary" size="sm" onClick={() => void check()} disabled={checking || checked} data-testid="worksheet-check">
            {checking ? <ActivityOrb activity="grade" size={16} inverse /> : <Check size={13} />}
            {checking ? s.worksheets.checking : s.worksheets.check}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" data-testid="worksheet-export">
                <IconSwap value={exported ? "check" : "download"} icons={{ download: Download, check: Check }} size={13} />
                {s.outputs.export}
                <ChevronDown size={13} className="text-muted" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => void print()}>
                <Printer size={14} />
                {s.worksheets.pdf}
              </MenuItem>
              <MenuItem onSelect={() => void exportAs("docx")}>{s.worksheets.docx}</MenuItem>
              <MenuItem onSelect={() => void exportAs("docxKey")}>{s.worksheets.docxKey}</MenuItem>
              <MenuItem onSelect={() => void exportAs("md")}>{s.worksheets.md}</MenuItem>
              <MenuItem onSelect={() => void exportAs("mdKey")}>{s.worksheets.mdKey}</MenuItem>
              <MenuItem onSelect={() => void exportAs("mdKeyOnly")}>{s.worksheets.keyOnly}</MenuItem>
            </MenuContent>
          </Menu>
          <Button variant="secondary" size="sm" onClick={() => void variantB()} disabled={!!busy} data-testid="worksheet-variant">
            <Copy size={13} />
            {s.worksheets.variantB}
          </Button>
          <Button variant="ghost-muted" size="icon-sm" title={s.outputs.delete} aria-label={s.outputs.delete} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {busy === "variant" ? (
        <BorderBeam size="md" colorVariant="mono" theme={dark ? "dark" : "light"} active duration={2.4} strength={0.8} borderRadius={10}>
          <div className="flex items-center gap-3 rounded-card border border-border px-3.5 py-3" role="status" data-testid="worksheet-busy">
            <ActivityOrb activity="write" size={32} />
            <span className="font-medium">{s.worksheets.makingVariant}</span>
          </div>
        </BorderBeam>
      ) : null}
      {content}
      <PhotoDialog
        open={photo}
        onOpenChange={setPhoto}
        spaceId={spaceId}
        prompt={paperReadPrompt(sheet.tasks)}
        onRead={(t) => {
          setPhoto(false);
          const responses = paperResponses(sheet, t.steps);
          if (!Object.keys(responses).length) return toastError(s.worksheets.photoEmpty, new Error(s.steps.nothingRead));
          const merged: Attempt = { ...emptyAttempt(), responses: { ...attempt.responses, ...responses } };
          persist({ ...doc, attempt: merged }, true);
          void check(merged);
        }}
      />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={s.worksheets.deleteTitle} body={s.worksheets.deleteBody} confirmLabel={s.outputs.delete} danger onConfirm={() => void remove()} />
      <span className="sr-only" data-language={spaceLanguage} />
    </Shell>
  );
}

function TaskEditor({ task, onChange }: { task: Task; onChange: (fn: (t: Task) => Task) => void }) {
  const setPart = (pi: number, fn: (p: Part) => Part) => onChange((t) => ({ ...t, parts: t.parts.map((p, i) => (i === pi ? fn(p) : p)) }));
  return (
    <div className="flex flex-col gap-3" data-testid="task-editor">
      <label className="flex flex-col gap-1">
        <span className="text-label font-semibold text-muted">{s.worksheets.instruction}</span>
        <Input value={task.instruction} onChange={(e) => onChange((t) => ({ ...t, instruction: e.target.value }))} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label font-semibold text-muted">{s.worksheets.pointsLabel}</span>
        <Input type="number" min={0.5} step={0.5} className="w-24" value={task.points} onChange={(e) => Number(e.target.value) > 0 && onChange((t) => ({ ...t, points: Number(e.target.value) }))} />
      </label>
      {task.parts.map((p, pi) => (
        <div key={pi} className="flex flex-col gap-2 rounded-card border border-border px-3 py-2.5">
          {"prompt" in p && (
            <Input aria-label={s.worksheets.question} value={p.prompt} onChange={(e) => setPart(pi, (x) => ({ ...x, prompt: e.target.value }) as Part)} />
          )}
          {(p.kind === "mc" || p.kind === "multi") &&
            p.options.map((o, oi) => (
              <Input
                key={oi}
                aria-label={s.worksheets.optionN(oi + 1)}
                value={o}
                onChange={(e) => setPart(pi, (x) => ({ ...x, options: (x as typeof p).options.map((y, k) => (k === oi ? e.target.value : y)) }) as Part)}
              />
            ))}
          {p.kind === "fill" && (
            <Input aria-label={s.worksheets.answerKey} value={p.accepted.join(" | ")} onChange={(e) => setPart(pi, (x) => ({ ...x, accepted: e.target.value.split("|").map((a) => a.trim()).filter(Boolean) }) as Part)} />
          )}
          {p.kind === "open" && <Input aria-label={s.worksheets.answerKey} value={p.key} onChange={(e) => setPart(pi, (x) => ({ ...x, key: e.target.value }) as Part)} />}
          <p className="text-label text-muted">{s.worksheets.keyIs(partKey(p) || answerText(p as never))}</p>
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-y-auto print:block print:h-auto print:overflow-visible">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-10 pb-12 pt-8" data-testid="worksheet-screen">
        {children}
      </div>
    </div>
  );
}

export { optionLabel };
