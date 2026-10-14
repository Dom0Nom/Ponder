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
import { CodeCell } from "./CodeCell";
import { CCodeCell } from "./CCodeCell";
import { cellLang } from "../../lib/codecell/lang";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] | string };
  children?: HastNode[];
}

const hastText = (n: HastNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hastText).join(""));

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
    pre: ({ node, children }: { node?: HastNode; children?: ReactNode }) => {
      const code = node?.children?.find((c) => c.tagName === "code");
      const cls = code?.properties?.className;
      const lang = !streaming && code ? cellLang(Array.isArray(cls) ? cls.join(" ") : cls) : null;
      if (!lang || !code) return <pre>{children}</pre>;
      const text = hastText(code).replace(/\n$/, "");
      if (lang === "c")
        return (
          <CCodeCell code={text}>
            <pre>{children}</pre>
          </CCodeCell>
        );
      return (
        <CodeCell lang={lang} code={text}>
          <pre>{children}</pre>
        </CodeCell>
      );
    },
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
