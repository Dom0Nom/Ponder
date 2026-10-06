import { Segmented, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, TutorStyle } from "../../lib/types";
import { ModelPicker } from "../settings/ModelPicker";

export function SpaceSettingsCard({ space }: { space: Space }) {
  const update = useUpdateSpace();
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: space.id, patch: p }, { onError: (e) => toastError(s.errors.generic, e) });

  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4">
      <h3 className="mb-3 text-sm font-medium">{s.space.editTitle}</h3>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">{s.space.tutorStyle}</p>
          <Segmented<TutorStyle>
            size="sm"
            label={s.space.tutorStyle}
            value={space.tutorStyle}
            onChange={(v) => patch({ tutorStyle: v })}
            options={(["direct", "socratic", "mixed"] as const).map((v) => ({
              value: v,
              label: s.space.tutorStyles[v],
              title: s.space.tutorStyleHelp[v],
            }))}
          />
          <p className="mt-1.5 text-xs text-muted">{s.space.tutorStyleHelp[space.tutorStyle]}</p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.8125rem] font-medium">{s.space.strict}</p>
            <p className="text-xs text-muted">{s.space.strictHelp}</p>
          </div>
          <Switch
            label={s.space.strict}
            checked={space.strictGrounding}
            onCheckedChange={(v) => patch({ strictGrounding: v })}
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">{s.space.model}</p>
          <ModelPicker
            value={space.modelOverride}
            allowDefault
            onChange={(v) => patch({ modelOverride: v })}
          />
        </div>
      </div>
    </div>
  );
}
