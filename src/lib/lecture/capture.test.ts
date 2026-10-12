import { describe, expect, it } from "vitest";
import { TranscriptQueue, clock } from "./capture";

const blob = (s: string) => new Blob([s], { type: "audio/webm" });

describe("lecture capture", () => {
  it("formats clock times", () => {
    expect([clock(0), clock(61_000), clock(3_725_000)]).toEqual(["0:00", "1:01", "1:02:05"]);
  });

  it("transcribes in order, skips silence and retries failures", async () => {
    let fail = true;
    const seen: string[] = [];
    const q = new TranscriptQueue(async (b) => {
      const t = await b.text();
      seen.push(t);
      if (t === "two" && fail) throw new Error("rate limited");
      return t === "silence" ? "  " : `said ${t}`;
    }, () => {});
    q.add(blob("one"), "audio/webm", 0);
    q.add(blob("two"), "audio/webm", 60_000);
    q.add(blob("silence"), "audio/webm", 120_000);
    q.add(blob("four"), "audio/webm", 180_000);
    q.add(new Blob([]), "audio/webm", 240_000);
    expect(q.pending).toBe(true);
    await q.idle();
    expect(seen).toEqual(["one", "two", "silence", "four"]);
    expect(q.failed).toBe(1);
    expect(q.text).toBe("[0:00] said one\n\n[3:00] said four");
    fail = false;
    q.retry(1);
    await q.idle();
    expect(q.failed).toBe(0);
    expect(q.text).toBe("[0:00] said one\n\n[1:00] said two\n\n[3:00] said four");
  });
});
