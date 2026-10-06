import { useMemo, useState } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { generateText } from "ai";
import { ClipboardCheck, Map as MapIcon, MoreHorizontal } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useCurriculum, useLevels, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, SpaceCurriculum, TopicLevelValue, TopicRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { coverageLevel, topicQuery, type CoverageLevel } from "../../lib/placement/logic";
import { runPlacement, startTopic } from "../../lib/placement/flows";
import { extractJson } from "../../lib/chat/json";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Dialog, ConfirmDialog } from "../../components/ui/dialog";
import { Label, Textarea } from "../../components/ui/input";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

const COVERAGE_DOT: Record<CoverageLevel, string> = {
  covered: "bg-success",
  partial: "bg-warn",
  missing: "border border-faint bg-transparent",
};

const LEVEL_TONE: Record<TopicLevelValue, string> = {
  strong: "bg-success/15 text-success",
  ok: "bg-accent-soft text-accent-text",
  weak: "bg-warn-soft text-warn",
  unknown: "",
};

export function PlanCard({ space }: { space: Space }) {
  const cur = useCurriculum(space.id);
  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4" data-testid="plan-card">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <MapIcon size={15} className="text-muted" /> {s.plan.title}
      </h3>
      {cur.isLoading && <Skeleton className="h-16" />}
      {cur.error && <ErrorState title={s.errors.generic} error={cur.error} onRetry={() => cur.refetch()} />}
      {cur.data === null && <CurriculumPicker space={space} />}
      {cur.data && <CoverageMap space={space} curriculum={cur.data} />}
    </div>
  );
}

export function CurriculumPicker({ space, onDone }: { space: Space; onDone?: () => void }) {
  const qc = useQueryClient();
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const choose = async (id: string) => {
    const c = curriculumById(id);
    if (!c) return;
    try {
      await api.curriculumSet(space.id, c.id, c.title, c.topics);
      qc.invalidateQueries({ queryKey: qk.curriculum(space.id) });
      onDone?.();
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-muted">{s.plan.pickBody}</p>
      <div className="flex flex-wrap gap-1.5">
        {CURRICULA.map((c) => (
          <button
            key={c.id}
            disabled={busy}
            onClick={() => choose(c.id)}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            {c.title}
          </button>
        ))}
        <button
          onClick={() => setCustom(true)}
          className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
        >
          {s.plan.custom}
        </button>
      </div>
      <CustomCurriculumDialog
        open={custom}
        onOpenChange={setCustom}
        space={space}
        busy={busy}
        setBusy={setBusy}
        onDone={() => {
          qc.invalidateQueries({ queryKey: qk.curriculum(space.id) });
          onDone?.();
        }}
      />
    </div>
  );
}

function CustomCurriculumDialog({
  open,
  onOpenChange,
  space,
  busy,
  setBusy,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  space: Space;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const submit = async () => {
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      const r = await generateText({
        model: llm.model,
        ...llm.options({ thinking: false }),
        prompt: `Turn this syllabus or topic list into a study curriculum of 5 to 25 topics, in learning order, in the syllabus's language. Group related topics.\n\n"""\n${text.slice(0, 12000)}\n"""\n\nReturn JSON only: {"title": "…", "topics": [{"title": "…", "description": "a few keywords of what it covers", "group": "…"}]}`,
      });
      const parsed = extractJson<{ title?: string; topics?: { title?: string; description?: string; group?: string }[] }>(r.text);
      const topics: TopicRef[] = (parsed?.topics ?? [])
        .filter((t) => t?.title)
        .slice(0, 40)
        .map((t, i) => ({
          id: `custom.${i + 1}`,
          title: String(t.title).trim(),
          description: String(t.description ?? t.title).trim(),
          group: String(t.group ?? "Topics").trim(),
          prereqs: i > 0 ? [`custom.${i}`] : undefined,
        }));
      if (topics.length < 2) throw new Error("Couldn't find a topic list in that text.");
      await api.curriculumSet(space.id, "custom", parsed?.title?.trim() || space.name, topics);
      toast.success(s.plan.customSaved(topics.length));
      onOpenChange(false);
      onDone();
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.plan.customFailed, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.plan.customTitle}
      description={s.plan.customBody}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={text.trim().length < 20 || busy} onClick={submit}>
            {busy ? s.plan.reading : s.plan.makeCurriculum}
          </Button>
        </>
      }
    >
      <Label htmlFor="syllabus">{s.plan.syllabus}</Label>
      <Textarea id="syllabus" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={s.plan.syllabusPlaceholder} />
    </Dialog>
  );
}

function CoverageMap({ space, curriculum }: { space: Space; curriculum: SpaceCurriculum }) {
  const qc = useQueryClient();
  const sources = useSources(space.id);
  const levels = useLevels(space.id);
  const ready = (sources.data ?? []).filter((x) => x.status === "ready").length;
  const coverage = useQuery({
    queryKey: [...qk.coverage(space.id), curriculum.updatedAt, ready],
    queryFn: () => api.topicCoverage(space.id, curriculum.topics.map((t) => ({ id: t.id, text: topicQuery(t) }))),
  });
  const [changing, setChanging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const setImport = useUi((st) => st.setImportDialog);
  const navigate = useUi((st) => st.navigate);

  const covByTopic = useMemo(() => new Map((coverage.data ?? []).map((c) => [c.topicId, c])), [coverage.data]);
  const levelByTopic = useMemo(() => new Map((levels.data ?? []).map((l) => [l.topicId, l])), [levels.data]);
  const groups = useMemo(() => {
    const g = new Map<string, TopicRef[]>();
    for (const t of curriculum.topics) g.set(t.group, [...(g.get(t.group) ?? []), t]);
    return [...g.entries()];
  }, [curriculum.topics]);
  const counts = curriculum.topics.reduce<Record<CoverageLevel, number>>(
    (acc, t) => ({ ...acc, [coverageLevel(covByTopic.get(t.id))]: acc[coverageLevel(covByTopic.get(t.id))] + 1 }),
    { covered: 0, partial: 0, missing: 0 },
  );
  const placed = (levels.data ?? []).length > 0;
  const official = curriculumById(curriculum.curriculumId);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.errors.generic, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-medium">{curriculum.title}</p>
          {coverage.data && (
            <p className="text-xs text-muted" data-testid="coverage-summary">
              {s.plan.summary(counts.covered, counts.partial, counts.missing)}
            </p>
          )}
        </div>
        <DM.Root>
          <DM.Trigger asChild>
            <button aria-label={s.plan.options} className="rounded-full p-1 text-muted hover:bg-surface-2">
              <MoreHorizontal size={16} />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-lg">
              <DM.Item onSelect={() => setChanging(true)} className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
                {s.plan.change}
              </DM.Item>
              {official && (
                <DM.Item asChild className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
                  <a href={official.officialUrl} target="_blank" rel="noreferrer">
                    {s.plan.official}
                  </a>
                </DM.Item>
              )}
              <DM.Item onSelect={() => setRemoving(true)} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
                {s.common.remove}
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
      {official && <p className="mt-1 text-[0.6875rem] text-faint">{official.note}</p>}

      <Button
        size="sm"
        variant={placed ? "secondary" : "primary"}
        className="mt-3 w-full"
        disabled={busy}
        onClick={() => run(() => runPlacement(space, curriculum))}
      >
        <ClipboardCheck size={15} /> {placed ? s.plan.retakePlacement : s.plan.placement}
      </Button>

      {coverage.isLoading && <Skeleton className="mt-3 h-24" />}
      {coverage.error && <ErrorState title={s.plan.coverageFailed} error={coverage.error} onRetry={() => coverage.refetch()} />}
      <div className="mt-3 space-y-3" data-testid="coverage-map">
        {groups.map(([group, topics]) => (
          <div key={group}>
            <p className="mb-1 text-[0.6875rem] font-medium text-faint">{group}</p>
            <ul>
              {topics.map((t) => {
                const cov = coverageLevel(covByTopic.get(t.id));
                const lvl = levelByTopic.get(t.id)?.level ?? "unknown";
                return (
                  <li key={t.id}>
                    <DM.Root>
                      <DM.Trigger asChild>
                        <button
                          className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-2"
                          data-testid="topic-row"
                          data-coverage={cov}
                        >
                          <Tooltip content={s.plan.coverage[cov]} side="left">
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", COVERAGE_DOT[cov])} />
                          </Tooltip>
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          {lvl !== "unknown" && (
                            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium", LEVEL_TONE[lvl])}>
                              {s.plan.levels[lvl]}
                            </span>
                          )}
                        </button>
                      </DM.Trigger>
                      <DM.Portal>
                        <DM.Content align="start" side="left" className="z-50 w-64 rounded-xl border border-border bg-surface p-1 shadow-lg">
                          <p className="px-3 pb-1 pt-2 text-xs text-muted">{t.description}</p>
                          <DM.Item
                            onSelect={() => run(() => startTopic(space, curriculum, t))}
                            className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                          >
                            {s.plan.startTopic}
                          </DM.Item>
                          <DM.Item
                            onSelect={() => navigate({ name: "practice", spaceId: space.id, topicKey: t.id })}
                            className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                          >
                            {s.practice.practiceTopic}
                          </DM.Item>
                          <DM.Item
                            onSelect={() => setImport({ open: true, tab: "research", query: `${t.title}: ${t.description}` })}
                            className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                          >
                            {s.plan.findSources}
                          </DM.Item>
                          {(["strong", "weak"] as const).map((lv) => (
                            <DM.Item
                              key={lv}
                              onSelect={() =>
                                run(async () => {
                                  await api.topicLevelSet(space.id, t.id, lv, "set by you");
                                  qc.invalidateQueries({ queryKey: qk.levels(space.id) });
                                })
                              }
                              className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                            >
                              {lv === "strong" ? s.plan.markKnown : s.plan.markWeak}
                            </DM.Item>
                          ))}
                        </DM.Content>
                      </DM.Portal>
                    </DM.Root>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Dialog open={changing} onOpenChange={setChanging} title={s.plan.change}>
        <div className="pb-4">
          <CurriculumPicker space={space} onDone={() => setChanging(false)} />
        </div>
      </Dialog>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={s.plan.removeTitle}
        body={s.plan.removeBody}
        confirmLabel={s.common.remove}
        danger
        onConfirm={async () => {
          try {
            await api.curriculumClear(space.id);
            qc.invalidateQueries({ queryKey: qk.curriculum(space.id) });
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </div>
  );
}
