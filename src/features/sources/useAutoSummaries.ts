import { useEffect } from "react";
import { generateText } from "ai";
import { api } from "../../lib/ipc";
import { queryClient, qk } from "../../lib/queries";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import type { Source, Space } from "../../lib/types";
import { toastError } from "../../components/ui/toast";

const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export async function summarizeSource(space: Space, source: Source): Promise<string> {
  const llm = await resolveChatModel(space);
  const { text } = await api.getSourceText(source.id);
  const excerpt = text.length > 9000 ? `${text.slice(0, 6000)}\n…\n${text.slice(-2500)}` : text;
  const r = await generateText({
    model: llm.model,
    ...llm.options({ thinking: false }),
    system: "You write short, plain summaries of study material. Reply in the language of the material.",
    prompt: `Summarize this source in 2–3 sentences for a learner: what it covers and what it's useful for. No preamble.\n\nTitle: ${source.title}\n\n${excerpt}`,
  });
  return r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Writes a summary for every ready source that lacks one, one at a time in the background. */
export function useAutoSummaries(space: Space, sources: Source[] | undefined) {
  useEffect(() => {
    for (const src of sources ?? []) {
      if (src.status !== "ready" || src.summary || attempted.has(src.id)) continue;
      attempted.add(src.id);
      queue = queue.then(async () => {
        try {
          const summary = await summarizeSource(space, src);
          if (summary) {
            await api.updateSource(src.id, { summary });
            queryClient.invalidateQueries({ queryKey: qk.sources(space.id) });
          }
        } catch (e) {
          if (e instanceof NoModelError) {
            attempted.delete(src.id);
            return;
          }
          toastError(`Couldn't summarize “${src.title}”`, e);
        }
      });
    }
  }, [space, sources]);
}
