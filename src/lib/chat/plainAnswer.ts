/** An answer as plain text: no {{general}} markers, no [n] citation brackets. */
export function plainAnswer(content: string): string {
  return content
    .replaceAll("{{general}}", "")
    .replaceAll("{{/general}}", "")
    .replace(/\s*\[~?\d{1,2}(?:\s*[,;]\s*~?\d{1,2})*\]/g, "")
    .trim();
}
