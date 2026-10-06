import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { SPACE_COLORS, SPACE_ICONS } from "../../lib/spaceStyle";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { runPlacement } from "../../lib/placement/flows";

export function SpaceDialog({
  open,
  onOpenChange,
  space,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  space?: Space;
}) {
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "book");
  const [color, setColor] = useState(space?.color ?? "blue");
  const [busy, setBusy] = useState(false);
  const [curriculum, setCurriculum] = useState("");
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);

  useEffect(() => {
    if (open) {
      setName(space?.name ?? "");
      setIcon(space?.icon ?? "book");
      setColor(space?.color ?? "blue");
      setCurriculum("");
    }
  }, [open, space]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (space) {
        const updated = await api.updateSpace(space.id, { name, icon, color });
        qc.setQueryData(qk.space(space.id), updated);
        toast.success(s.space.saved);
      } else {
        const created = await api.createSpace({ name, icon, color });
        navigate({ name: "space", spaceId: created.id });
        const cur = curriculumById(curriculum);
        if (cur) {
          const sc = await api.curriculumSet(created.id, cur.id, cur.title, cur.topics);
          toast.success(s.space.created, {
            description: s.plan.placementPrompt,
            duration: 15000,
            action: {
              label: s.plan.placement,
              onClick: () => runPlacement(created, sc).catch((e) => toastError(s.errors.generic, e)),
            },
          });
        } else toast.success(s.space.created);
      }
      qc.invalidateQueries({ queryKey: qk.spaces });
      onOpenChange(false);
    } catch (e) {
      toastError(s.errors.generic, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={space ? s.space.editTitle : s.space.createTitle}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>
            {space ? s.common.save : s.common.create}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5 pb-2"
      >
        <div>
          <Label htmlFor="space-name">{s.space.nameLabel}</Label>
          <Input
            id="space-name"
            autoFocus
            value={name}
            maxLength={80}
            placeholder={s.space.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {!space && (
          <div>
            <Label htmlFor="space-curriculum">{s.space.curriculum}</Label>
            <select
              id="space-curriculum"
              value={curriculum}
              onChange={(e) => setCurriculum(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
            >
              <option value="">{s.space.noCurriculum}</option>
              {CURRICULA.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label>{s.space.icon}</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={s.space.icon}>
            {Object.entries(SPACE_ICONS).map(([key, Icon]) => (
              <button
                type="button"
                key={key}
                role="radio"
                aria-checked={icon === key}
                aria-label={key}
                onClick={() => setIcon(key)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2",
                  icon === key && "bg-accent-soft text-accent-text hover:bg-accent-soft",
                )}
              >
                <Icon size={19} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>{s.space.color}</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={s.space.color}>
            {Object.entries(SPACE_COLORS).map(([key, c]) => (
              <button
                type="button"
                key={key}
                role="radio"
                aria-checked={color === key}
                aria-label={key}
                onClick={() => setColor(key)}
                className={cn(
                  "h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition-shadow",
                  color === key && "ring-2 ring-accent",
                )}
                style={{ background: c[1] }}
              />
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
