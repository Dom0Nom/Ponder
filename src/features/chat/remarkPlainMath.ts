import { plainMath } from "../../lib/utils";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: unknown;
}

/** Inline math that is just a spaced expression ("y = 3x - 4") becomes plain text; anything with TeX stays KaTeX. */
export function remarkPlainMath() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === "inlineMath" && child.value != null) {
          const plain = plainMath(child.value);
          if (plain != null) {
            child.type = "text";
            child.value = plain;
            delete child.children;
            delete child.data;
          }
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
