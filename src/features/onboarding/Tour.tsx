import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { Kbd } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { OB, useOb } from "./state";

interface Mark {
  id: "chat" | "sources" | "studio" | "palette";
  anchors: string[];
}

const MARKS: Mark[] = [
  { id: "chat", anchors: ['[data-testid="pane-chat"]'] },
  { id: "sources", anchors: ['[data-testid="pane-sources"]', '[data-tour="sources"]', '[data-testid="chat-empty"] button'] },
  { id: "studio", anchors: ['[data-testid="pane-studio"]'] },
  { id: "palette", anchors: ['[data-tour="search"]'] },
];

const W = 300;

function place(r: DOMRect | null): CSSProperties & { ring?: CSSProperties } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!r) return { left: (vw - W) / 2, top: vh * 0.3 };
  let left: number;
  let top = r.top + 24;
  if (r.width > vw * 0.4) left = r.left + (r.width - W) / 2;
  else if (r.left + r.width / 2 > vw / 2) left = r.left - W - 12;
  else left = r.right + 12;
  if (r.width <= vw * 0.4 && r.height < 80) {
    left = r.left;
    top = r.bottom + 12;
  }
  return { left: Math.max(12, Math.min(left, vw - W - 12)), top: Math.max(12, Math.min(top, vh - 200)) };
}

function useAnchor(anchors: string[], tick: unknown) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      for (const sel of anchors) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return setRect(r);
        }
      }
      setRect(null);
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 300);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [anchors, tick]);
  return rect;
}

export function TourHost() {
  const open = useUi((st) => st.tourOpen);
  const onSpace = useUi((st) => st.route.name === "space");
  const setOpen = useUi((st) => st.setTourOpen);
  const { save } = useOb();
  const [i, setI] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const mark = MARKS[i];
  const rect = useAnchor(mark.anchors, `${open}${i}`);
  const show = open && onSpace;

  useEffect(() => {
    if (open && !onSpace) return;
    if (!open) setI(0);
  }, [open, onSpace]);

  const close = () => {
    setOpen(false);
    save(OB.tour, true).catch(() => {});
  };

  useEffect(() => {
    if (!show) return;
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [show, i]);

  if (!show) return null;
  const last = i === MARKS.length - 1;
  const text = s.onboarding.tour[mark.id];
  const pos = place(rect);
  return createPortal(
    <>
      {rect && (
        <div
          aria-hidden
          className="t-panel-slide pointer-events-none fixed z-[75] rounded-pane border-2 border-fg"
          data-open="true"
          style={{ left: rect.left + 2, top: rect.top + 2, width: rect.width - 4, height: rect.height - 4 }}
        />
      )}
      <div
        role="dialog"
        aria-label={text.title}
        data-testid="tour-mark"
        key={i}
        className="t-panel-slide fixed z-[76] flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-menu"
        data-open="true"
        style={{ ...pos, width: W }}
      >
        <p className="flex items-center justify-between text-input font-semibold">
          {text.title}
          {mark.id === "palette" && <Kbd keys={["⌘", "K"]} />}
        </p>
        <p className="text-body leading-[1.5] text-muted">{text.body}</p>
        <div className="mt-1 flex items-center justify-between">
          <Button variant="ghost-muted" size="sm" onClick={close}>
            {s.onboarding.tour.dismiss}
          </Button>
          <Button ref={next} variant="primary" size="sm" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? s.onboarding.tour.done : s.onboarding.tour.next}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
