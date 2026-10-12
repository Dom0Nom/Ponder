import { rms, SILENCE, SilenceDetector, type SilenceOptions } from "./silence";

export interface Take {
  blob: Blob;
  mime: string;
}

export interface Listening {
  /** The recording once it ends (stop() or silence); null when cancelled or empty. */
  done: Promise<Take | null>;
  /** Ends the take and keeps the audio. */
  stop: () => void;
  /** Ends the take and drops the audio. */
  cancel: () => void;
}

const TICK_MS = 80;

/**
 * Records the microphone until `stop()`, or until the learner has spoken and then been quiet for a while.
 * If the level meter never moves (suspended audio context) it records until `stop()` instead of guessing.
 */
export async function listen(opts: { onLevel?: (level: number) => void; silence?: Partial<SilenceOptions> } = {}): Promise<Listening> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const parts: Blob[] = [];
  let keep = true;
  let finish: (t: Take | null) => void = () => undefined;
  const done = new Promise<Take | null>((r) => (finish = r));
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.onstop = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
    opts.onLevel?.(0);
    const blob = new Blob(parts, { type: rec.mimeType });
    finish(keep && blob.size ? { blob, mime: rec.mimeType } : null);
  };
  rec.start();

  const end = (save: boolean) => {
    keep = keep && save;
    if (rec.state !== "inactive") rec.stop();
  };

  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    void ctx.resume().catch(() => undefined);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const detector = new SilenceDetector({ ...SILENCE, ...opts.silence }, performance.now());
    let alive = false;
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const level = rms(buf);
      if (level > 0) alive = true;
      opts.onLevel?.(level);
      if (!alive) return;
      const v = detector.push(level, performance.now());
      if (v === "stop") end(true);
      else if (v === "idle") end(false);
    }, TICK_MS);
  } catch {
    // no level meter: manual stop only
  }
  return { done, stop: () => end(true), cancel: () => end(false) };
}
