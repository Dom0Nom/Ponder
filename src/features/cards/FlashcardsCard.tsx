import { useRef, useState } from "react";
import { create } from "zustand";
import { GraduationCap, Layers, ListChecks, Pause, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards, useCards, useDueCounts, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Card, CardKind, NewCard, Space } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { resolveChatModel, NoModelError } from "../../lib/chat/llm";
import { generateCards, hitsToPassages } from "../../lib/srs/generate";
import { addGap, clozeFront, clozeNumbers, expandCloze } from "../../lib/srs/cloze";
import { quizSpace } from "../../lib/srs/quizSpace";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Textarea } from "../../components/ui/input";
import { EmptyState, Segmented, Skeleton, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { OcclusionButtonSlot } from "./occlusionSlot";
import { OcclusionEditor } from "./OcclusionEditor";
import { OcclusionCardView } from "./OcclusionCardView";
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

const BTN = "min-w-[7.5rem] flex-1 whitespace-nowrap";

export function FlashcardsCard({ space }: { space: Space }) {
  const counts = useDueCounts();
  const navigate = useUi((st) => st.navigate);
  const openAdd = useAddCard((st) => st.open);
  const [generating, setGenerating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [quizzing, setQuizzing] = useState(false);
  const c = counts.data?.find((x) => x.spaceId === space.id);

  const quiz = async () => {
    setQuizzing(true);
    try {
      const r = await quizSpace(space);
      if (r) toast.success(s.cards.quizResult(r.score, r.mistakes));
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.errors.generic, e);
    } finally {
      setQuizzing(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4" data-testid="flashcards-card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Layers size={15} className="text-muted" /> {s.cards.title}
      </h3>
      {counts.isLoading ? (
        <Skeleton className="h-4 w-40" />
      ) : (
        <p className="text-xs text-muted" data-testid="card-counts">
          {c ? s.cards.counts(c.due, c.new, c.total) : s.cards.none}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="card-actions">
        <Button
          size="sm"
          className={BTN}
          variant={c && c.due + c.new > 0 ? "primary" : "secondary"}
          disabled={!c?.total}
          onClick={() => navigate({ name: "review", spaceId: space.id })}
        >
          <GraduationCap size={15} /> {s.cards.review}
        </Button>
        <Button size="sm" variant="secondary" className={BTN} disabled={quizzing} onClick={quiz}>
          {quizzing ? <Spinner size={14} /> : <ListChecks size={15} />} {s.cards.quiz}
        </Button>
        <Button size="sm" variant="secondary" className={cn(BTN, "basis-full")} onClick={() => setGenerating(true)}>
          <Sparkles size={15} /> {s.cards.generate}
        </Button>
        <Button size="sm" variant="ghost" className={BTN} onClick={() => openAdd({ spaceId: space.id })}>
          <Plus size={15} /> {s.cards.add}
        </Button>
        <OcclusionButtonSlot spaceId={space.id} className={BTN} />
      </div>
      <div className="mt-2 flex gap-3 text-xs">
        {c?.total ? (
          <button className="font-medium text-accent-text hover:underline" onClick={() => setBrowsing(true)}>
            {s.cards.browse}
          </button>
        ) : null}
        <button className="font-medium text-accent-text hover:underline" onClick={() => navigate({ name: "review", spaceId: space.id, tab: "mistakes" })}>
          {s.cards.mistakes}
        </button>
      </div>
      <GenerateCardsDialog space={space} open={generating} onOpenChange={setGenerating} />
      {browsing && <BrowseCardsDialog space={space} onClose={() => setBrowsing(false)} />}
    </div>
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
      description={s.cards.generateBody}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy || !ready.length} onClick={run}>
            {busy && <Spinner size={15} className="text-on-accent" />} {busy ? s.cards.generating : s.cards.generate}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {!ready.length && <EmptyState title={s.sources.emptyTitle} body={s.sources.emptyBody} />}
        <div>
          <Label htmlFor="gen-focus">{s.cards.focus}</Label>
          <Input id="gen-focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={s.cards.focusPlaceholder} />
        </div>
        <div>
          <Label>{s.cards.howMany}</Label>
          <Segmented<"5" | "10" | "20">
            label={s.cards.howMany}
            value={count}
            onChange={setCount}
            options={(["5", "10", "20"] as const).map((v) => ({ value: v, label: v }))}
          />
        </div>
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
      close();
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
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={save}>
            {s.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Segmented<"basic" | "cloze">
          label={s.cards.addTitle}
          value={kind}
          onChange={setKind}
          options={(["basic", "cloze"] as const).map((v) => ({ value: v, label: s.cards.types[v] }))}
        />
        {kind === "basic" ? (
          <>
            <div>
              <Label htmlFor="card-front">{s.cards.front}</Label>
              <Textarea id="card-front" rows={3} value={front} onChange={(e) => setFront(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="card-back">{s.cards.back}</Label>
              <Textarea id="card-back" rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-end justify-between">
              <Label htmlFor="card-cloze">{s.cards.clozeText}</Label>
              <Button
                size="sm"
                variant="tonal"
                className="mb-1.5"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = ta.current;
                  if (el && el.selectionEnd > el.selectionStart) setFront(addGap(front, el.selectionStart, el.selectionEnd));
                }}
              >
                {s.cards.makeGap}
              </Button>
            </div>
            <Textarea id="card-cloze" ref={ta} rows={4} value={front} onChange={(e) => setFront(e.target.value)} />
            <p className="mt-1.5 text-xs text-muted">{s.cards.clozeHelp}</p>
            {clozeNumbers(front).length > 0 && (
              <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">{clozeFront(front, clozeNumbers(front)[0])}</p>
            )}
            <div className="mt-3">
              <Label htmlFor="card-extra">{s.cards.back} (optional)</Label>
              <Input id="card-extra" value={back} onChange={(e) => setBack(e.target.value)} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function BrowseCardsDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const { data, isLoading } = useCards(space.id);
  const [editing, setEditing] = useState<Card[] | null>(null);
  const groups = occlusionGroups(data ?? []);
  const plain = (data ?? []).filter((c) => c.kind !== "occlusion");
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidateCards(space.id);
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={s.cards.browseTitle} className="w-[min(720px,calc(100vw-32px))]">
      {isLoading && <Skeleton className="h-40" />}
      <ul className="divide-y divide-border pb-3" data-testid="card-browser">
        {groups.map((g) => (
          <li key={g[0].id} className="flex items-center gap-3 py-2.5" data-testid="occlusion-group">
            <OcclusionCardView card={g[0]} revealed className="w-24 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{g.map((c) => c.back).filter(Boolean).join(", ") || s.occlusion.title}</p>
              <p className="mt-0.5 text-[0.6875rem] text-faint">{s.cards.imageGroup(g.length)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
              {s.common.edit}
            </Button>
          </li>
        ))}
        {plain.map((c: Card) => (
          <li key={c.id} className={cn("flex items-start gap-3 py-2.5", c.suspended && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm">{c.kind === "cloze" ? clozeFront(c.front, c.data?.cloze ?? 1) : c.front || c.back}</p>
              <p className="mt-0.5 text-[0.6875rem] text-faint">
                {[c.kind, c.origin, c.suspended ? s.cards.suspended : c.state === 0 ? s.review.new : s.cards.due(relativeTime(c.due))].join(" · ")}
              </p>
            </div>
            <button
              aria-label={c.suspended ? s.cards.unsuspend : s.cards.suspend}
              title={c.suspended ? s.cards.unsuspend : s.cards.suspend}
              onClick={() => act(() => api.cardUpdate(c.id, { suspended: !c.suspended }))}
              className="rounded-full p-1.5 text-muted hover:bg-surface-2"
            >
              {c.suspended ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button aria-label={s.common.delete} onClick={() => act(() => api.cardDelete(c.id))} className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {editing && <OcclusionEditor spaceId={space.id} open onOpenChange={(o) => !o && setEditing(null)} cards={editing} />}
    </Dialog>
  );
}
