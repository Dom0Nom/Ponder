import { useRef, useState } from "react";
import { create } from "zustand";
import { Library, Pause, PencilLine, Play, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards, useCards, useDueCounts, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Card, CardKind, NewCard, Space } from "../../lib/types";
import { cn, dueLabel } from "../../lib/utils";
import { resolveChatModel, NoModelError } from "../../lib/chat/llm";
import { generateCards, hitsToPassages } from "../../lib/srs/generate";
import { addGap, clozeFront, clozeNumbers, expandCloze } from "../../lib/srs/cloze";
import { quizSpace } from "../../lib/srs/quizSpace";
import { motionReduced } from "../../app/useTheme";
import { useUi } from "../../stores/ui";
import { useLowEnergy } from "../focus/useLowEnergy";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { fieldLabel, Input, Textarea } from "../../components/ui/input";
import { EmptyState, Segmented, Skeleton } from "../../components/ui/misc";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { PonderMark } from "../../components/brand/PonderMark";
import { toast, toastError } from "../../components/ui/toast";
import { LearnChevron } from "../../components/motion/LearnChevron";
import { NumberPop } from "../../components/motion/NumberPop";
import { TextSwap } from "../../components/motion/TextSwap";
import { useFlip } from "../../lib/useFlip";
import { PanelList, panelRow } from "../space/PanelList";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { OcclusionButtonSlot } from "./occlusionSlot";
import { OcclusionEditor } from "./OcclusionEditor";
import { occlusionGroups } from "../../lib/srs/occlusion";

interface AddCardRequest {
  open: boolean;
  spaceId?: string;
  kind?: CardKind;
  front?: string;
  back?: string;
  sourceId?: string | null;
  chunkStart?: number | null;
  chunkEnd?: number | null;
}

/** Lets other places (e.g. the source viewer selection) open the add-card dialog prefilled. */
export const useAddCard = create<{ req: AddCardRequest; open: (r: Omit<AddCardRequest, "open">) => void; close: () => void }>((set) => ({
  req: { open: false },
  open: (r) => set({ req: { ...r, open: true } }),
  close: () => set({ req: { open: false } }),
}));

const ROW = cn(panelRow, "t-learn h-[42px] w-full gap-3 text-start disabled:opacity-40");
const AREA = "min-h-[72px] leading-[1.6]";

export function FlashcardsPanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const counts = useDueCounts();
  const navigate = useUi((st) => st.navigate);
  const openAdd = useAddCard((st) => st.open);
  const [generating, setGenerating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [quizzing, setQuizzing] = useState(false);
  const low = useLowEnergy(space.id);
  const c = counts.data?.find((x) => x.spaceId === space.id);

  const quiz = async () => {
    setQuizzing(true);
    try {
      const r = await quizSpace(space);
      if (r) toast.success(r.mistakes ? s.cards.quizResultSaved(r.score, r.mistakes) : s.cards.quizResult(r.score));
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.errors.generic, e);
    } finally {
      setQuizzing(false);
    }
  };

  return (
    <StudioSubpanel title={s.cards.title} onBack={onBack} testId="flashcards-card">
      {counts.isLoading ? (
        <Skeleton className="h-8 w-40" />
      ) : (
        <div className="flex items-baseline gap-2" data-testid="card-counts">
          {c ? (
            <>
              <span className="text-[2rem] font-semibold leading-none tabular-nums">
                <NumberPop text={String(c.due)} popKey={c.due} />
              </span>
              <span className="font-medium text-fg-secondary">{s.cards.countsRest(c.new, c.total)}</span>
            </>
          ) : (
            <span className="text-muted">{s.cards.none}</span>
          )}
        </div>
      )}
      <Button variant="primary" className="w-full" disabled={!c?.total} onClick={() => navigate({ name: "review", spaceId: space.id })}>
        <Play size={15} /> {s.cards.review}
      </Button>
      <div data-testid="card-actions">
        <PanelList>
          <button className={ROW} disabled={low.active} title={low.reason} onClick={() => setGenerating(true)}>
            <Sparkles size={15} />
            <span className="flex-1 font-medium">{s.cards.generate}</span>
            <LearnChevron size={14} />
          </button>
          <button className={ROW} disabled={low.active} title={low.reason} onClick={() => openAdd({ spaceId: space.id })}>
            <Plus size={15} />
            <span className="flex-1 font-medium">{s.cards.add}</span>
            <LearnChevron size={14} />
          </button>
          {!low.active && <OcclusionButtonSlot spaceId={space.id} />}
          <button className={ROW} disabled={quizzing} onClick={quiz}>
            <PencilLine size={15} />
            <span className="flex-1 font-medium">{s.cards.quiz}</span>
            {quizzing ? <PonderMark size={20} state="generating" /> : <LearnChevron size={14} />}
          </button>
          {c?.total ? (
            <button className={ROW} onClick={() => setBrowsing(true)}>
              <Library size={15} />
              <span className="flex-1 font-medium">{s.cards.browse}</span>
              <LearnChevron size={14} />
            </button>
          ) : null}
        </PanelList>
      </div>
      {low.active && <p className="text-label text-muted">{low.reason}</p>}
      <GenerateCardsDialog space={space} open={generating} onOpenChange={setGenerating} />
      {browsing && <BrowseCardsDialog space={space} onClose={() => setBrowsing(false)} />}
    </StudioSubpanel>
  );
}

function GenerateCardsDialog({ space, open, onOpenChange }: { space: Space; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [focus, setFocus] = useState("");
  const [count, setCount] = useState<"5" | "10" | "20">("10");
  const [busy, setBusy] = useState(false);
  const sources = useSources(space.id);
  const cards = useCards(space.id);
  const ready = (sources.data ?? []).filter((x) => x.status === "ready" && x.useInChat);

  const run = async () => {
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      const query = focus.trim() || ready.map((x) => x.title).join(" ") || space.name;
      const hits = await api.searchChunks(space.id, query, Number(count) >= 20 ? 12 : 8);
      if (!hits.length) throw new Error("No passages found. Add sources or change the focus.");
      const made = await generateCards(llm, hitsToPassages(hits), {
        count: Number(count),
        focus: focus.trim() || undefined,
        existingFronts: (cards.data ?? []).map((c) => c.front),
      });
      const added = await api.cardsAdd(space.id, made.flatMap((c) => expandCloze(c)));
      invalidateCards(space.id);
      toast.success(s.cards.generated(added.length));
      onOpenChange(false);
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.cards.generateFailed, e, run);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.cards.generateTitle}
      className="w-[min(462px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy || !ready.length} onClick={run}>
            <Sparkles size={15} />
            {s.cards.generateTitle}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {!ready.length && <EmptyState title={s.sources.emptyTitle} body={s.sources.emptyBody} />}
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.cards.focus}</span>
          <Input id="gen-focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={s.cards.focusPlaceholder} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.cards.howMany}</span>
          <Segmented<"5" | "10" | "20">
            label={s.cards.howMany}
            value={count}
            onChange={setCount}
            block
            options={(["5", "10", "20"] as const).map((v) => ({ value: v, label: v }))}
          />
        </div>
        {busy && <GeneratingStatus label={s.cards.generating} className="text-muted" />}
      </div>
    </Dialog>
  );
}

/** Global add-card dialog; mounted once in the space screen. */
export function AddCardDialog({ space }: { space: Space }) {
  const req = useAddCard((st) => st.req);
  const close = useAddCard((st) => st.close);
  const open = req.open && (!req.spaceId || req.spaceId === space.id);
  const [kind, setKind] = useState<"basic" | "cloze">("basic");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [lastReq, setLastReq] = useState<AddCardRequest | null>(null);

  if (open && req !== lastReq) {
    setLastReq(req);
    setKind(req.kind === "cloze" ? "cloze" : "basic");
    setFront(req.front ?? "");
    setBack(req.back ?? "");
  }

  const valid = kind === "cloze" ? clozeNumbers(front).length > 0 : !!front.trim() && !!back.trim();

  const save = async () => {
    setBusy(true);
    try {
      const card: NewCard = { kind, front, back, sourceId: req.sourceId ?? null, chunkStart: req.chunkStart ?? null, chunkEnd: req.chunkEnd ?? null };
      await api.cardsAdd(space.id, expandCloze(card));
      invalidateCards(space.id);
      toast.success(s.cards.added);
      if (motionReduced()) close();
      else {
        setAdded(true);
        setTimeout(() => {
          close();
          setAdded(false);
        }, 1200);
      }
    } catch (e) {
      toastError(s.errors.generic, e, save);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={s.cards.addTitle}
      className="w-[min(482px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={!valid || busy || added} onClick={save}>
            <TextSwap text={added ? s.cards.added : s.cards.add} />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Segmented<"basic" | "cloze">
          label={s.cards.addTitle}
          value={kind}
          onChange={setKind}
          block
          options={(["basic", "cloze"] as const).map((v) => ({ value: v, label: s.cards.types[v] }))}
        />
        {kind === "basic" ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>{s.cards.front}</span>
              <Textarea id="card-front" className={AREA} value={front} onChange={(e) => setFront(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>{s.cards.back}</span>
              <Textarea id="card-back" className={AREA} value={back} onChange={(e) => setBack(e.target.value)} />
            </label>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="card-cloze" className={fieldLabel}>
                {s.cards.clozeText}
              </label>
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = ta.current;
                  if (el && el.selectionEnd > el.selectionStart) setFront(addGap(front, el.selectionStart, el.selectionEnd));
                }}
              >
                {s.cards.makeGap}
              </Button>
            </div>
            <Textarea id="card-cloze" ref={ta} rows={4} className={AREA} value={front} onChange={(e) => setFront(e.target.value)} />
            <p className="text-label text-muted">{s.cards.clozeHelp}</p>
            {clozeNumbers(front).length > 0 && (
              <p className="rounded-pane bg-fill-subtle px-3 py-2 text-input">{clozeFront(front, clozeNumbers(front)[0])}</p>
            )}
            <label className="mt-1.5 flex flex-col gap-1.5">
              <span className={fieldLabel}>{s.cards.backOptional}</span>
              <Input id="card-extra" value={back} onChange={(e) => setBack(e.target.value)} />
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const BROWSE_ROW = "group flex items-center gap-3 py-2.5 [&+&]:border-t [&+&]:border-divider";
const REVEAL = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100";

function BrowseCardsDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { data, isLoading } = useCards(space.id);
  const [editing, setEditing] = useState<Card[] | null>(null);
  const [q, setQ] = useState("");
  const groups = occlusionGroups(data ?? []);
  const plain = (data ?? []).filter((c) => c.kind !== "occlusion");
  const needle = q.trim().toLowerCase();
  const match = (text: string) => !needle || text.toLowerCase().includes(needle);
  const shownGroups = groups.filter((g) => match(g.map((c) => c.back).join(" ")));
  const shownPlain = plain.filter((c) => match(`${c.front} ${c.back}`));
  const order = new Map((data ?? []).map((c, i) => [c.id, i]));
  const items = [
    ...shownGroups.map((g) => ({ at: order.get(g[0].id) ?? 0, group: g, card: null as Card | null })),
    ...shownPlain.map((c) => ({ at: order.get(c.id) ?? 0, group: null as Card[] | null, card: c })),
  ].sort((a, b) => a.at - b.at);
  const listRef = useRef<HTMLUListElement>(null);
  useFlip(listRef, [data, q]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidateCards(space.id);
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };
  const meta = (c: Card, suspended: boolean) => (suspended ? s.cards.suspended : c.state === 0 ? s.review.new : dueLabel(c.due));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={s.cards.browseTitle}
      className="w-[min(622px,calc(100vw-32px))]"
      bodyClassName="px-0 pb-0 pt-1"
    >
      <div className="px-5 pb-2">
        <div className="relative">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.cards.browseSearch} aria-label={s.cards.browseSearch} className="pe-8" />
          <Search size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2" aria-hidden />
        </div>
      </div>
      {isLoading && <Skeleton className="mx-5 h-40" />}
      {!isLoading && needle && !shownGroups.length && !shownPlain.length && <p className="px-5 pb-4 text-muted">{s.cards.noMatch}</p>}
      <ul ref={listRef} className="relative px-5 pb-4" data-testid="card-browser">
        {items.map(({ group: g, card: c }) => {
          if (g) {
            const suspended = g.every((x) => x.suspended);
            return (
              <li key={g[0].id} data-flip-key={g[0].id} className={BROWSE_ROW} data-testid="occlusion-group">
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className={cn("truncate text-body-lg font-medium leading-[1.45] transition-colors duration-(--motion-fast)", suspended ? "text-muted" : "text-fg")}>{s.cards.imageGroup(g.length)}</span>
                  <span className="text-label text-muted">{meta(g[0], suspended)}</span>
                </div>
                <Button variant="ghost" size="sm" className={REVEAL} onClick={() => setEditing(g)}>
                  {s.common.edit}
                </Button>
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={suspended ? s.cards.unsuspend : s.cards.suspend}
                  title={suspended ? s.cards.unsuspend : s.cards.suspend}
                  onClick={() => act(() => Promise.all(g.map((x) => api.cardUpdate(x.id, { suspended: !suspended }))))}
                >
                  <span className="t-icon-swap" data-state={suspended ? "b" : "a"}>
                    <Pause size={15} data-icon="a" className="t-icon" />
                    <Play size={15} data-icon="b" className="t-icon" />
                  </span>
                </Button>
              </li>
            );
          }
          if (!c) return null;
          return (
            <li key={c.id} data-flip-key={c.id} className={BROWSE_ROW}>
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className={cn("truncate text-body-lg font-medium leading-[1.45] transition-colors duration-(--motion-fast)", c.suspended ? "text-muted" : "text-fg")}>
                  {c.kind === "cloze" ? clozeFront(c.front, c.data?.cloze ?? 1) : c.front || c.back}
                </span>
                <span className="text-label text-muted">{meta(c, c.suspended)}</span>
              </div>
              <Button
                variant="ghost-muted"
                size="icon-sm"
                className={REVEAL}
                aria-label={s.common.delete}
                title={s.common.delete}
                onClick={() => act(() => api.cardDelete(c.id))}
              >
                <Trash2 size={15} />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label={c.suspended ? s.cards.unsuspend : s.cards.suspend}
                title={c.suspended ? s.cards.unsuspend : s.cards.suspend}
                onClick={() => act(() => api.cardUpdate(c.id, { suspended: !c.suspended }))}
              >
                <span className="t-icon-swap" data-state={c.suspended ? "b" : "a"}>
                  <Pause size={15} data-icon="a" className="t-icon" />
                  <Play size={15} data-icon="b" className="t-icon" />
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {editing && <OcclusionEditor spaceId={space.id} open onOpenChange={(o) => !o && setEditing(null)} cards={editing} />}
    </Dialog>
  );
}
