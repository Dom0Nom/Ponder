const MARKER = /\{\{followup:\s*([^}]*?)\s*\}\}/gi;

const MAX_FOLLOW_UPS = 3;
const MAX_LENGTH = 90;

/** Pulls `{{followup: …}}` markers out of a finished reply. */
export function extractFollowUps(text: string): { clean: string; followUps: string[] } {
  const followUps: string[] = [];
  const clean = text
    .replace(MARKER, (_, q: string) => {
      const f = q.trim();
      if (f.length >= 3 && f.length <= MAX_LENGTH && !followUps.includes(f)) followUps.push(f);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { clean, followUps: followUps.slice(0, MAX_FOLLOW_UPS) };
}

/** Hides complete and half-streamed markers while a reply is still arriving. */
export function hideFollowUpMarkers(text: string): string {
  return text
    .replace(MARKER, "")
    .replace(/\{\{f(?:o(?:l(?:l(?:o(?:w(?:u(?:p(?::[^}]*)?)?)?)?)?)?)?)?$/i, "")
    .replace(/\{\{?$/, "")
    .trimEnd();
}

export const FOLLOWUP_INSTRUCTION =
  "End every answer with up to three short follow-up questions the learner might ask next, each on its own line as {{followup: question}}. Write them in the learner's language, each under 90 characters. Skip them for study-buddy events.";
