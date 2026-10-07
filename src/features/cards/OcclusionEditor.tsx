import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Plus, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Card, NewCard, OcclusionMask } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  HANDLES,
  cleanMasks,
  handleAt,
  isBigEnough,
  maskAt,
  moveRect,
  normalizeRect,
  rectFromPoints,
  resizeRect,
  type Handle,
  type Point,
  type Rect,
} from "../../lib/srs/occlusion";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { fieldLabel, Input } from "../../components/ui/input";
import { Reveal } from "../../components/motion/Reveal";
import { TextSwap } from "../../components/motion/TextSwap";
import { useFlip } from "../../lib/useFlip";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { EmptyState, ErrorState, Segmented, Skeleton, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { useImageUrl } from "./OcclusionCardView";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

type Mode = "one" | "all";

/**
 * Creates image-occlusion cards for a space (one card per box), or edits an existing group
 * when `cards` holds the occlusion cards that share one image.
 */
export function OcclusionEditor({
  spaceId,
  open,
  onOpenChange,
  cards,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards?: Card[];
}) {
  const editing = !!cards?.length;
  const [image, setImage] = useState<string | null>(null);
  const [masks, setMasks] = useState<OcclusionMask[]>([]);
  const [mode, setMode] = useState<Mode>("one");
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const groupKey = cards?.map((c) => c.id).join(",") ?? "";
  useEffect(() => {
    if (!open) return;
    const first = cardsRef.current?.[0]?.data;
    setImage(first?.image ?? null);
    setMasks(first?.masks ?? []);
    setMode(first?.hideAll ? "all" : "one");
    setSelected(null);
  }, [open, groupKey]);

  const pickImage = async () => {
    setPicking(true);
    try {
      const res = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: s.occlusion.imageFilter, extensions: IMAGE_EXTENSIONS }],
      });
      const path = Array.isArray(res) ? res[0] : res;
      if (path) setImage(await api.imageStore(path));
    } catch (e) {
      toastError(s.occlusion.pickFailed, e, pickImage);
    } finally {
      setPicking(false);
    }
  };

  const addMask = () => {
    const m: OcclusionMask = { id: crypto.randomUUID(), x: 0.4, y: 0.4, w: 0.2, h: 0.12 };
    setMasks((ms) => [...ms, m]);
    setSelected(m.id);
  };

  const save = async () => {
    if (!image || !masks.length) return;
    setSaving(true);
    try {
      const clean = cleanMasks(masks).map((m) => ({ ...m, ...normalizeRect(m) }));
      const hideAll = mode === "all";
      const toNew = (m: OcclusionMask): NewCard => ({
        kind: "occlusion",
        front: "",
        back: m.label ?? "",
        data: { image, masks: clean, mask: m.id, hideAll },
      });
      if (!editing) {
        await api.cardsAdd(spaceId, clean.map(toNew));
        toast.success(s.occlusion.saved(clean.length));
      } else {
        const byMask = new Map(cards!.map((c) => [c.data?.mask, c]));
        const keep = new Set(clean.map((m) => m.id));
        const added = clean.filter((m) => !byMask.has(m.id));
        await Promise.all(
          clean
            .filter((m) => byMask.has(m.id))
            .map((m) => {
              const { front, back, data } = toNew(m);
              return api.cardUpdate(byMask.get(m.id)!.id, { front, back, data: data ?? undefined });
            }),
        );
        if (added.length) await api.cardsAdd(spaceId, added.map(toNew));
        await Promise.all(cards!.filter((c) => !c.data?.mask || !keep.has(c.data.mask)).map((c) => api.cardDelete(c.id)));
        toast.success(s.occlusion.updated);
      }
      onOpenChange(false);
    } catch (e) {
      toastError(s.occlusion.saveFailed, e, save);
    } finally {
      invalidateCards(spaceId);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? s.occlusion.editTitle : s.occlusion.title}
      description={s.occlusion.description}
      className="max-h-[min(720px,92vh)] w-[min(862px,calc(100vw-32px))]"
      footer={
        <>
          {!editing && image && (
            <Button variant="secondary" onClick={pickImage} disabled={picking}>
              {s.occlusion.replaceImage}
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={!image || !masks.length || saving}>
            {saving && <Spinner size={14} className="text-on-primary" />}
            <TextSwap text={editing ? s.common.save : s.occlusion.saveN(masks.length)} />
          </Button>
        </>
      }
    >
      <span id="occlusion-hint" className="sr-only">
        {s.occlusion.drawHint}
      </span>
      <div className="flex min-h-0 gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="relative box-content flex h-[360px] items-center justify-center overflow-hidden rounded-pane border border-border bg-fill">
            {!image ? (
              <EmptyState
                icon={<ImagePlus size={20} />}
                title={s.occlusion.noImage}
                body={s.occlusion.noImageBody}
                action={
                  <Button variant="primary" onClick={pickImage} disabled={picking}>
                    {picking && <Spinner size={14} className="text-on-primary" />}
                    {s.occlusion.chooseImage}
                  </Button>
                }
              />
            ) : (
              <MaskStage image={image} masks={masks} setMasks={setMasks} selected={selected} setSelected={setSelected} />
            )}
          </div>
        </div>
        {image && (
          <div className="flex w-[250px] flex-none flex-col gap-3">
            <span className={fieldLabel}>{s.occlusion.mode}</span>
            <Segmented
              label={s.occlusion.mode}
              value={mode}
              onChange={setMode}
              block
              options={[
                { value: "one", label: s.occlusion.hideOne, title: s.occlusion.hideOneHint },
                { value: "all", label: s.occlusion.hideAll, title: s.occlusion.hideAllHint },
              ]}
            />
            <span className={fieldLabel}>{s.occlusion.masks}</span>
            <MaskList masks={masks} setMasks={setMasks} selected={selected} setSelected={setSelected} />
            <span className="-ml-[9px]">
              <Button variant="ghost" size="sm" onClick={addMask}>
                <Plus size={14} />
                {s.occlusion.addMask}
              </Button>
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

type Drag =
  | { kind: "create"; id: string; start: Point }
  | { kind: "move"; id: string; start: Point; orig: Rect }
  | { kind: "resize"; id: string; start: Point; orig: Rect; handle: Handle };

const CURSORS: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
};

function MaskStage({
  image,
  masks,
  setMasks,
  selected,
  setSelected,
}: {
  image: string;
  masks: OcclusionMask[];
  setMasks: Dispatch<SetStateAction<OcclusionMask[]>>;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const { url, error, loading, retry } = useImageUrl(image);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const pointAt = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      p: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height },
      tol: { x: 8 / r.width, y: 8 / r.height },
    };
  };
  const patch = (id: string, rect: Rect) => setMasks((ms) => ms.map((m) => (m.id === id ? { ...m, ...rect } : m)));
  const remove = (id: string) => setMasks((ms) => ms.filter((m) => m.id !== id));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current!.focus();
    const { p, tol } = pointAt(e);
    const sel = masks.find((m) => m.id === selected);
    const handle = sel ? handleAt(sel, p, tol) : null;
    const hit = maskAt(masks, p);
    if (sel && handle) drag.current = { kind: "resize", id: sel.id, start: p, orig: sel, handle };
    else if (hit) {
      drag.current = { kind: "move", id: hit.id, start: p, orig: hit };
      setSelected(hit.id);
    } else {
      const id = crypto.randomUUID();
      setMasks((ms) => [...ms, { id, ...rectFromPoints(p, p) }]);
      setSelected(id);
      drag.current = { kind: "create", id, start: p };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const { p, tol } = pointAt(e);
    const d = drag.current;
    if (!d) {
      const sel = masks.find((m) => m.id === selected);
      const handle = sel ? handleAt(sel, p, tol) : null;
      setCursor(handle ? CURSORS[handle] : maskAt(masks, p) ? "move" : "crosshair");
      return;
    }
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === "create") patch(d.id, rectFromPoints(d.start, p));
    else if (d.kind === "move") patch(d.id, moveRect(d.orig, dx, dy));
    else patch(d.id, resizeRect(d.orig, d.handle, dx, dy));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.kind !== "create") return;
    const rect = rectFromPoints(d.start, pointAt(e).p);
    if (!isBigEnough(rect)) {
      remove(d.id);
      setSelected(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const sel = masks.find((m) => m.id === selected);
    if (!sel) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(sel.id);
      setSelected(null);
      return;
    }
    const step = e.shiftKey ? 0.05 : 0.01;
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const v = dir[e.key];
    if (!v) return;
    e.preventDefault();
    patch(sel.id, e.altKey ? resizeRect(sel, "se", v[0], v[1]) : moveRect(sel, v[0], v[1]));
  };

  if (error) return <ErrorState title={s.occlusion.imageFailed} error={error} onRetry={retry} />;
  if (loading || !url) return <Skeleton className="size-full" />;

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={s.occlusion.stage}
      aria-describedby="occlusion-hint"
      title={s.occlusion.drawHint}
      data-testid="occlusion-stage"
      className="group relative inline-block max-w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <img src={url} alt="" draggable={false} className="pointer-events-none block max-h-[358px] max-w-full" />
      {masks.map((m) => {
        const active = m.id === selected;
        return (
          <div
            key={m.id}
            data-testid="occlusion-mask"
            aria-hidden
            className={cn(
              "pointer-events-none absolute rounded-kbd border-2",
              active ? "border-fg bg-mask-active" : "border-faint bg-mask",
            )}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
          >
            {active &&
              HANDLES.map((h) => (
                <span
                  key={h}
                  className="absolute hidden size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-fg bg-surface group-hover:block group-focus:block"
                  style={{ left: `${HANDLE_POS[h][0]}%`, top: `${HANDLE_POS[h][1]}%` }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function MaskList({
  masks,
  setMasks,
  selected,
  setSelected,
}: {
  masks: OcclusionMask[];
  setMasks: Dispatch<SetStateAction<OcclusionMask[]>>;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const isFresh = useFreshKeys(masks.map((m) => m.id));
  useFlip(listRef, [masks.length]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!masks.length && <p className="text-body text-muted">{s.occlusion.noMasks}</p>}
      <ul ref={listRef} className="relative flex flex-col gap-3">
        {masks.map((m, i) => (
          <Reveal as="li" key={m.id} active={isFresh(m.id)} data-flip-key={m.id} className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={m.id === selected}
              aria-label={s.occlusion.mask(i + 1)}
              onClick={() => setSelected(m.id)}
              className="w-[42px] text-left text-label text-muted"
            >
              {s.occlusion.mask(i + 1)}
            </button>
            <Input
              aria-label={s.occlusion.maskLabel(i + 1)}
              placeholder={s.occlusion.labelPlaceholder}
              value={m.label ?? ""}
              onFocus={() => setSelected(m.id)}
              onChange={(e) => {
                const label = e.target.value;
                setMasks((ms) => ms.map((x) => (x.id === m.id ? { ...x, label } : x)));
              }}
              className="min-w-0 flex-1"
            />
            <Button
              size="icon-sm"
              variant="ghost-muted"
              title={s.occlusion.removeMask(i + 1)}
              aria-label={s.occlusion.removeMask(i + 1)}
              onClick={() => {
                setMasks((ms) => ms.filter((x) => x.id !== m.id));
                if (selected === m.id) setSelected(null);
              }}
            >
              <X size={15} />
            </Button>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}
