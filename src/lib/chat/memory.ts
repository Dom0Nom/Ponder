const MARKER = /\{\{remember:\s*([^}]*?)\s*\}\}/gi;

/** Pulls `{{remember: …}}` markers out of a finished reply. */
export function extractMemories(text: string): { clean: string; memories: string[] } {
  const memories: string[] = [];
  const clean = text
    .replace(MARKER, (_, fact: string) => {
      const f = fact.trim().replace(/[.\s]+$/, "");
      if (f.length >= 3 && f.length <= 300 && !memories.includes(f)) memories.push(f);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { clean, memories: memories.slice(0, 2) };
}

/** Hides complete and half-streamed markers while a reply is still arriving. */
export function hideMemoryMarkers(text: string): string {
  return text.replace(MARKER, "").replace(/\{\{rem(?:e(?:m(?:b(?:e(?:r(?::[^}]*)?)?)?)?)?)?$/i, "").replace(/\{\{?$/, "").trimEnd();
}

export const MEMORY_INSTRUCTION =
  "If the learner tells you something lasting about themselves that would help future tutoring (their goal or exam, level, what they struggle with, how they like to learn, interests you can use for analogies), add it on its own line at the very end as {{remember: one short fact in third person}}. At most one per reply, only for new facts, never for the topic of the current question.";
