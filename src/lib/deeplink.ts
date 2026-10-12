import type { Space } from "./types";

export type DeepLink =
  | { kind: "space"; spaceId: string }
  | { kind: "ask"; question: string; spaceId?: string }
  | { kind: "import"; url: string; spaceId?: string };

export type DeepLinkError = "scheme" | "host" | "missing" | "invalid";
export type DeepLinkResult = { ok: true; link: DeepLink } | { ok: false; error: DeepLinkError; host?: string };

const ID = /^[\w.-]{1,100}$/;
const MAX_QUESTION = 4000;

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** Parses `ponder://space/<id>`, `ponder://ask?q=…&space=<id>` and `ponder://import?url=…&space=<id>`. */
export function parseDeepLink(raw: string): DeepLinkResult {
  const m = /^ponder:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(raw.trim());
  if (!m) return { ok: false, error: "scheme" };
  const host = m[1].toLowerCase();
  const segments = m[2].split("/").filter(Boolean);
  const query = new URLSearchParams(m[3] ?? "");
  const spaceParam = query.get("space");
  if (spaceParam !== null && !ID.test(spaceParam)) return { ok: false, error: "invalid" };
  const spaceId = spaceParam ?? undefined;

  switch (host) {
    case "space": {
      const id = segments.length === 1 ? safeDecode(segments[0]) : null;
      if (!id) return { ok: false, error: "missing" };
      return ID.test(id) ? { ok: true, link: { kind: "space", spaceId: id } } : { ok: false, error: "invalid" };
    }
    case "ask": {
      const question = (query.get("q") ?? "").trim();
      if (!question) return { ok: false, error: "missing" };
      return { ok: true, link: { kind: "ask", question: question.slice(0, MAX_QUESTION), spaceId } };
    }
    case "import": {
      const url = (query.get("url") ?? "").trim();
      if (!url) return { ok: false, error: "missing" };
      if (!/^(https?|file):\/\//i.test(url)) return { ok: false, error: "invalid" };
      return { ok: true, link: { kind: "import", url, spaceId } };
    }
    default:
      return { ok: false, error: "host", host };
  }
}

/** Absolute path from a file:// URL, or null when it isn't a local file link. */
export function filePathFromUrl(url: string): string | null {
  const m = /^file:\/\/(?:localhost)?(\/[^?#]*)/i.exec(url);
  const path = m ? safeDecode(m[1]) : null;
  if (!path) return null;
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

export type Target = { ok: true; spaceId: string } | { ok: false; error: "noSpace" | "unknownSpace" };

/** Which space a link acts on: its own, else the open one, else the most recently opened. */
export function resolveTarget(link: DeepLink, spaces: Space[], currentSpaceId: string | null): Target {
  const wanted = link.spaceId;
  if (wanted) return spaces.some((x) => x.id === wanted) ? { ok: true, spaceId: wanted } : { ok: false, error: "unknownSpace" };
  if (currentSpaceId && spaces.some((x) => x.id === currentSpaceId)) return { ok: true, spaceId: currentSpaceId };
  const recent = [...spaces].sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))[0];
  return recent ? { ok: true, spaceId: recent.id } : { ok: false, error: "noSpace" };
}
