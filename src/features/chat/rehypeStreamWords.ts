import { visit, SKIP } from "unist-util-visit";
import type { Element, Root, Text } from "hast";

/** While streaming, wraps each word so new words fade in; code and KaTeX stay untouched. */
export function rehypeStreamWords() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "element") {
        const cls = node.properties?.className;
        if (node.tagName === "code" || node.tagName === "pre" || (Array.isArray(cls) && cls.includes("katex"))) return SKIP;
        return;
      }
      if (node.type !== "text" || !parent || index == null) return;
      const parts = node.value.split(/(\s+)/).filter(Boolean);
      const kids = parts.map((p) =>
        /^\s+$/.test(p)
          ? ({ type: "text", value: p } as Text)
          : ({
              type: "element",
              tagName: "span",
              properties: { className: ["t-stream-w", "is-in"] },
              children: [{ type: "text", value: p } as Text],
            } as Element),
      );
      (parent as Element).children.splice(index, 1, ...kids);
      return [SKIP, index + kids.length];
    });
  };
}
