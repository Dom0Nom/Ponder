import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { TextSwap } from "../../components/motion/TextSwap";
import { motionReduced } from "../../app/useTheme";
import { Segmented, Switch, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { CURRICULA, curriculumById } from "../../lib/placement/curricula";
import { qk, useCurriculum, useDeleteSpace, useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Space, TutorStyle } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { ModelPicker } from "../settings/ModelPicker";
import { NativeSelect } from "../settings/NativeSelect";

interface Draft {
  name: string;
  curriculumId: string;
  tutorStyle: TutorStyle;
  strictGrounding: boolean;
  modelOverride: ModelRef | null;
}

const sameModel = (a: ModelRef | null, b: ModelRef | null) => a?.providerId === b?.providerId && a?.model === b?.model;

export function SpaceSettingsPanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const update = useUpdateSpace();
  const deleteSpace = useDeleteSpace();
  const { data: cur } = useCurriculum(space.id);
  const curriculumId = cur?.curriculumId ?? "";
  const initial: Draft = {
    name: space.name,
    curriculumId,
    tutorStyle: space.tutorStyle,
    strictGrounding: space.strictGrounding,
    modelOverride: space.modelOverride,
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDraft({
      name: space.name,
      curriculumId,
      tutorStyle: space.tutorStyle,
      strictGrounding: space.strictGrounding,
      modelOverride: space.modelOverride,
    });
  }, [space.id, curriculumId]);

  const dirty =
    draft.name !== initial.name ||
    draft.curriculumId !== initial.curriculumId ||
    draft.tutorStyle !== initial.tutorStyle ||
    draft.strictGrounding !== initial.strictGrounding ||
    !sameModel(draft.modelOverride, initial.modelOverride);

  const save = async () => {
    setSaving(true);
    try {
      await update.mutateAsync({
        id: space.id,
        patch: {
          name: draft.name.trim(),
          tutorStyle: draft.tutorStyle,
          strictGrounding: draft.strictGrounding,
          modelOverride: draft.modelOverride,
        },
      });
      if (draft.curriculumId !== curriculumId) {
        const next = curriculumById(draft.curriculumId);
        if (next) await api.curriculumSet(space.id, next.id, next.title, next.topics);
        else await api.curriculumClear(space.id);
        for (const k of [qk.curriculum(space.id), qk.levels(space.id), qk.coverage(space.id), qk.spaces])
          qc.invalidateQueries({ queryKey: k });
      }
      toast.success(s.space.saved);
      if (motionReduced()) onBack();
      else {
        setJustSaved(true);
        setTimeout(onBack, 1200);
      }
    } catch (e) {
      toastError(s.errors.generic, e, save);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteSpace(space.id);
      navigate({ name: "home" });
    } catch (e) {
      toastError(s.errors.generic, e, remove);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-divider px-2.5">
        <Tooltip content={s.space.backToStudio}>
          <Button variant="ghost-muted" size="icon-sm" aria-label={s.space.backToStudio} onClick={onBack}>
            <ArrowLeft size={15} />
          </Button>
        </Tooltip>
        <h2 className="text-input font-semibold">{s.space.editTitle}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        <div>
          <Label htmlFor="space-settings-name">{s.space.nameLabel}</Label>
          <Input
            id="space-settings-name"
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="space-settings-curriculum">{s.space.curriculum}</Label>
          <NativeSelect
            id="space-settings-curriculum"
            value={draft.curriculumId}
            onChange={(e) => setDraft({ ...draft, curriculumId: e.target.value })}
          >
            <option value="">{s.space.noCurriculum}</option>
            {CURRICULA.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="mb-0">{s.space.tutorStyle}</Label>
          <Segmented<TutorStyle>
            block
            label={s.space.tutorStyle}
            value={draft.tutorStyle}
            onChange={(v) => setDraft({ ...draft, tutorStyle: v })}
            options={(["direct", "socratic", "mixed"] as const).map((v) => ({ value: v, label: s.space.tutorStyles[v] }))}
          />
          <p className="text-caption text-muted">{s.space.tutorStyleSettingsHelp[draft.tutorStyle]}</p>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-body-lg font-medium leading-[1.45]">{s.space.strict}</span>
            <span className="text-caption text-muted">{s.space.strictHelp}</span>
          </div>
          <Switch
            label={s.space.strict}
            checked={draft.strictGrounding}
            onCheckedChange={(v) => setDraft({ ...draft, strictGrounding: v })}
          />
        </div>
        <div>
          <Label>{s.space.model}</Label>
          <ModelPicker value={draft.modelOverride} allowDefault onChange={(v) => setDraft({ ...draft, modelOverride: v })} />
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-divider px-4 py-3">
        <span className="me-auto">
          <Button variant="secondary" className="text-danger" onClick={() => setDeleting(true)}>
            <Trash2 size={15} />
            {s.space.deleteSpace}
          </Button>
        </span>
        <Button variant="primary" disabled={!dirty || !draft.name.trim() || saving || justSaved} onClick={save}>
          <TextSwap text={justSaved ? s.common.saved : s.common.save} />
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={s.space.deleteTitle(space.name)}
        body={s.space.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={remove}
      />
    </div>
  );
}
