import { describe, expect, it } from "vitest";
import { CURRICULA } from "./curricula";
import { graphFromCurriculum, graphFromTopics, knownLevels, parseProposal, removeNode, renameNode, sanitize, setKnown, toTopicRefs, topoOrder, validateGraph } from "./graph";
import type { GoalGraph, GoalNode } from "../types";

const n = (id: string, prereqs: string[] = [], extra: Partial<GoalNode> = {}): GoalNode => ({
  id,
  title: id.toUpperCase(),
  description: id,
  group: "g",
  prereqs,
  known: false,
  sources: [],
  ...extra,
});

describe("graph validation", () => {
  it("accepts every bundled curriculum as a valid graph", () => {
    for (const c of CURRICULA) expect(validateGraph(graphFromCurriculum(c))).toEqual([]);
  });

  it("flags unknown prerequisites, self loops, duplicates and empty titles", () => {
    const g: GoalGraph = { nodes: [n("a", ["zzz"]), n("b", ["b"]), n("a"), n("c", [], { title: " " })] };
    const errors = validateGraph(g).join("\n");
    expect(errors).toContain("unknown prerequisite zzz");
    expect(errors).toContain("depends on itself");
    expect(errors).toContain("duplicate id");
    expect(errors).toContain("empty title");
  });

  it("detects a cycle", () => {
    expect(validateGraph({ nodes: [n("a", ["b"]), n("b", ["c"]), n("c", ["a"])] })).toContain("cycle");
  });

  it("sanitize removes unknown prerequisites and breaks cycles", () => {
    const g = sanitize({ nodes: [n("a", ["b", "ghost"]), n("b", ["c"]), n("c", ["a"])] });
    expect(validateGraph(g)).toEqual([]);
    expect(g.nodes).toHaveLength(3);
  });
});

describe("graph edits", () => {
  const g: GoalGraph = { nodes: [n("a"), n("b", ["a"]), n("c", ["b"])] };

  it("removing a topic reconnects its dependents to its prerequisites", () => {
    const r = removeNode(g, "b");
    expect(r.nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.nodes[1].prereqs).toEqual(["a"]);
    expect(validateGraph(r)).toEqual([]);
  });

  it("renames and marks known without touching the rest", () => {
    const r = setKnown(renameNode(g, "a", " Basics "), "a", true);
    expect(r.nodes[0]).toMatchObject({ title: "Basics", known: true });
    expect(r.nodes[1]).toEqual(g.nodes[1]);
    expect(knownLevels(r)).toEqual([{ id: "a", level: "strong" }]);
  });

  it("keeps a title when the rename is blank", () => {
    expect(renameNode(g, "a", "  ").nodes[0].title).toBe("A");
  });

  it("orders prerequisites first", () => {
    const shuffled: GoalGraph = { nodes: [n("c", ["b"]), n("b", ["a"]), n("a")] };
    expect(topoOrder(shuffled).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("converts to topic refs for the curriculum", () => {
    expect(toTopicRefs(g)[1]).toMatchObject({ id: "b", prereqs: ["a"] });
    expect(toTopicRefs(g)[0].prereqs).toBeUndefined();
  });
});

describe("proposals and syllabi", () => {
  it("maps model ids to stable ids and drops bad prerequisites", () => {
    const { title, graph } = parseProposal(
      JSON.stringify({
        title: "Robot arm",
        topics: [
          { id: "x", title: "Motors", description: "dc, servo", group: "Hardware", prereqs: [] },
          { id: "y", title: "Control", description: "pid", group: "Software", prereqs: ["x", "nope"] },
          { id: "z", title: "Kinematics", group: "Software", prereqs: ["y", "z"] },
        ],
      }),
    );
    expect(title).toBe("Robot arm");
    expect(graph.nodes.map((x) => x.id)).toEqual(["goal.1", "goal.2", "goal.3"]);
    expect(graph.nodes[1].prereqs).toEqual(["goal.1"]);
    expect(graph.nodes[2].prereqs).toEqual(["goal.2"]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it("breaks a cycle the model proposed", () => {
    const { graph } = parseProposal(
      JSON.stringify({ topics: [{ id: "a", title: "A", prereqs: ["b"] }, { id: "b", title: "B", prereqs: ["a"] }] }),
    );
    expect(validateGraph(graph)).toEqual([]);
  });

  it("rejects a proposal with fewer than two topics", () => {
    expect(() => parseProposal('{"topics":[{"id":"a","title":"A"}]}')).toThrow();
  });

  it("builds the same graph shape from a syllabus-style topic list", () => {
    const g = graphFromTopics([
      { id: "custom.1", title: "One", description: "1", group: "G" },
      { id: "custom.2", title: "Two", description: "2", group: "G", prereqs: ["custom.1"] },
    ]);
    expect(g.nodes.every((x) => x.known === false && x.sources.length === 0)).toBe(true);
    expect(validateGraph(g)).toEqual([]);
  });
});
