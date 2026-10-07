import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { rehypeStreamWords } from "./rehypeStreamWords";
import { remarkCitations } from "./remarkCitations";
import { remarkHtmlBreaks } from "./remarkHtmlBreaks";
import { remarkPlainMath } from "./remarkPlainMath";

export const Markdown = memo(function Markdown({
  text,
  knownCitations = 0,
  renderCite,
  plainInlineMath,
  streaming,
}: {
  text: string;
  knownCitations?: number;
  plainInlineMath?: boolean;
  streaming?: boolean;
  renderCite?: (ns: number[], inferred: boolean) => ReactNode;
}) {
  const components = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    "cite-ref": (props: { "data-ns"?: string; "data-inferred"?: string }) =>
      renderCite?.(String(props["data-ns"] ?? "").split(",").map(Number), props["data-inferred"] === "1") ?? null,
  } as unknown as Components;
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, ...(plainInlineMath ? [remarkPlainMath] : []), remarkHtmlBreaks, [remarkCitations, { known: knownCitations }]]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }], ...(streaming ? [rehypeStreamWords] : [])]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
