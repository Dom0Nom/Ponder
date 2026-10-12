import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, fieldLabel } from "../../components/ui/input";
import { ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { AUDIO_STYLES, OUTPUT_KINDS, type AudioStyle } from "../../lib/studio/kinds";
import type { Space } from "../../lib/types";
import { dayLabel } from "../../lib/utils";
import { qkOutputs, useOutputJobs } from "../../stores/outputJobs";
import { useUi } from "../../stores/ui";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { KIND_ICON } from "./kindIcons";

export function CreatePanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const navigate = useUi((st) => st.navigate);
  const job = useOutputJobs((st) => st.jobs[space.id]);
  const error = useOutputJobs((st) => st.errors[space.id]);
  const { start, cancel, clearError } = useOutputJobs.getState();
  const [focus, setFocus] = useState("");
  const [last, setLast] = useState<{ kind: (typeof OUTPUT_KINDS)[number]; style?: AudioStyle } | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const saved = useQuery({ queryKey: qkOutputs(space.id), queryFn: () => api.outputsList(space.id) });

  const run = (kind: (typeof OUTPUT_KINDS)[number], style?: AudioStyle) => {
    setLast({ kind, style });
    setAudioOpen(false);
    void start(space, kind, focus, undefined, style);
  };

  return (
    <StudioSubpanel title={s.outputs.title} onBack={onBack} testId="create-panel">
      <p className="text-body text-fg-secondary">{s.outputs.pick}</p>
      <label className="flex flex-col gap-1.5">
        <span className={fieldLabel}>{s.outputs.focusLabel}</span>
        <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={s.outputs.focusPlaceholder} disabled={!!job} />
      </label>
      {job ? (
        <div className="flex items-center gap-3 rounded-card border border-border px-3.5 py-3" data-testid="create-running" aria-live="polite">
          <Spinner />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{s.outputs.creating(s.outputs.kinds[job.kind].name)}</span>
            <span className="text-label text-muted">{s.outputs.creatingNote}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => cancel(space.id)}>
            {s.outputs.cancel}
          </Button>
        </div>
      ) : error ? (
        <ErrorState
          size="sm"
          title={s.outputs.failed}
          error={error}
          onRetry={
            last
              ? () => {
                  clearError(space.id);
                  run(last.kind, last.style);
                }
              : undefined
          }
        />
      ) : null}
      <ul className="flex flex-col" role="list" aria-label={s.outputs.title}>
        {OUTPUT_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <li key={k} className="border-b border-divider first:border-t">
              <button
                type="button"
                disabled={!!job}
                data-kind={k}
                aria-expanded={k === "audio" ? audioOpen : undefined}
                onClick={() => (k === "audio" ? setAudioOpen((o) => !o) : run(k))}
                className="-mx-1 flex w-[calc(100%+8px)] items-center gap-3 px-1 py-2 text-left hover:bg-fill-subtle disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{s.outputs.kinds[k].name}</span>
                  <span className="truncate text-label text-muted">{s.outputs.kinds[k].meta}</span>
                </span>
              </button>
              {k === "audio" && audioOpen && !job && (
                <ul className="flex flex-col pb-1.5 pl-7" role="list" aria-label={s.outputs.audio.style} data-testid="audio-styles">
                  {AUDIO_STYLES.map((st) => (
                    <li key={st}>
                      <button
                        type="button"
                        data-style={st}
                        onClick={() => run("audio", st)}
                        className="-mx-1 flex w-[calc(100%+8px)] items-baseline gap-2 rounded-item px-1 py-1.5 text-left hover:bg-fill-subtle"
                      >
                        <span className="font-medium">{s.outputs.audio.styles[st].name}</span>
                        <span className="truncate text-label text-muted">{s.outputs.audio.styles[st].meta}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <h3 className="pt-2 text-label font-semibold text-muted">{s.outputs.saved}</h3>
      {saved.isLoading && <Skeleton className="h-10" />}
      {saved.error && <ErrorState size="sm" title={s.outputs.loadFailed} error={saved.error} onRetry={() => saved.refetch()} />}
      {saved.data && saved.data.length === 0 && <p className="text-body text-muted">{s.outputs.empty}</p>}
      {saved.data && saved.data.length > 0 && (
        <ul className="flex flex-col" data-testid="outputs-list">
          {saved.data.map((o) => {
            const Icon = KIND_ICON[o.kind] ?? KIND_ICON.report;
            return (
              <li key={o.id} className="border-b border-divider first:border-t">
                <button
                  type="button"
                  onClick={() => navigate({ name: "output", spaceId: space.id, outputId: o.id })}
                  className="-mx-1 flex h-9.75 w-[calc(100%+8px)] items-center gap-2.5 px-1 text-left text-body hover:bg-fill-subtle"
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
                  <span className="shrink-0 text-label text-muted">{dayLabel(o.updatedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </StudioSubpanel>
  );
}
