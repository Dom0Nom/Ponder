import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { generateText } from "ai";
import { ChevronRight, Circle, CircleCheck, CircleDashed, Ellipsis, Plus } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk, useCurriculum, useLevels, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, SpaceCurriculum, TopicRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { coverageLevel, topicQuery, type CoverageLevel } from "../../lib/placement/logic";
import { runPlacement, startTopic } from "../../lib/placement/flows";
import { extractJson } from "../../lib/chat/json";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Dialog, ConfirmDialog } from "../../components/ui/dialog";
import { fieldLabel, Textarea } from "../../components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../../components/ui/menu";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { toast, toastError } from "../../components/ui/toast";
import { PanelList, panelRow } from "../space/PanelList";
import { StudioSubpanel } from "../space/StudioSubpanel";

const COVERAGE_ICON: Record<CoverageLevel, typeof Circle> = {
  covered: CircleCheck,
  partial: CircleDashed,
  missing: Circle,
};

export function PlanPanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const cur = useCurriculum(space.id);
  return (
    <StudioSubpanel title={s.plan.title} onBack={onBack} testId="plan-card">
      {cur.isLoading && <Skeleton className="h-40 rounded-card" />}
      {cur.error && <ErrorState title={s.errors.generic} error={cur.error} onRetry={() => cur.refetch()} />}
      {cur.data === null && <CurriculumPicker space={space} />}
      {cur.data && <CoverageMap space={space} curriculum={cur.data} />}
    </StudioSubpanel>
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
    <div className="flex flex-col gap-3.5">
      <p className="text-muted">{s.plan.pickBody}</p>
      <PanelList inset={14}>
        {CURRICULA.map((c) => (
          <button key={c.id} disabled={busy} onClick={() => choose(c.id)} className={cn(panelRow, "h-[42px] w-full gap-2.5 text-left")}>
            <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
            <ChevronRight size={14} className="flex-none" />
          </button>
        ))}
        <button onClick={() => setCustom(true)} className={cn(panelRow, "h-[42px] w-full gap-2.5 text-left")}>
          <Plus size={15} className="flex-none" />
          <span className="min-w-0 flex-1 truncate font-medium">{s.plan.custom}</span>
        </button>
      </PanelList>
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
      className="w-[min(482px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={text.trim().length < 20 || busy} onClick={submit}>
            {s.plan.makeCurriculum}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabel}>{s.plan.syllabus}</span>
        <Textarea id="syllabus" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={s.plan.syllabusPlaceholder} />
      </label>
      {busy && <GeneratingStatus label={s.plan.reading} className="mt-3.5 text-muted" />}
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
    <>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-input font-semibold">{curriculum.title}</span>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost-muted" size="icon-sm" title={s.plan.options} aria-label={s.plan.options}>
              <Ellipsis size={15} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-[180px]">
            <MenuItem onSelect={() => setChanging(true)}>{s.plan.change}</MenuItem>
            {official && (
              <MenuItem asChild>
                <a href={official.officialUrl} target="_blank" rel="noreferrer">
                  {s.plan.official}
                </a>
              </MenuItem>
            )}
            <MenuItem danger onSelect={() => setRemoving(true)}>
              {s.common.remove}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {coverage.data && (
        <p className="-mt-2 text-muted" data-testid="coverage-summary">
          {s.plan.summary(counts.covered, counts.partial, counts.missing)}
        </p>
      )}

      {coverage.isLoading && <Skeleton className="h-40 rounded-card" />}
      {coverage.error && <ErrorState title={s.plan.coverageFailed} error={coverage.error} onRetry={() => coverage.refetch()} />}
      <div data-testid="coverage-map" hidden={coverage.isLoading}>
        <PanelList inset={14}>
          {curriculum.topics.map((t) => {
            const cov = coverageLevel(covByTopic.get(t.id));
            const lvl = levelByTopic.get(t.id)?.level ?? "unknown";
            const CovIcon = COVERAGE_ICON[cov];
            return (
              <Menu key={t.id}>
                <MenuTrigger asChild>
                  <button
                    className={cn(panelRow, "h-[42px] w-full gap-2.5 text-left")}
                    data-testid="topic-row"
                    data-coverage={cov}
                    title={s.plan.coverage[cov]}
                  >
                    <CovIcon size={15} className="flex-none" />
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    {lvl !== "unknown" && <span className="whitespace-nowrap text-label font-semibold text-fg-secondary">{s.plan.levels[lvl]}</span>}
                  </button>
                </MenuTrigger>
                <MenuContent align="start" side="left" className="w-64">
                  <MenuLabel className="font-normal">{t.description}</MenuLabel>
                  <MenuItem onSelect={() => run(() => startTopic(space, curriculum, t))}>{s.plan.startTopic}</MenuItem>
                  <MenuItem onSelect={() => navigate({ name: "practice", spaceId: space.id, topicKey: t.id, topicTitle: t.title })}>
                    {s.practice.practiceTopic}
                  </MenuItem>
                  <MenuItem onSelect={() => setImport({ open: true, tab: "research", query: `${t.title}: ${t.description}` })}>
                    {s.plan.findSources}
                  </MenuItem>
                  {(["strong", "weak"] as const).map((lv) => (
                    <MenuItem
                      key={lv}
                      onSelect={() =>
                        run(async () => {
                          await api.topicLevelSet(space.id, t.id, lv, "set by you");
                          qc.invalidateQueries({ queryKey: qk.levels(space.id) });
                        })
                      }
                    >
                      {lv === "strong" ? s.plan.markKnown : s.plan.markWeak}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            );
          })}
        </PanelList>
      </div>
      <Button variant="secondary" className="w-full" disabled={busy} onClick={() => run(() => runPlacement(space, curriculum))}>
        {placed ? s.plan.retakePlacement : s.plan.placement}
      </Button>
      <Dialog open={changing} onOpenChange={setChanging} title={s.plan.change} className="w-[min(482px,calc(100vw-32px))]">
        <CurriculumPicker space={space} onDone={() => setChanging(false)} />
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
    </>
  );
}
