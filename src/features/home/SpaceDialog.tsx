import { lazy, useEffect, useState } from "react";
import { Fx } from "../../components/fx/Fx";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/dialog";
const MetalButton = lazy(() => import("../../components/fx/MetalButton"));
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { SPACE_ICONS } from "../../lib/spaceStyle";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "../settings/NativeSelect";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { runPlacement } from "../../lib/placement/flows";
import { LanguageSelect } from "../space/LanguageSelect";
import { getLocale } from "../../lib/i18n/state";

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
  const [icon, setIcon] = useState(space?.icon ?? "calculator");
  const [busy, setBusy] = useState(false);
  const [curriculum, setCurriculum] = useState("");
  const [language, setLanguage] = useState<string | null>(space ? space.language : getLocale());
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);

  useEffect(() => {
    if (open) {
      setName(space?.name ?? "");
      setIcon(space?.icon ?? "calculator");
      setCurriculum("");
      setLanguage(space ? space.language : getLocale());
    }
  }, [open, space]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (space) {
        const updated = await api.updateSpace(space.id, { name, icon, language });
        qc.setQueryData(qk.space(space.id), updated);
        toast.success(s.space.saved);
      } else {
        const created = await api.createSpace({ name, icon, color: "slate", language });
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

  const createButton = (
    <Button variant="primary" className="px-4" disabled={!name.trim() || busy} onClick={submit}>
      {space ? s.common.save : s.common.create}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={space ? s.space.editTitle : s.space.createTitle}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          {space ? (
            createButton
          ) : (
            <Fx needsWebGL2 fallback={createButton} render={() => <MetalButton>{createButton}</MetalButton>} />
          )}
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
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
            <NativeSelect id="space-curriculum" value={curriculum} onChange={(e) => setCurriculum(e.target.value)}>
              <option value="">{s.space.noCurriculum}</option>
              {CURRICULA.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div>
          <Label htmlFor="space-language">{s.space.language}</Label>
          <LanguageSelect id="space-language" value={language} onChange={setLanguage} />
        </div>
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
                  "flex size-8.5 items-center justify-center rounded-pane border text-fg",
                  icon === key ? "border-fg bg-fill" : "border-border bg-transparent hover:bg-fill",
                )}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function SpaceDialogHost() {
  const open = useUi((st) => st.spaceDialogOpen);
  const setOpen = useUi((st) => st.setSpaceDialogOpen);
  return <SpaceDialog open={open} onOpenChange={setOpen} />;
}
