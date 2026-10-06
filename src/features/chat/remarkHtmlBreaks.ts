interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

const BR_RE = /<br\s*\/?>/gi;

/** Model-emitted `<br>` becomes a real line break; other raw HTML stays escaped. */
export function remarkHtmlBreaks() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children) return;
      const next: Node[] = [];
      for (const child of node.children) {
        if (child.type === "html" && child.value) {
          const parts = child.value.split(BR_RE);
          if (parts.length > 1 && parts.every((p) => p.trim() === "")) {
            for (let i = 1; i < parts.length; i++) next.push({ type: "break" });
            continue;
          }
        }
        walk(child);
        next.push(child);
      }
      node.children = next;
    };
    walk(tree);
  };
}
