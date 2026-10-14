import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { applyGoal, type ApplyError } from "../../lib/goal/apply";
import { findTopicSources } from "../../lib/goal/sources";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { todayDate } from "../../lib/plan/clock";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { graphFromCurriculum, graphFromSyllabus, proposeGraph, removeNode, renameNode, setKnown, topoOrder } from "../../lib/placement/graph";
import { s } from "../../lib/strings";
import type { GoalGraph, GoalKind, GoalNode, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useSpace } from "../../lib/queries";
import { useUi } from "../../stores/ui";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { Reveal } from "../../components/motion/Reveal";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Textarea } from "../../components/ui/input";
import { Segmented } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NativeSelect } from "../settings/NativeSelect";

type Seed = "describe" | "exam" | "syllabus";
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function GoalWizardHost() {
  const spaceId = useUi((st) => st.goalWizard);
  const close = useUi((st) => st.setGoalWizard);
  const space = useSpace(spaceId ?? "");
  if (!spaceId || !space.data) return null;
  return <GoalWizard key={spaceId} space={space.data} onClose={() => close(null)} />;
}

function GoalWizard({ space, onClose }: { space: Space; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [seed, setSeed] = useState<Seed>("describe");
  const [sentence, setSentence] = useState("");
  const [examId, setExamId] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [examDate, setExamDate] = useState("");
  const [building, setBuilding] = useState(false);
  const [title, setTitle] = useState("");
  const [graph, setGraph] = useState<GoalGraph | null>(null);
  const [curriculumId, setCurriculumId] = useState("goal");
  const [hours, setHours] = useState("3");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const go = (to: number) => {
    setDir(to >= step ? 1 : -1);
    setStep(to);
    setError(null);
  };

  const canBuild = seed === "describe" ? sentence.trim().length > 2 : seed === "exam" ? !!examId : syllabus.trim().length > 20;
  const kind: GoalKind = seed === "exam" ? "exam" : "skill";

  const build = async () => {
    if (!canBuild) return setError(s.goal.needInput);
    setError(null);
    setBuilding(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      if (seed === "exam") {
        const c = curriculumById(examId)!;
        setGraph(graphFromCurriculum(c));
        setTitle(c.title);
        setCurriculumId(c.id);
      } else {
        const llm = await resolveChatModel(space);
        if (seed === "describe") {
          const r = await proposeGraph(llm, sentence.trim(), space.language, ctrl.signal);
          setGraph(r.graph);
          setTitle(r.title || sentence.trim().slice(0, 80));
          setCurriculumId("goal");
        } else {
          const r = await graphFromSyllabus(llm, syllabus, ctrl.signal);
          setGraph(r.graph);
          setTitle(r.title || space.name);
          setCurriculumId("custom");
        }
      }
      go(1);
    } catch (e) {
      if (!ctrl.signal.aborted) toastError(e instanceof NoModelError ? s.goal.noModel : s.goal.buildFailed, e instanceof NoModelError ? null : e, () => void build());
    } finally {
      setBuilding(false);
    }
  };

  const make = async () => {
    if (!graph) return;
    const weeklyMinutes = Math.round(Number(hours) * 60);
    const e = s.plan.schedule.errors;
    if (!(weeklyMinutes > 0)) return setError(e.noMinutes);
    if (days.length === 0) return setError(e.noStudyDays);
    if (examDate && examDate <= todayDate()) return setError(e.examPast);
    setError(null);
    setSaving(true);
    try {
      const r = await applyGoal({ spaceId: space.id, kind, curriculumId, title, graph, examDate, weeklyMinutes, studyDays: days });
      if (!r.ok) return setError(applyMessage(r.error));
      toast.success(s.goal.madeToast);
      onClose();
    } catch (err) {
      toastError(s.goal.saveFailed, err, () => void make());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={s.goal.title}
      description={s.goal.stepOf(step + 1, 3) + " · " + s.goal.steps[step]}
      className="w-[min(620px,calc(100vw-32px))]"
      footer={
        <>
          {step > 0 && (
            <Button variant="secondary" onClick={() => go(step - 1)} data-testid="goal-back">
              {s.goal.back}
            </Button>
          )}
          {step === 0 && (
            <Button variant="primary" disabled={!canBuild || building} onClick={() => void build()} data-testid="goal-build">
              {building ? s.goal.building : s.goal.build}
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" disabled={!graph || graph.nodes.length === 0} onClick={() => go(2)} data-testid="goal-next">
              {s.goal.next}
            </Button>
          )}
          {step === 2 && (
            <Button variant="primary" disabled={saving} onClick={() => void make()} data-testid="goal-make">
              {saving ? s.goal.making : s.goal.make}
            </Button>
          )}
        </>
      }
    >
      <div data-testid="goal-wizard" data-step={step}>
        {building ? (
          <div className="flex items-center gap-3 py-10" role="status" data-testid="goal-building">
            <ActivityOrb activity="plan" size={32} />
            <span className="text-muted">{s.goal.building}</span>
          </div>
        ) : (
          <div key={step} className="t-page-enter flex flex-col gap-4" style={{ ["--t-page-dir" as string]: dir }}>
            {step === 0 && (
              <>
                <Segmented
                  label={s.goal.title}
                  value={seed}
                  onChange={setSeed}
                  options={[
                    { value: "describe", label: s.goal.seeds.describe },
                    { value: "exam", label: s.goal.seeds.exam },
                    { value: "syllabus", label: s.goal.seeds.syllabus },
                  ]}
                />
                {seed === "describe" && (
                  <div>
                    <Label htmlFor="goal-sentence">{s.goal.sentenceLabel}</Label>
                    <Input
                      id="goal-sentence"
                      autoFocus
                      value={sentence}
                      maxLength={300}
                      placeholder={s.goal.sentencePlaceholder}
                      onChange={(e) => setSentence(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && canBuild && void build()}
                    />
                  </div>
                )}
                {seed === "exam" && (
                  <div>
                    <Label htmlFor="goal-exam">{s.goal.examLabel}</Label>
                    <NativeSelect id="goal-exam" value={examId} onChange={(e) => setExamId(e.target.value)}>
                      <option value="">{s.goal.examPick}</option>
                      {CURRICULA.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                {seed === "syllabus" && (
                  <div>
                    <Label htmlFor="goal-syllabus">{s.goal.syllabusLabel}</Label>
                    <Textarea id="goal-syllabus" rows={7} value={syllabus} placeholder={s.goal.syllabusPlaceholder} onChange={(e) => setSyllabus(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label htmlFor="goal-date">{s.goal.dateLabel}</Label>
                  <Input id="goal-date" type="date" value={examDate} min={todayDate()} onChange={(e) => setExamDate(e.target.value)} className="w-48" />
                  <p className="mt-1.5 text-label text-muted">{s.goal.dateHelp}</p>
                </div>
              </>
            )}

            {step === 1 && graph && (
              <GraphEditor space={space} title={title} graph={graph} onChange={setGraph} onTitle={setTitle} />
            )}

            {step === 2 && (
              <>
                <div className="flex gap-4">
                  <div>
                    <Label htmlFor="goal-hours">{s.goal.hoursLabel}</Label>
                    <Input id="goal-hours" type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className="w-28" />
                  </div>
                  <div>
                    <Label htmlFor="goal-date2">{s.goal.dateLabel}</Label>
                    <Input id="goal-date2" type="date" value={examDate} min={todayDate()} onChange={(e) => setExamDate(e.target.value)} className="w-48" />
                  </div>
                </div>
                <p className="-mt-2 text-label text-muted">{s.goal.dateHelp}</p>
                <div>
                  <Label>{s.goal.daysLabel}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_ORDER.map((d) => {
                      const on = days.includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          aria-pressed={on}
                          aria-label={s.plan.schedule.weekdaysLong[d]}
                          onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                          className={cn(
                            "h-8 min-w-11 rounded-btn border px-2.5 text-label font-medium",
                            on ? "border-primary bg-primary text-on-primary" : "border-control bg-surface text-fg-secondary hover:bg-fill",
                          )}
                        >
                          {s.plan.schedule.weekdaysShort[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="text-label text-danger" data-testid="goal-error">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function applyMessage(e: ApplyError): string {
  if (e === "allKnown") return s.goal.allKnown;
  if (e === "graph") return s.goal.graphProblem;
  return s.plan.schedule.errors[e];
}

function GraphEditor({
  space,
  title,
  graph,
  onChange,
  onTitle,
}: {
  space: Space;
  title: string;
  graph: GoalGraph;
  onChange: (g: GoalGraph) => void;
  onTitle: (t: string) => void;
}) {
  const [finding, setFinding] = useState<Record<string, boolean>>({});
  const [searched, setSearched] = useState<Record<string, boolean>>({});
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const names = new Map(graph.nodes.map((n) => [n.id, n.title]));
  const ordered = topoOrder(graph);

  const find = async (node: GoalNode) => {
    setFinding((f) => ({ ...f, [node.id]: true }));
    try {
      const sources = await findTopicSources(space, title, node);
      onChange({ nodes: graphRef.current.nodes.map((n) => (n.id === node.id ? { ...n, sources } : n)) });
      setSearched((f) => ({ ...f, [node.id]: true }));
    } catch (e) {
      toastError(e instanceof NoModelError ? s.goal.noModel : s.goal.sourcesFailed, e instanceof NoModelError ? null : e, () => void find(node));
    } finally {
      setFinding((f) => ({ ...f, [node.id]: false }));
    }
  };

  return (
    <>
      <div>
        <Label htmlFor="goal-title">{s.goal.title}</Label>
        <Input id="goal-title" value={title} onChange={(e) => onTitle(e.target.value)} />
      </div>
      <p className="text-muted">{s.goal.graphHelp}</p>
      <div className="flex items-center justify-between text-label text-muted">
        <span data-testid="goal-count">{s.goal.topicCount(graph.nodes.length)}</span>
        <span>{s.goal.freeHint}</span>
      </div>
      <ul className="flex max-h-[44vh] flex-col overflow-y-auto rounded-pane border border-border" data-testid="goal-topics">
        {ordered.map((n, i) => (
          <Reveal as="li" key={n.id} index={i} className="flex flex-col gap-1.5 border-b border-divider px-3 py-2.5 last:border-b-0" data-testid="goal-topic" data-topic={n.id}>
            <div className="flex items-center gap-2.5">
              <Checkbox16 checked={n.known} onChange={(e) => onChange(setKnown(graph, n.id, e.target.checked))} aria-label={s.goal.knownLabel(n.title)} />
              <TitleField node={n} onCommit={(t) => onChange(renameNode(graph, n.id, t))} />
              <Button variant="ghost" size="sm" disabled={finding[n.id]} onClick={() => void find(n)} aria-label={s.goal.findSourcesFor(n.title)} data-testid="goal-find">
                {finding[n.id] ? (
                  <>
                    <ActivityOrb activity="research" size={20} /> {s.goal.finding}
                  </>
                ) : (
                  s.goal.findSources
                )}
              </Button>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-btn text-muted hover:bg-fill"
                aria-label={s.goal.remove(n.title)}
                onClick={() => onChange(removeNode(graph, n.id))}
                data-testid="goal-remove"
              >
                <X size={14} />
              </button>
            </div>
            <p className="ps-[26px] text-label text-muted">
              {n.prereqs.length ? s.goal.after(n.prereqs.map((p) => names.get(p) ?? p).join(", ")) : s.goal.startingPoint}
            </p>
            {n.sources.length > 0 && (
              <ul className="ps-[26px]" data-testid="goal-sources">
                {n.sources.map((src) => (
                  <li key={src.url} className="flex items-center gap-1.5 text-label">
                    <ExternalLink size={12} className="shrink-0 text-muted" aria-hidden />
                    <a href={src.url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
                      {src.title}
                    </a>
                    {src.free && <span className="shrink-0 rounded-btn bg-fill px-1.5 text-caption text-muted">{s.goal.free}</span>}
                  </li>
                ))}
              </ul>
            )}
            {searched[n.id] && n.sources.length === 0 && <p className="ps-[26px] text-label text-muted">{s.goal.noSources}</p>}
          </Reveal>
        ))}
      </ul>
    </>
  );
}

function TitleField({ node, onCommit }: { node: GoalNode; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState(node.title);
  useEffect(() => setDraft(node.title), [node.title]);
  return (
    <Input
      value={draft}
      aria-label={s.goal.rename(node.title)}
      data-testid="goal-topic-title"
      className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 font-medium hover:border-border focus:border-border"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() ? onCommit(draft) : setDraft(node.title))}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
