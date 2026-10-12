/** Ambient sounds are generated, not recorded: seamless loops from seeded noise, so nothing is downloaded and nothing needs a licence. */
export const AMBIENT_SOUNDS = ["rain", "brown", "pink", "waves", "fan"] as const;
export type AmbientSound = (typeof AMBIENT_SOUNDS)[number];

export interface AmbientPrefs {
  sound: AmbientSound | "off";
  volume: number;
}

export const AMBIENT_KEY = "focus.ambient";
export const DEFAULT_AMBIENT: AmbientPrefs = { sound: "off", volume: 0.4 };

export function readAmbient(v: unknown): AmbientPrefs {
  const o = v && typeof v === "object" ? (v as Partial<AmbientPrefs>) : {};
  const sound = o.sound && (AMBIENT_SOUNDS as readonly string[]).includes(o.sound) ? o.sound : "off";
  const volume = typeof o.volume === "number" && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : DEFAULT_AMBIENT.volume;
  return { sound, volume };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

const LOOP_SECONDS: Record<AmbientSound, number> = { rain: 8, brown: 6, pink: 6, waves: 16, fan: 6 };
const FADE_SECONDS = 0.5;

function channel(kind: AmbientSound, rate: number, n: number, seed: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let brown = 0;
  let lp = 0;
  const pink = (w: number) => {
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return p * 0.11;
  };
  let drop = 0;
  let dropEnv = 0;
  for (let i = 0; i < n; i++) {
    const w = rand();
    brown = (brown + 0.02 * w) / 1.02;
    switch (kind) {
      case "pink":
        out[i] = pink(w);
        break;
      case "brown":
        out[i] = brown * 3.5;
        break;
      case "fan":
        lp += 0.08 * (brown * 3.5 - lp);
        out[i] = lp * 1.6 + pink(w) * 0.08;
        break;
      case "waves": {
        const t = i / rate;
        const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (LOOP_SECONDS.waves / 2));
        out[i] = (brown * 3.5 * (0.25 + 0.75 * swell) + pink(w) * 0.35 * swell) * 0.9;
        break;
      }
      case "rain": {
        if (dropEnv < 0.001 && rand() > 0.9992) {
          dropEnv = 0.4 + 0.6 * Math.abs(rand());
        }
        drop = 0.6 * drop + 0.4 * w;
        dropEnv *= 0.9965;
        out[i] = pink(w) * 0.55 + (w - drop) * dropEnv * 0.35;
        break;
      }
    }
  }
  return out;
}

/** A stereo loop whose end crossfades into its start, so `loop = true` plays without a click. */
export function makeLoop(kind: AmbientSound, rate: number, seed = 7): [Float32Array, Float32Array] {
  const n = Math.round(LOOP_SECONDS[kind] * rate);
  const fade = Math.round(FADE_SECONDS * rate);
  const mk = (s: number) => {
    const raw = channel(kind, rate, n + fade, s);
    const out = raw.slice(0, n);
    for (let i = 0; i < fade; i++) {
      const a = i / fade;
      out[i] = raw[n + i] * (1 - a) + raw[i] * a;
    }
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    const gain = peak > 0 ? 0.8 / peak : 1;
    for (let i = 0; i < n; i++) out[i] *= gain;
    return out;
  };
  return [mk(seed), mk(seed * 31 + 3)];
}

export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private cache = new Map<AmbientSound, AudioBuffer>();
  private token = 0;
  current: AmbientSound | null = null;

  async play(kind: AmbientSound, volume: number) {
    const token = ++this.token;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (token !== this.token || !this.ctx) return;
    if (this.current === kind && this.src) return this.setVolume(volume);
    this.stop(0.4);
    let buf = this.cache.get(kind);
    if (!buf) {
      const [l, r] = makeLoop(kind, this.ctx.sampleRate);
      buf = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
      buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
      this.cache.set(kind, buf);
    }
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume * 0.5, this.ctx.currentTime + 1.5);
    gain.connect(this.ctx.destination);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    this.src = src;
    this.gain = gain;
    this.current = kind;
  }

  setVolume(volume: number) {
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(volume * 0.5, this.ctx.currentTime, 0.1);
  }

  stop(fade = 1) {
    this.token++;
    const { ctx, src, gain } = this;
    this.src = null;
    this.gain = null;
    this.current = null;
    if (!ctx || !src || !gain) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    src.stop(ctx.currentTime + fade);
  }

  close() {
    this.stop(0);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.cache.clear();
  }

  get playing() {
    return this.src != null;
  }
}
