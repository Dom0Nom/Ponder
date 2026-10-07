import { describe, expect, it } from "vitest";
import { remarkCitations } from "./remarkCitations";

type N = { type: string; value?: string; children?: N[]; data?: { hProperties?: Record<string, unknown> } };

function run(value: string, known = 5): N[] {
  const tree: N = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value }] }] };
  remarkCitations({ known })(tree);
  return tree.children![0].children!;
}

const refs = (nodes: N[]) => nodes.filter((n) => n.type === "citeRef").map((n) => n.data!.hProperties);

describe("remarkCitations", () => {
  it("emits one ref per bracket group", () => {
    const out = run("A fact [1, 3]. More [2].");
    expect(refs(out)).toEqual([
      { "data-ns": "1,3", "data-inferred": "0" },
      { "data-ns": "2", "data-inferred": "0" },
    ]);
  });

  it("merges adjacent groups", () => {
    const out = run("Both [1][3] agree.");
    expect(refs(out)).toEqual([{ "data-ns": "1,3", "data-inferred": "0" }]);
    expect(out.map((n) => n.type)).toEqual(["text", "citeRef", "text"]);
  });

  it("marks a ref inferred only when every number is inferred", () => {
    expect(refs(run("x [~2]"))).toEqual([{ "data-ns": "2", "data-inferred": "1" }]);
    expect(refs(run("x [~2, 3]"))).toEqual([{ "data-ns": "2,3", "data-inferred": "0" }]);
  });

  it("ignores numbers without a citation", () => {
    expect(refs(run("x [9]", 3))).toEqual([]);
  });
});
