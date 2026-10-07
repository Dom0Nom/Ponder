import { describe, expect, it } from "vitest";
import { FIXTURE_NOW, readOptions, seedDesignFixture, SPACES, THREADS } from "./designFixture";
import type { DB } from "./mockBackend";

const emptyDb = () =>
  ({ spaces: {}, sources: {}, texts: {}, chunks: [], threads: {}, messages: {}, journal: {}, providers: {}, secrets: {}, oauth: {}, cloud: {}, settings: {}, focus: null, sessions: {}, focusEvents: [], musicCalls: [], microSteps: {}, parking: {}, memory: {}, cards: {}, mistakes: {}, abilities: {}, practiceItems: {}, attempts: [], images: {}, curricula: {}, levels: {}, assessments: {}, courses: {}, watched: {}, nextId: 1, clockOffset: 0 }) as unknown as DB;

describe("design fixture", () => {
  it("seeds the 2a space, threads and chat", () => {
    const db = emptyDb();
    seedDesignFixture(db, readOptions("?fixture=design&chat=v2&focus=work"));
    expect(Object.values(db.spaces).map((s) => s.name)).toEqual(SPACES.map((s) => s.name));
    expect(Object.values(db.threads).map((t) => t.title).sort()).toEqual(THREADS.map((t) => t.title).sort());
    expect(Object.values(db.messages).some((m) => m.content.includes("$y = 2x + 1$"))).toBe(true);
    expect(db.focus?.phase).toBe("work");
    expect(FIXTURE_NOW - db.focus!.phaseStartedAt).toBe(6 * 60_000 + 18_000);
  });

  it("supports the no-spaces variant", () => {
    const db = emptyDb();
    seedDesignFixture(db, readOptions("?spaces=none"));
    expect(Object.keys(db.spaces)).toHaveLength(0);
  });
});
