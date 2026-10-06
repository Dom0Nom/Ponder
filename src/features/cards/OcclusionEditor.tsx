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
import { Input } from "../../components/ui/input";
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
      className="max-h-[92vh] w-[min(1000px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" onClick={save} disabled={!image || !masks.length || saving}>
            {saving && <Spinner size={14} className="text-on-accent" />}
            {editing ? s.common.save : s.occlusion.saveN(masks.length)}
          </Button>
        </>
      }
    >
      {!image ? (
        <EmptyState
          icon={<ImagePlus size={20} />}
          title={s.occlusion.noImage}
          body={s.occlusion.noImageBody}
          action={
            <Button variant="primary" onClick={pickImage} disabled={picking}>
              {picking ? <Spinner size={14} className="text-on-accent" /> : <ImagePlus size={16} />}
              {s.occlusion.chooseImage}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={s.occlusion.mode}
              value={mode}
              onChange={setMode}
              size="sm"
              options={[
                { value: "one", label: s.occlusion.hideOne, title: s.occlusion.hideOneHint },
                { value: "all", label: s.occlusion.hideAll, title: s.occlusion.hideAllHint },
              ]}
            />
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={addMask}>
              <Plus size={14} />
              {s.occlusion.addMask}
            </Button>
            {!editing && (
              <Button size="sm" variant="ghost" onClick={pickImage} disabled={picking}>
                {picking ? <Spinner size={14} /> : <ImagePlus size={14} />}
                {s.occlusion.replaceImage}
              </Button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="flex min-w-0 flex-col items-center gap-2">
              <MaskStage image={image} masks={masks} setMasks={setMasks} selected={selected} setSelected={setSelected} />
              <p id="occlusion-hint" className="text-center text-xs text-muted">
                {s.occlusion.drawHint}
              </p>
            </div>
            <MaskList masks={masks} setMasks={setMasks} selected={selected} setSelected={setSelected} />
          </div>
        </div>
      )}
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
  if (loading || !url) return <Skeleton className="aspect-[4/3] w-full rounded-xl" />;

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={s.occlusion.stage}
      aria-describedby="occlusion-hint"
      data-testid="occlusion-stage"
      className="relative inline-block max-w-full touch-none select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <img src={url} alt="" draggable={false} className="pointer-events-none block max-h-[55vh] max-w-full rounded-xl" />
      {masks.map((m, i) => {
        const active = m.id === selected;
        return (
          <div
            key={m.id}
            data-testid="occlusion-mask"
            aria-hidden
            className={cn(
              "pointer-events-none absolute rounded-md border-2 border-accent",
              active ? "bg-accent/85 shadow-lg" : "bg-accent/60",
            )}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
          >
            <span className="absolute left-1 top-0.5 max-w-[calc(100%-8px)] truncate text-[0.6875rem] font-semibold text-on-accent">
              {m.label?.trim() || i + 1}
            </span>
            {active &&
              HANDLES.map((h) => (
                <span
                  key={h}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-surface"
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
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-[0.8125rem] font-medium text-muted">{s.occlusion.masks}</p>
      {!masks.length && <p className="text-sm text-faint">{s.occlusion.noMasks}</p>}
      <ul className="flex flex-col gap-1.5">
        {masks.map((m, i) => (
          <li
            key={m.id}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border p-1.5 transition-colors",
              m.id === selected ? "border-accent bg-accent-soft" : "border-border",
            )}
          >
            <button
              type="button"
              aria-pressed={m.id === selected}
              aria-label={s.occlusion.mask(i + 1)}
              onClick={() => setSelected(m.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent"
            >
              {i + 1}
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
              className="h-8 min-w-0 flex-1"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={s.occlusion.removeMask(i + 1)}
              onClick={() => {
                setMasks((ms) => ms.filter((x) => x.id !== m.id));
                if (selected === m.id) setSelected(null);
              }}
            >
              <X size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
