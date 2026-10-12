import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../../lib/ipc";
import { queryClient, qk } from "../../lib/queries";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { summarizeText } from "../../lib/sources/summary";
import type { Source, Space } from "../../lib/types";
import { toastError } from "../../components/ui/toast";

/** Source ids whose summary is queued or being written. */
export const useSummarizing = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));
const setSummarizing = (id: string, on: boolean) =>
  useSummarizing.setState((st) => {
    const ids = { ...st.ids };
    if (on) ids[id] = true;
    else delete ids[id];
    return { ids };
  });

const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export async function summarizeSource(space: Space, source: Source): Promise<string> {
  const llm = await resolveChatModel(space);
  const { text } = await api.getSourceText(source.id);
  return summarizeText(llm, source.title, text);
}

/** Writes a summary for every ready source that lacks one, one at a time in the background. */
export function useAutoSummaries(space: Space, sources: Source[] | undefined) {
  useEffect(() => {
    for (const src of sources ?? []) {
      if (src.status !== "ready" || src.summary || attempted.has(src.id)) continue;
      attempted.add(src.id);
      setSummarizing(src.id, true);
      queue = queue.then(async () => {
        try {
          const summary = await summarizeSource(space, src);
          if (summary) {
            await api.updateSource(src.id, { summary });
            queryClient.invalidateQueries({ queryKey: qk.sources(space.id) });
            queryClient.invalidateQueries({ queryKey: ["source", src.id] });
          }
        } catch (e) {
          if (e instanceof NoModelError) {
            attempted.delete(src.id);
            return;
          }
          toastError(`Couldn't summarize “${src.title}”`, e);
        } finally {
          setSummarizing(src.id, false);
        }
      });
    }
  }, [space, sources]);
}
