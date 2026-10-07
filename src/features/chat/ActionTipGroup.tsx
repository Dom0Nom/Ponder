import { useRef, type FocusEvent, type PointerEvent, type ReactNode } from "react";

/** Transitions.dev Tooltip: one bubble that travels between the group's buttons ([data-tip-name], [data-tip-desc]). */
export function ActionTipGroup({ children, className }: { children: ReactNode; className?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);

  const hide = () => tip.current?.setAttribute("data-show", "false");
  const place = (t: HTMLElement) => {
    const el = tip.current;
    const body = text.current;
    const m = measure.current;
    const g = group.current;
    if (!el || !body || !m || !g) return;
    const showing = el.dataset.show === "true";
    const name = t.dataset.tipName ?? "";
    const desc = t.dataset.tipDesc ?? "";
    body.replaceChildren();
    const b = document.createElement("b");
    b.textContent = name;
    body.append(b);
    if (desc) {
      const sp = document.createElement("span");
      sp.textContent = desc;
      body.append(sp);
    }
    m.textContent = desc.length > name.length ? desc : name;
    const width = Math.min(220, Math.ceil(m.scrollWidth + 20));
    const gr = g.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const x = r.left - gr.left + r.width / 2 - width / 2;
    if (!showing) el.style.transition = "none";
    el.style.width = `${width}px`;
    el.style.setProperty("--tt-x", `${x}px`);
    if (!showing) {
      void el.offsetWidth;
      el.style.transition = "";
    }
    el.dataset.show = "true";
  };
  const onOver = (e: PointerEvent | FocusEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip-name]");
    if (t) place(t);
  };

  return (
    <div ref={group} className={className ? `t-tt-group ${className}` : "t-tt-group"} onPointerOver={onOver} onFocus={onOver} onPointerLeave={hide} onBlur={hide}>
      {children}
      <div ref={tip} className="t-tt" role="tooltip" data-show="false">
        <span ref={text} className="t-tt-text" />
      </div>
      <span ref={measure} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap text-xs" />
    </div>
  );
}
