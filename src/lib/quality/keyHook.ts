import type { ResolvedModel } from "../chat/llm";
import type { Task } from "../worksheets/types";

export interface KeyCheckResult {
  tasks: Task[];
  /** tasks dropped or regenerated because the key looked wrong */
  replaced: number;
}

export type KeyChecker = (llm: ResolvedModel, tasks: Task[], opts: { signal?: AbortSignal }) => Promise<KeyCheckResult>;

let checker: KeyChecker | null = null;

/** Hook point for the answer-key check (`src/lib/quality/answerCheck.ts` when that branch lands): register it once at startup. */
export function setKeyChecker(fn: KeyChecker | null) {
  checker = fn;
}

export async function checkKeys(llm: ResolvedModel, tasks: Task[], opts: { signal?: AbortSignal } = {}): Promise<KeyCheckResult> {
  return checker ? checker(llm, tasks, opts) : { tasks, replaced: 0 };
}
