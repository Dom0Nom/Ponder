export interface SilenceOptions {
  /** RMS level (0..1) that counts as sound */
  threshold: number;
  /** quiet time after speech that ends the take */
  silenceMs: number;
  /** total sound needed before it counts as speech */
  minSpeechMs: number;
  /** give up when nothing was heard for this long */
  idleMs: number;
}

export const SILENCE: SilenceOptions = { threshold: 0.02, silenceMs: 1500, minSpeechMs: 250, idleMs: 20_000 };

export type Verdict = "continue" | "stop" | "idle";

/** Feed it one microphone level per tick; it says when the learner has finished or never started. */
export class SilenceDetector {
  heard = false;
  private loud = 0;
  private quietSince: number | null = null;
  private last: number;
  private readonly started: number;

  constructor(
    private readonly opt: SilenceOptions,
    now: number,
  ) {
    this.last = this.started = now;
  }

  push(level: number, now: number): Verdict {
    const dt = now - this.last;
    this.last = now;
    if (level >= this.opt.threshold) {
      this.loud += dt;
      this.quietSince = null;
      if (this.loud >= this.opt.minSpeechMs) this.heard = true;
      return "continue";
    }
    this.quietSince ??= now;
    if (this.heard && now - this.quietSince >= this.opt.silenceMs) return "stop";
    if (!this.heard && now - this.started >= this.opt.idleMs) return "idle";
    return "continue";
  }
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}
