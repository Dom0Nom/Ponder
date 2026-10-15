import { lazy, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Timer } from "lucide-react";
import { Fx } from "../../components/fx/Fx";
import { NumberPop } from "../../components/motion/NumberPop";
import { Reveal } from "../../components/motion/Reveal";
import { TextSwap } from "../../components/motion/TextSwap";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/misc";
import { focusGoal, totalMinutes } from "../../lib/session/engine";
import { useDueCounts, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { buildNext } from "./build";
import { blockLabel } from "./blockLabel";
import { startNext } from "./sessionStore";

const MetalButton = lazy(() => import("../../components/fx/MetalButton"));

export function useNext(spaceId: string | undefined) {
  return useQuery({
    queryKey: ["next", spaceId],
    queryFn: () => buildNext(spaceId!),
    enabled: !!spaceId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** The space Home's Next card is about: most cards due, else the one opened last. */
export function useNextSpace(): string | undefined {
  const spaces = useSpaces();
  const due = useDueCounts();
  return useMemo(() => {
    const list = spaces.data ?? [];
    if (!list.length) return undefined;
    const dueOf = (id: string) => (due.data ?? []).find((d) => d.spaceId === id)?.due ?? 0;
    return [...list].sort((a, b) => dueOf(b.id) - dueOf(a.id) || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0].id;
  }, [spaces.data, due.data]);
}

/** "Next" as the main session button; metal with Visual effects on. */
export function NextButton({ spaceId, size, children }: { spaceId: string; size?: "sm" | "md" | "lg"; children?: ReactNode }) {
  const btn = (
    <Button variant="primary" size={size} onClick={() => void startNext(spaceId)} data-testid="next-start">
      {children ?? (
        <>
          {s.session.next}
          <ArrowRight size={14} />
        </>
      )}
    </Button>
  );
  return <Fx needsWebGL2 fallback={btn} render={() => <span data-testid="next-metal" className="contents"><MetalButton>{btn}</MetalButton></span>} />;
}

export function NextCard({ spaceId }: { spaceId: string }) {
  const { data, isLoading, error } = useNext(spaceId);
  const openFocusDialog = useUi((st) => st.openFocusDialog);
  const navigate = useUi((st) => st.navigate);

  if (isLoading) return <Skeleton className="h-[132px] rounded-card" />;
  if (error || !data) return null;
  const { blocks, input } = data;
  const first = blocks[0];
  const minutes = totalMinutes(blocks);

  return (
    <Reveal as="section" className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-3.5" data-testid="next-card" aria-label={s.session.title}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-label text-muted">{s.session.title}</p>
          <p className="truncate text-title font-semibold" data-testid="next-label">
            <TextSwap text={s.session.nextLabel(blockLabel(first))} />
          </p>
          <p className="text-label text-muted tabular-nums" data-testid="next-minutes">
            <MinutesText n={minutes} />
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            navigate({ name: "space", spaceId });
            openFocusDialog(focusGoal(input, blocks, blockLabel));
          }}
        >
          <Timer size={13} />
          {s.session.startFocus}
        </Button>
        <NextButton spaceId={spaceId} />
      </div>
      <ol className="flex flex-col gap-1" aria-label={s.session.list}>
        {blocks.map((b, i) => (
          <Reveal as="li" key={b.id} index={i} className={cn("flex items-center gap-2 text-body", i === 0 ? "text-fg" : "text-fg-secondary")}>
            <span className="size-1.5 shrink-0 rounded-full bg-faint" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{blockLabel(b)}</span>
            <span className="text-label text-muted tabular-nums">{s.session.minutes(b.minutes)}</span>
          </Reveal>
        ))}
      </ol>
    </Reveal>
  );
}

function MinutesText({ n }: { n: number }) {
  const text = s.session.total(n);
  const at = text.indexOf(String(n));
  return (
    <>
      {text.slice(0, at)}
      <NumberPop text={String(n)} popKey={n} onMount />
      {text.slice(at + String(n).length)}
    </>
  );
}

export function NextHeaderButton({ spaceId }: { spaceId: string }) {
  const { data } = useNext(spaceId);
  if (!data) return null;
  return <NextButton spaceId={spaceId} size="sm" />;
}
