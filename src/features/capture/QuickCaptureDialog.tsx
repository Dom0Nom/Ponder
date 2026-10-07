import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { captureTitle } from "../../lib/capture/shortcut";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Label, Textarea } from "../../components/ui/input";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { NativeSelect } from "../settings/NativeSelect";

/** Space shown in the app right now, else the most recently opened one. */
export function defaultCaptureSpace(spaces: Space[], currentSpaceId: string | null): string | null {
  if (currentSpaceId && spaces.some((sp) => sp.id === currentSpaceId)) return currentSpaceId;
  const sorted = [...spaces].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.updatedAt - a.updatedAt);
  return sorted[0]?.id ?? null;
}

export function QuickCaptureDialog() {
  const open = useUi((st) => st.captureOpen);
  const setOpen = useUi((st) => st.setCaptureOpen);
  const route = useUi((st) => st.route);
  const { data: spaces, isLoading, error, refetch } = useSpaces();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentSpace = route.name === "space" ? route.spaceId : null;
  useEffect(() => {
    setSpaceId(null);
    if (!open) return;
    let cancelled = false;
    // lastOpenedAt in the cached list may be stale
    refetch().then((r) => {
      if (!cancelled && r.data) setSpaceId((cur) => cur ?? defaultCaptureSpace(r.data, currentSpace));
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentSpace, refetch]);

  const canSave = !!spaceId && text.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave || !spaceId) return;
    setSaving(true);
    try {
      const kind = /^#{1,6} |\n#{1,6} |\*\*|\[.+\]\(.+\)/.test(text) ? "markdown" : "text";
      await api.importText(spaceId, captureTitle(text), text, kind, "quick-capture");
      qc.invalidateQueries({ queryKey: qk.sources(spaceId) });
      qc.invalidateQueries({ queryKey: qk.spaces });
      toast.success(s.capture.saved(spaces?.find((sp) => sp.id === spaceId)?.name ?? ""));
      setText("");
      setOpen(false);
    } catch (e) {
      toastError(s.capture.failed, e, save);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={s.capture.title}
      className="w-[min(480px,calc(100vw-32px))]"
      bodyClassName="pb-4"
      footer={
        <>
          <span className="mr-auto text-caption text-muted">{s.capture.hint}</span>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            {saving ? s.sources.importing : s.capture.save}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-3.5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <Textarea
          autoFocus
          aria-label={s.capture.title}
          placeholder={s.capture.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-[7.5rem] resize-none"
        />
        <div>
          <Label htmlFor="capture-space">{s.capture.space}</Label>
          {isLoading && <Skeleton className="h-9" />}
          {error && <ErrorState className="py-3" title={s.home.loadError} error={error} onRetry={() => refetch()} />}
          {spaces && spaces.length === 0 && <p className="text-body text-muted">{s.capture.noSpaces}</p>}
          {spaces && spaces.length > 0 && (
            <NativeSelect id="capture-space" value={spaceId ?? ""} onChange={(e) => setSpaceId(e.target.value)}>
              {spaces.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      </div>
    </Dialog>
  );
}
