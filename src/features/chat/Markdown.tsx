import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { remarkCitations } from "./remarkCitations";

export const Markdown = memo(function Markdown({
  text,
  knownCitations = 0,
  renderCite,
}: {
  text: string;
  knownCitations?: number;
  renderCite?: (n: number, inferred: boolean) => ReactNode;
}) {
  const components = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    "cite-ref": (props: { "data-n"?: number | string; "data-inferred"?: string }) =>
      renderCite?.(Number(props["data-n"]), props["data-inferred"] === "1") ?? null,
  } as unknown as Components;
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, [remarkCitations, { known: knownCitations }]]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
