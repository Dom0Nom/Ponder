import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { Input, Label, Textarea, fieldLabel } from "../../components/ui/input";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Reveal } from "../../components/motion/Reveal";
import { SuccessCheck } from "../../components/motion/SuccessCheck";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { api } from "../../lib/ipc";
import { blockedTopics, progress } from "../../lib/projects/blocked";
import { useCurriculum, useLevels } from "../../lib/queries";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import type { Project, ProjectMilestone, Space, TopicRef } from "../../lib/types";

const projectsKey = (spaceId: string) => ["projects", spaceId] as const;
export const useProjects = (spaceId: string) => useQuery({ queryKey: projectsKey(spaceId), queryFn: () => api.projectsList(spaceId) });

async function shrinkPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function MilestoneRow({ m, topics, levels, onChange }: { m: ProjectMilestone; topics: TopicRef[]; levels: ReturnType<typeof useLevels>["data"]; onChange: () => void }) {
  const blocked = blockedTopics(m, levels ?? [], topics);
  const done = useMutation({ mutationFn: (v: boolean) => api.milestoneDone(m.id, v), onSuccess: onChange, onError: (e) => toastError(s.projects.saveFailed, e) });
  const del = useMutation({ mutationFn: () => api.milestoneDelete(m.id), onSuccess: onChange, onError: (e) => toastError(s.projects.saveFailed, e) });
  return (
    <li className="flex flex-col gap-1 border-b border-divider py-2" data-testid="milestone" data-done={!!m.doneAt} data-blocked={blocked.length > 0}>
      <div className="flex items-center gap-2">
        <Checkbox16 checked={!!m.doneAt} onChange={(e) => done.mutate(e.target.checked)} aria-label={s.projects.markDone(m.title)} />
        <span className={m.doneAt ? "flex-1 text-muted line-through" : "flex-1"}>{m.title}</span>
        {m.doneAt && <span className="text-success"><SuccessCheck size={14} /></span>}
        <button type="button" className="rounded p-1 text-muted hover:bg-fill hover:text-fg" aria-label={s.projects.removeMilestone} onClick={() => del.mutate()}>
          <X size={13} />
        </button>
      </div>
      {blocked.length > 0 && (
        <div className="ms-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted" data-testid="milestone-blocked">
          <span>{s.projects.blockedOn(blocked.map((t) => t.title).join(", "))}</span>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 font-medium text-fg hover:underline"
            data-testid="study-topic"
            onClick={() => useUi.getState().setStudioView("course")}
          >
            {s.projects.studyTopic(blocked[0].title)}
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </li>
  );
}

function ProjectDetail({ space, project, onBack }: { space: Space; project: Project; onBack: () => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: projectsKey(space.id) });
  const curriculum = useCurriculum(space.id);
  const levels = useLevels(space.id);
  const topics = curriculum.data?.topics ?? [];
  const [msTitle, setMsTitle] = useState("");
  const [msTopics, setMsTopics] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const onErr = (e: unknown) => toastError(s.projects.saveFailed, e);
  const addMs = useMutation({
    mutationFn: () => api.milestoneSave({ projectId: project.id, title: msTitle, topicIds: msTopics }),
    onSuccess: () => {
      setMsTitle("");
      setMsTopics([]);
      refresh();
    },
    onError: onErr,
  });
  const addLog = useMutation({
    mutationFn: () => api.logAdd({ projectId: project.id, body, photo }),
    onSuccess: () => {
      setBody("");
      setPhoto(null);
      refresh();
    },
    onError: onErr,
  });
  const delLog = useMutation({ mutationFn: (id: string) => api.logDelete(id), onSuccess: refresh, onError: onErr });
  const delProject = useMutation({
    mutationFn: () => api.projectDelete(project.id),
    onSuccess: () => {
      refresh();
      onBack();
    },
    onError: onErr,
  });
  const p = progress(project);
  return (
    <StudioSubpanel title={project.title} onBack={onBack} testId="project-detail">
      {project.goal && <p className="text-body text-fg-secondary">{project.goal}</p>}
      <section className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h3 className={fieldLabel}>{s.projects.milestones}</h3>
          <span className="ms-auto text-label text-muted" data-testid="project-progress">
            {s.projects.progress(p.done, p.total)}
          </span>
        </div>
        {project.milestones.length === 0 && <p className="text-body text-muted">{s.projects.noMilestones}</p>}
        <ul role="list">
          {project.milestones.map((m) => (
            <MilestoneRow key={m.id} m={m} topics={topics} levels={levels.data} onChange={refresh} />
          ))}
        </ul>
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (msTitle.trim()) addMs.mutate();
          }}
        >
          <Input value={msTitle} onChange={(e) => setMsTitle(e.target.value)} placeholder={s.projects.milestonePlaceholder} aria-label={s.projects.addMilestone} data-testid="milestone-title" />
          {topics.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className={fieldLabel}>{s.projects.topicsLabel}</legend>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {topics.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-body">
                    <Checkbox16
                      checked={msTopics.includes(t.id)}
                      onChange={(e) => setMsTopics((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                      data-testid={`ms-topic-${t.id}`}
                    />
                    {t.title}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Button type="submit" variant="secondary" size="sm" className="self-start" disabled={!msTitle.trim() || addMs.isPending} data-testid="milestone-add">
            <Plus size={13} />
            {s.projects.addMilestone}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={fieldLabel}>{s.projects.log}</h3>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() || photo) addLog.mutate();
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={s.projects.logPlaceholder} aria-label={s.projects.log} rows={3} data-testid="log-body" />
          {photo && (
            <div className="relative w-fit">
              <img src={photo} alt={s.projects.photoAlt} className="max-h-28 rounded-item" />
              <button type="button" className="absolute end-1 top-1 rounded bg-surface p-0.5" aria-label={s.projects.removePhoto} onClick={() => setPhoto(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={(!body.trim() && !photo) || addLog.isPending} data-testid="log-add">
              {s.projects.addEntry}
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              data-testid="log-photo-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setPhoto(await shrinkPhoto(f).catch(() => null));
              }}
            />
            <Button type="button" variant="ghost-muted" size="sm" onClick={() => file.current?.click()}>
              <ImagePlus size={13} />
              {s.projects.attachPhoto}
            </Button>
          </div>
        </form>
        {project.log.length === 0 && <p className="text-body text-muted">{s.projects.noLog}</p>}
        <ul className="flex flex-col" role="list" data-testid="log-list">
          {project.log.map((e, i) => (
            <Reveal as="li" key={e.id} active={i === 0} className="group flex flex-col gap-1 border-b border-divider py-2" data-testid="log-entry">
              <div className="flex items-center gap-2 text-label text-muted">
                <span>{when(e.createdAt)}</span>
                <button type="button" className="ms-auto rounded p-1 opacity-0 hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100" aria-label={s.projects.deleteEntry} onClick={() => delLog.mutate(e.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
              {e.body && <p className="whitespace-pre-wrap text-body">{e.body}</p>}
              {e.photo && <img src={e.photo} alt={s.projects.photoAlt} className="max-h-40 w-fit rounded-item" />}
            </Reveal>
          ))}
        </ul>
      </section>
      <Button variant="ghost-muted" size="sm" className="self-start text-danger" onClick={() => delProject.mutate()} data-testid="project-delete">
        <Trash2 size={13} />
        {s.projects.delete}
      </Button>
    </StudioSubpanel>
  );
}

export function ProjectsPanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useProjects(space.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const create = useMutation({
    mutationFn: () => api.projectSave({ spaceId: space.id, title, goal }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: projectsKey(space.id) });
      setTitle("");
      setGoal("");
      setCreating(false);
      setOpenId(p.id);
    },
    onError: (e) => toastError(s.projects.saveFailed, e),
  });
  const open = q.data?.find((p) => p.id === openId);
  if (open) return <ProjectDetail space={space} project={open} onBack={() => setOpenId(null)} />;
  return (
    <StudioSubpanel title={s.projects.title} onBack={onBack} testId="projects-panel">
      {q.isLoading && <Skeleton className="h-16 rounded-card" />}
      {q.error && <ErrorState size="sm" title={s.projects.loadFailed} error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && !creating && <p className="text-body text-muted">{s.projects.empty}</p>}
      {q.data && q.data.length > 0 && (
        <ul className="flex flex-col gap-2" role="list" data-testid="projects-list">
          {q.data.map((p, i) => {
            const pr = progress(p);
            return (
              <Reveal as="li" key={p.id} index={i}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  data-testid="project-card"
                  className="flex w-full flex-col gap-1 rounded-card border border-border bg-surface p-3 text-start hover:bg-fill-subtle"
                >
                  <span className="font-medium">{p.title}</span>
                  {p.goal && <span className="line-clamp-2 text-label text-muted">{p.goal}</span>}
                  <span className="text-label text-muted">{s.projects.progress(pr.done, pr.total)}</span>
                </button>
              </Reveal>
            );
          })}
        </ul>
      )}
      {creating ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <Label htmlFor="project-title">{s.projects.titleLabel}</Label>
          <Input id="project-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={s.projects.titlePlaceholder} autoFocus />
          <Label htmlFor="project-goal">{s.projects.goalLabel}</Label>
          <Textarea id="project-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={s.projects.goalPlaceholder} rows={2} />
          <Button type="submit" variant="primary" size="sm" className="self-start" disabled={!title.trim() || create.isPending} data-testid="project-create">
            {s.projects.create}
          </Button>
        </form>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setCreating(true)} data-testid="project-new">
          <Plus size={13} />
          {s.projects.new}
        </Button>
      )}
    </StudioSubpanel>
  );
}
