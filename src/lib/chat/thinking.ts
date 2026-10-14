import { s } from "../strings";

/** Measures how long the model reasoned: first reasoning token until the first answer token (or end of stream). */
export class ThinkingTimer {
  private start: number | null = null;
  private ms = 0;

  constructor(private now: () => number = Date.now) {}

  reasoning() {
    this.start ??= this.now();
  }

  text() {
    this.finish();
  }

  finish() {
    if (this.start != null && !this.ms) this.ms = Math.max(1, this.now() - this.start);
  }

  get thinkingMs(): number {
    return this.ms;
  }
}

export function thoughtLabel(sec: number): string {
  return sec < 60 ? s.chat.thoughtForSeconds(sec) : s.chat.thoughtForMinutes(Math.round(sec / 60));
}

/** Whole seconds shown in "Thought for N seconds"; never less than 1. */
export function thoughtSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}
