export interface TopicLite {
  key: string;
  title: string;
}

export interface NextInput {
  /** what the learner works towards; null or empty when none is set */
  goal: string | null;
  minutes: number;
  lowEnergy: boolean;
  dueCards: number;
  retests: TopicLite[];
  /** prerequisites of topics answered wrong recently */
  prereqChecks: TopicLite[];
  /** first topic of the skill graph that isn't learned yet */
  frontier: TopicLite | null;
  /** titles of today's plan tasks, first one first */
  planToday: string[];
  hasTopics: boolean;
}

export type BlockKind = "review" | "retest" | "check" | "new" | "practice" | "reflect";

export interface Block {
  id: string;
  kind: BlockKind;
  minutes: number;
  topic?: TopicLite;
  /** card count, or the plan task title for "new" */
  count?: number;
  label?: string;
}

export const DEFAULT_MINUTES = 25;
const RETEST_MIN = 3;
const CHECK_MIN = 2;
const REFLECT_MIN = 1;

/** Short list of blocks for "what do I do now". Each block opens a screen that already exists. */
export function nextSession(input: NextInput): Block[] {
  const budget = Math.max(5, input.minutes || DEFAULT_MINUTES);
  const blocks: Block[] = [];

  if (input.dueCards > 0) blocks.push({ id: "review", kind: "review", minutes: Math.min(10, Math.max(3, Math.ceil(input.dueCards * 0.4))), count: input.dueCards });
  for (const t of input.retests.slice(0, 2)) blocks.push({ id: `retest:${t.key}`, kind: "retest", minutes: RETEST_MIN, topic: t });
  for (const t of input.prereqChecks.slice(0, 1)) blocks.push({ id: `check:${t.key}`, kind: "check", minutes: CHECK_MIN, topic: t });

  if (!input.lowEnergy) {
    const task = input.planToday[0];
    if (task) blocks.push({ id: "new", kind: "new", minutes: 10, label: task, topic: input.frontier ?? undefined });
    else if (input.frontier) blocks.push({ id: "new", kind: "new", minutes: 10, topic: input.frontier });
  }

  const used = blocks.reduce((n, b) => n + b.minutes, 0);
  if (input.hasTopics || blocks.length === 0) {
    const room = budget - used - REFLECT_MIN;
    const minutes = input.lowEnergy ? Math.min(5, Math.max(3, room)) : Math.max(5, Math.min(15, room));
    blocks.push({ id: "practice", kind: "practice", minutes });
  }
  blocks.push({ id: "reflect", kind: "reflect", minutes: REFLECT_MIN });

  return fit(blocks, budget);
}

/** Drops blocks from the back (new material first, then extra retests) until the list fits. */
function fit(blocks: Block[], budget: number): Block[] {
  const total = (list: Block[]) => list.reduce((n, b) => n + b.minutes, 0);
  const out = [...blocks];
  for (const drop of ["new", "check"] as BlockKind[]) {
    if (total(out) <= budget) break;
    const i = out.findIndex((b) => b.kind === drop);
    if (i >= 0) out.splice(i, 1);
  }
  while (total(out) > budget && out.filter((b) => b.kind === "retest").length > 1) {
    out.splice(out.map((b) => b.kind).lastIndexOf("retest"), 1);
  }
  return out;
}

export const totalMinutes = (blocks: Block[]) => blocks.reduce((n, b) => n + b.minutes, 0);

/** Goal text for a Focus session started from the list. */
export function focusGoal(input: Pick<NextInput, "goal" | "planToday">, blocks: Block[], describe: (b: Block) => string = () => ""): string {
  const first = blocks.find((b) => b.kind !== "reflect");
  return input.goal?.trim() || input.planToday[0] || first?.topic?.title || (first ? describe(first) : "");
}
