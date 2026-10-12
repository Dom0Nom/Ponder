/** Recording is cut into short segments so each one is a complete audio file the transcription API accepts. */
export const SEGMENT_MS = 60_000;

export interface Segment {
  index: number;
  /** ms from the start of the recording */
  start: number;
  state: "pending" | "done" | "error";
  text: string;
  error?: unknown;
}

type Transcribe = (blob: Blob, mime: string) => Promise<string>;

export function clock(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Transcribes segments one at a time, in order, and keeps failed ones for a retry. */
export class TranscriptQueue {
  segments: Segment[] = [];
  private blobs = new Map<number, { blob: Blob; mime: string }>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private transcribe: Transcribe,
    private onChange: () => void,
  ) {}

  add(blob: Blob, mime: string, start: number) {
    if (!blob.size) return;
    const index = this.segments.length;
    this.segments.push({ index, start, state: "pending", text: "" });
    this.blobs.set(index, { blob, mime });
    this.onChange();
    this.run(index);
  }

  retry(index: number) {
    const seg = this.segments[index];
    if (!seg || seg.state !== "error") return;
    this.segments[index] = { ...seg, state: "pending", error: undefined };
    this.onChange();
    this.run(index);
  }

  private run(index: number) {
    this.chain = this.chain.then(async () => {
      const b = this.blobs.get(index);
      if (!b) return;
      try {
        const text = (await this.transcribe(b.blob, b.mime)).trim();
        this.segments[index] = { ...this.segments[index], state: "done", text };
        this.blobs.delete(index);
      } catch (error) {
        this.segments[index] = { ...this.segments[index], state: "error", error };
      }
      this.onChange();
    });
  }

  get pending() {
    return this.segments.some((x) => x.state === "pending");
  }

  get failed() {
    return this.segments.filter((x) => x.state === "error").length;
  }

  /** Paragraphs with a time mark, silent segments left out. */
  get text() {
    return this.segments
      .filter((x) => x.state === "done" && x.text)
      .map((x) => `[${clock(x.start)}] ${x.text}`)
      .join("\n\n");
  }

  idle() {
    return this.chain;
  }
}
