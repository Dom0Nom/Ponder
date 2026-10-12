import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useCards, useCourses, useJournal, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import { dayGroup } from "../../lib/utils";
import { qkOutputs } from "../../stores/outputJobs";
import type { OutputKind } from "../../lib/studio/kinds";
import type { StudioView } from "../../stores/ui";

export interface RecentItem {
  id: string;
  kind: "quiz" | "cards" | "course" | "journal" | "output";
  name: string;
  at: number;
  view: StudioView;
  output?: { id: string; kind: OutputKind };
}

/** The five newest quizzes, card batches, courses, journal entries and Studio outputs of a space. */
export function useStudioRecent(spaceId: string) {
  const assessments = useQuery({ queryKey: qk.assessments(spaceId), queryFn: () => api.assessmentsList(spaceId) });
  const cards = useCards(spaceId);
  const courses = useCourses(spaceId);
  const journal = useJournal(spaceId);
  const sources = useSources(spaceId);
  const outputs = useQuery({ queryKey: qkOutputs(spaceId), queryFn: () => api.outputsList(spaceId) });

  const items: RecentItem[] = [];
  for (const a of assessments.data ?? []) items.push({ id: `q-${a.id}`, kind: "quiz", name: a.title, at: a.createdAt, view: "flashcards" });

  const batches = new Map<string, { n: number; at: number; title: string }>();
  for (const c of cards.data ?? []) {
    const title = sources.data?.find((x) => x.id === c.sourceId)?.title ?? s.studio.flashcards;
    const key = `${c.sourceId ?? ""}|${dayGroup(c.createdAt)}`;
    const b = batches.get(key);
    batches.set(key, { n: (b?.n ?? 0) + 1, at: Math.max(b?.at ?? 0, c.createdAt), title });
  }
  for (const [key, b] of batches) items.push({ id: `c-${key}`, kind: "cards", name: s.studio.cardsFrom(b.title, b.n), at: b.at, view: "flashcards" });

  for (const c of courses.data ?? []) items.push({ id: `k-${c.id}`, kind: "course", name: c.title, at: c.createdAt, view: "course" });
  for (const e of journal.data ?? []) items.push({ id: `j-${e.id}`, kind: "journal", name: e.title, at: e.createdAt, view: "journal" });
  for (const o of outputs.data ?? [])
    items.push({ id: `o-${o.id}`, kind: "output", name: o.title, at: o.updatedAt, view: "create", output: { id: o.id, kind: o.kind } });

  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 5);
}
