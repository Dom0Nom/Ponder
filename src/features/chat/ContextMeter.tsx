import { Check, Layers } from "lucide-react";
import type { MessageMeta, Thread } from "../../lib/types";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { COMPACT_AT } from "../../lib/context/history";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/misc";

type Ctx = NonNullable<MessageMeta["context"]>;

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n);

export function formatCost(usd: number): string {
  if (usd === 0) return s.context.free;
  if (usd < 0.01) return `<$0.01`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 3 : 2 }).format(usd);
}

/** A ring filled to `ratio`; the conversation share drawn in the inner ring. */
function Ring({ ratio, inner }: { ratio: number; inner: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const ri = 3;
  const ci = 2 * Math.PI * ri;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden className="-rotate-90">
      <circle cx={8} cy={8} r={r} fill="none" strokeWidth={2} className="stroke-fill" />
      <circle cx={8} cy={8} r={r} fill="none" strokeWidth={2} strokeLinecap="round" className="m-ring stroke-fg-secondary" strokeDasharray={`${Math.min(1, ratio) * c} ${c}`} />
      <circle cx={8} cy={8} r={ri} fill="none" strokeWidth={2} className="stroke-fill" />
      <circle cx={8} cy={8} r={ri} fill="none" strokeWidth={2} className={cn("m-ring", inner >= COMPACT_AT ? "stroke-fg" : "stroke-muted")} strokeDasharray={`${Math.min(1, inner) * ci} ${ci}`} />
    </svg>
  );
}

function Bar({ value, max, mark }: { value: number; max: number; mark?: number }) {
  return (
    <span className="relative mt-1 block h-1 w-full overflow-hidden rounded-full bg-fill">
      <span className="m-bar absolute inset-y-0 start-0 rounded-full bg-fg-secondary" style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
      {mark != null && <span className="absolute inset-y-0 w-px bg-fg" style={{ insetInlineStart: `${mark * 100}%` }} />}
    </span>
  );
}

function Titles({ label, list }: { label: string; list: string[] }) {
  if (!list.length) return null;
  return (
    <p className="mt-1.5 text-label text-fg-secondary">
      <span className="font-medium text-fg">{label}</span> {list.slice(0, 4).join(", ")}
      {list.length > 4 ? ` ${s.context.andMore(list.length - 4)}` : ""}
    </p>
  );
}

/**
 * What went into the model's context for the latest answer: tokens of the window, the
 * conversation's share (it compacts at 80%), which sources were full/summary/passages, and the
 * estimated cost. Also holds the compaction actions.
 */
export function ContextMeter({
  ctx,
  thread,
  onCompact,
  onToggleAuto,
  busy,
}: {
  ctx: Ctx;
  thread?: Thread;
  onCompact: () => void;
  onToggleAuto: (on: boolean) => void;
  busy?: boolean;
}) {
  const share = ctx.conversation / Math.max(1, ctx.conversationBudget);
  const auto = thread?.autoCompact !== false;
  return (
    <Menu>
      <Tooltip content={s.context.tip(compact(ctx.used), compact(ctx.cap))} side="top">
        <MenuTrigger asChild>
          <button aria-label={s.context.label} data-testid="context-meter" className="flex h-7 items-center gap-1.5 rounded-btn px-2 text-label font-medium text-fg-secondary hover:bg-fill data-[state=open]:bg-fill">
            <Ring ratio={ctx.used / Math.max(1, ctx.cap)} inner={share} />
            <span className="tabular-nums">{compact(ctx.used)}</span>
          </button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent side="top" align="end" sideOffset={8} popover className="w-[300px] p-3">
        <p className="text-label font-semibold text-muted">{s.context.title}</p>
        <p className="mt-1 text-body">
          {s.context.used(compact(ctx.used), compact(ctx.cap))}
          {ctx.cap < ctx.window ? <span className="text-fg-secondary"> {s.context.capped(compact(ctx.window))}</span> : null}
        </p>
        <Bar value={ctx.used} max={ctx.cap} />
        <p className="mt-3 text-body">
          {s.context.conversation(compact(ctx.conversation), compact(ctx.conversationBudget))}
        </p>
        <Bar value={ctx.conversation} max={ctx.conversationBudget} mark={COMPACT_AT} />
        <p className="mt-1 text-label text-fg-secondary">{ctx.summarized ? s.context.summarized : auto ? s.context.compactsAt : s.context.noAuto}</p>
        <p className="mt-3 text-body">{s.context.passages(ctx.passages)}</p>
        <Titles label={s.context.full} list={ctx.full} />
        <Titles label={s.context.whole} list={ctx.whole} />
        <Titles label={s.context.summaryOnly} list={ctx.summaryOnly} />
        <Titles label={s.context.cut} list={ctx.truncated} />
        {ctx.cost != null && <p className="mt-3 text-body">{s.context.cost(formatCost(ctx.cost))}</p>}
        <MenuSeparator className="-mx-3 my-2" />
        <MenuItem disabled={busy || !thread} onSelect={onCompact}>
          <Layers size={14} /> {s.context.compactNow}
        </MenuItem>
        <MenuItem disabled={!thread} onSelect={() => onToggleAuto(!auto)}>
          <span className="flex size-[14px] items-center justify-center">{!auto && <Check size={14} />}</span> {s.context.dontCompact}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
