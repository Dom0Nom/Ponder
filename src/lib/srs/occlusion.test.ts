import { describe, expect, it } from "vitest";
import type { Card } from "../types";
import {
  MIN_SIZE,
  cleanMasks,
  handleAt,
  isBigEnough,
  maskAt,
  moveRect,
  normalizeRect,
  occlusionGroups,
  rectFromPoints,
  resizeRect,
} from "./occlusion";

const close = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(v as number, 6);
};

describe("occlusion rects", () => {
  it("builds a rect from a drag in any direction and clips it to the image", () => {
    close(rectFromPoints({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
    close(rectFromPoints({ x: -0.3, y: 0.9 }, { x: 0.5, y: 1.4 }), { x: 0, y: 0.9, w: 0.5, h: 0.1 });
  });

  it("normalizes negative sizes and keeps rects inside 0..1", () => {
    close(normalizeRect({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 }), { x: 0.3, y: 0.4, w: 0.2, h: 0.1 });
    close(normalizeRect({ x: 0.9, y: -0.2, w: 0.3, h: 2 }), { x: 0.7, y: 0, w: 0.3, h: 1 });
    close(normalizeRect({ x: NaN, y: 0.1, w: 0.1, h: 0.1 }), { x: 0, y: 0.1 });
  });

  it("rejects masks smaller than the minimum", () => {
    expect(isBigEnough({ x: 0, y: 0, w: MIN_SIZE / 2, h: 0.5 })).toBe(false);
    expect(isBigEnough({ x: 0, y: 0, w: 0.1, h: 0.1 })).toBe(true);
  });

  it("hit-tests the topmost mask", () => {
    const masks = [
      { id: "a", x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      { id: "b", x: 0.4, y: 0.4, w: 0.3, h: 0.3 },
    ];
    expect(maskAt(masks, { x: 0.5, y: 0.5 })?.id).toBe("b");
    expect(maskAt(masks, { x: 0.2, y: 0.2 })?.id).toBe("a");
    expect(maskAt(masks, { x: 0.9, y: 0.9 })).toBeNull();
  });

  it("finds resize handles at corners and edge midpoints", () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const tol = { x: 0.02, y: 0.02 };
    expect(handleAt(r, { x: 0.21, y: 0.19 }, tol)).toBe("nw");
    expect(handleAt(r, { x: 0.6, y: 0.6 }, tol)).toBe("se");
    expect(handleAt(r, { x: 0.4, y: 0.2 }, tol)).toBe("n");
    expect(handleAt(r, { x: 0.61, y: 0.4 }, tol)).toBe("e");
    expect(handleAt(r, { x: 0.4, y: 0.4 }, tol)).toBeNull();
    expect(handleAt(r, { x: 0.9, y: 0.9 }, tol)).toBeNull();
  });

  it("moves rects without leaving the image", () => {
    const r = { x: 0.7, y: 0.1, w: 0.2, h: 0.2 };
    close(moveRect(r, 0.5, -0.5), { x: 0.8, y: 0, w: 0.2, h: 0.2 });
    close(moveRect(r, -0.1, 0.1), { x: 0.6, y: 0.2 });
  });

  it("resizes from a handle keeping the opposite side fixed", () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    close(resizeRect(r, "se", 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    close(resizeRect(r, "nw", -0.1, 0.1), { x: 0.1, y: 0.3, w: 0.5, h: 0.3 });
    close(resizeRect(r, "e", 0.9, 0.9), { x: 0.2, y: 0.2, w: 0.8, h: 0.4 });
    close(resizeRect(r, "w", 1, 0), { x: 0.6 - MIN_SIZE, w: MIN_SIZE });
    close(resizeRect(r, "n", 0, -1), { y: 0, h: 0.6 });
  });
});

describe("occlusion cards", () => {
  const card = (id: string, image: string | null, createdAt: number, kind: Card["kind"] = "occlusion") =>
    ({ id, kind, createdAt, data: image ? { image, mask: id } : null }) as Card;

  it("groups occlusion cards by image", () => {
    const groups = occlusionGroups([
      card("b", "one.png", 2),
      card("a", "one.png", 1),
      card("c", "two.png", 3),
      card("d", null, 4),
      card("e", "one.png", 5, "basic"),
    ]);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("trims labels and drops empty ones", () => {
    expect(cleanMasks([{ id: "1", x: 0, y: 0, w: 1, h: 1, label: "  " }, { id: "2", x: 0, y: 0, w: 1, h: 1, label: " Nucleus " }])).toEqual([
      { id: "1", x: 0, y: 0, w: 1, h: 1 },
      { id: "2", x: 0, y: 0, w: 1, h: 1, label: "Nucleus" },
    ]);
  });
});
