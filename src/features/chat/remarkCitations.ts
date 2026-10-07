import { CITE_RE } from "../../lib/chat/citations";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Turns `[1]`, `[2][3]`, `[1, 4]`, `[~2]` in text nodes into one `<cite-ref data-ns="2,3" data-inferred>` per bracket run. */
export function remarkCitations(opts: { known: number }) {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children) return;
      const next: Node[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value && CITE_RE.test(child.value)) {
          CITE_RE.lastIndex = 0;
          let last = 0;
          for (const m of child.value.matchAll(CITE_RE)) {
            const refs = m[1]
              .split(/[,;]/)
              .map((x) => ({ n: Number(x.trim().replace("~", "")), inferred: x.includes("~") }))
              .filter((r) => r.n >= 1 && r.n <= opts.known);
            if (!refs.length) continue;
            if (m.index! > last) next.push({ type: "text", value: child.value.slice(last, m.index) });
            const prev = next[next.length - 1];
            const adjacent = m.index === last && prev?.type === "citeRef";
            if (adjacent) {
              const props = prev.data!.hProperties!;
              props["data-ns"] = [props["data-ns"], ...refs.map((r) => r.n)].join(",");
              props["data-inferred"] = props["data-inferred"] === "1" && refs.every((r) => r.inferred) ? "1" : "0";
            } else {
              next.push({
                type: "citeRef",
                data: {
                  hName: "cite-ref",
                  hProperties: { "data-ns": refs.map((r) => r.n).join(","), "data-inferred": refs.every((r) => r.inferred) ? "1" : "0" },
                },
                children: [],
              });
            }
            last = m.index! + m[0].length;
          }
          if (last < child.value.length) next.push({ type: "text", value: child.value.slice(last) });
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}
