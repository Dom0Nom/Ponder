import type { Note } from "../types";

const LINK = /\[\[([^[\]\n]+?)\]\]/g;

export const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/** Titles linked from a body with [[Title]], in order of first appearance. */
export function parseLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(LINK)) {
    const title = m[1].trim();
    const key = normTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

export function findByTitle<T extends Pick<Note, "id" | "title">>(notes: T[], title: string): T | undefined {
  const key = normTitle(title);
  return notes.find((n) => normTitle(n.title) === key);
}

/** Notes (other than the target) whose body links to the target's title. */
export function backlinks(notes: Note[], target: Pick<Note, "id" | "title">): Note[] {
  const key = normTitle(target.title);
  return notes.filter((n) => n.id !== target.id && parseLinks(n.body).some((t) => normTitle(t) === key));
}

/** Links that point at no existing note. */
export function brokenLinks(notes: Note[], note: Note): string[] {
  return parseLinks(note.body).filter((t) => !findByTitle(notes, t));
}

/** The open "[[query" before the caret (same line, not yet closed), or null. */
export function linkQueryAt(body: string, caret: number): { start: number; query: string } | null {
  const before = body.slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;
  const query = before.slice(open + 2);
  if (/[\]\n[]/.test(query)) return null;
  return { start: open, query };
}

/** Notes whose title contains the query, prefix matches first. The note being edited is left out. */
export function suggestions(notes: Note[], query: string, selfId?: string, limit = 6): Note[] {
  const q = normTitle(query);
  return notes
    .filter((n) => n.id !== selfId && normTitle(n.title).includes(q))
    .sort(
      (a, b) =>
        Number(normTitle(b.title).startsWith(q)) - Number(normTitle(a.title).startsWith(q)) || a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

/** Replaces the open "[[query" with a finished link and returns the new caret. */
export function applyCompletion(body: string, caret: number, start: number, title: string): { body: string; caret: number } {
  const after = body.slice(caret);
  const rest = after.startsWith("]]") ? after.slice(2) : after;
  const link = `[[${title}]]`;
  return { body: body.slice(0, start) + link + rest, caret: start + link.length };
}

/** Rewrites links to an old title so they follow a rename. */
export function renameLinks(body: string, oldTitle: string, newTitle: string): string {
  const key = normTitle(oldTitle);
  return body.replace(LINK, (all, t: string) => (normTitle(t) === key ? `[[${newTitle}]]` : all));
}

export const NOTE_HREF = "#note=";
export const NEW_NOTE_HREF = "#new-note=";

/** Turns [[Title]] into Markdown links the preview can intercept. */
export function linkify(body: string, notes: Pick<Note, "id" | "title">[]): string {
  return body.replace(LINK, (_, t: string) => {
    const hit = findByTitle(notes, t);
    const label = t.trim();
    return hit ? `[${label}](${NOTE_HREF}${hit.id})` : `[${label}](${NEW_NOTE_HREF}${encodeURIComponent(label)})`;
  });
}

/** A title for a new note that doesn't clash with an existing one. */
export function uniqueTitle(notes: Pick<Note, "title">[], base: string): string {
  const taken = new Set(notes.map((n) => normTitle(n.title)));
  if (!taken.has(normTitle(base))) return base;
  for (let i = 2; ; i++) if (!taken.has(normTitle(`${base} ${i}`))) return `${base} ${i}`;
}
