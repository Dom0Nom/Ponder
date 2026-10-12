import { useEffect, useMemo, useRef, useState } from "react";
import { useIsDark } from "../../app/useTheme";
import { explainerDocument, themeVars } from "../../lib/studio/explainer";
import type { ExplainerData } from "../../lib/studio/kinds";
import { s } from "../../lib/strings";

export function currentExplainerDoc(html: string, title?: string, resize = false) {
  const css = getComputedStyle(document.documentElement);
  return explainerDocument(html, themeVars((n) => css.getPropertyValue(n)), { title, resize, font: css.getPropertyValue("--font-ui") });
}

export function ExplainerView({ data }: { data: ExplainerData }) {
  const dark = useIsDark();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => currentExplainerDoc(data.html, undefined, true), [data.html, dark]);

  useEffect(() => {
    setError(null);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object") return;
      if (typeof e.data.ponderExplainerHeight === "number") setHeight(Math.min(Math.max(e.data.ponderExplainerHeight, 120), 2400));
      if (typeof e.data.ponderExplainerError === "string") setError(e.data.ponderExplainerError.slice(0, 200));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [doc]);

  return (
    <div className="flex flex-col gap-2" data-testid="explainer">
      <iframe
        ref={frame}
        title={s.outputs.explainer.frameTitle}
        sandbox="allow-scripts"
        srcDoc={doc}
        style={{ height }}
        className="w-full rounded-card border border-border bg-surface"
        data-testid="explainer-frame"
      />
      {error ? (
        <p className="text-label text-danger" role="alert" data-testid="explainer-error">
          {s.outputs.explainer.error(error)}
        </p>
      ) : (
        <p className="text-label text-muted">{s.outputs.explainer.sandbox}</p>
      )}
    </div>
  );
}
