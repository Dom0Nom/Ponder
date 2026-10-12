import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookA, Sparkles } from "lucide-react";
import { useState } from "react";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { api } from "../../lib/ipc";
import { generateGlossary, textHash } from "../../lib/notes/glossary";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";

export const qkGlossary = (subjectId: string) => ["glossary", subjectId] as const;

/** Key terms with one-line definitions for a source or a note; cached in the database until the text changes. */
export function GlossaryPanel({ subjectId, text, space }: { subjectId: string; text: string; space: Pick<Space, "modelOverride"> | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qkGlossary(subjectId), queryFn: () => api.glossaryGet(subjectId) });
  const [busy, setBusy] = useState(false);
  const stale = !!q.data && q.data.textHash !== textHash(text);

  const make = async () => {
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      const entries = await generateGlossary(llm, text);
      const saved = await api.glossarySave({ subjectId, textHash: textHash(text), entries });
      qc.setQueryData(qkGlossary(subjectId), saved);
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.glossary.failed, e, make);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-border px-3.5 py-3" data-testid="glossary" aria-label={s.glossary.title}>
      <div className="flex items-center gap-2">
        <BookA size={14} className="text-muted" />
        <h2 className="flex-1 text-label font-semibold text-muted">{s.glossary.title}</h2>
        <Button variant="secondary" size="sm" disabled={busy || !text.trim()} onClick={make} data-testid="glossary-make">
          <Sparkles size={13} />
          {q.data ? s.glossary.redo : s.glossary.make}
        </Button>
      </div>
      {busy ? (
        <GeneratingStatus label={s.glossary.working} className="text-muted" />
      ) : q.isLoading ? (
        <Skeleton className="h-10" />
      ) : q.error ? (
        <ErrorState size="sm" title={s.glossary.loadFailed} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <p className="text-body text-muted">{s.glossary.empty}</p>
      ) : (
        <>
          {stale && <p className="text-label text-muted">{s.glossary.stale}</p>}
          {q.data.entries.length === 0 ? (
            <p className="text-body text-muted">{s.glossary.none}</p>
          ) : (
            <dl className="flex flex-col gap-2" data-testid="glossary-entries">
              {q.data.entries.map((e) => (
                <div key={e.term} className="text-body" data-testid="glossary-entry">
                  <dt className="inline font-semibold">{e.term}</dt>
                  <dd className="inline text-fg-secondary"> {"—"} {e.definition}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
