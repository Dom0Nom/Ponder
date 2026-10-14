import { s } from "../strings";
import { Readability } from "@mozilla/readability";
import { isFeed, parseFeed, type Feed } from "./podcast";
import TurndownService from "turndown";
import { api } from "../ipc";
import type { FetchedPage, Source } from "../types";
import type { Importer } from "./types";
import { isYouTubeUrl } from "./youtube";

export function normalizeUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export interface ExtractedPage {
  title: string;
  markdown: string;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "form", "nav", "footer", "svg" as keyof HTMLElementTagNameMap]);
// added rules win over turndown's built-in image rule; remove() would not
turndown.addRule("noImages", { filter: ["img", "picture"], replacement: () => "" });
// link targets are noise in study text and in search chunks; keep the words only
turndown.addRule("plainLinks", {
  filter: "a",
  replacement: (content) => content,
});

const BOILERPLATE_SELECTORS = [
  "[role=navigation]", "[role=contentinfo]", "[role=complementary]", "aside", "header nav",
  ".navbox", ".vertical-navbox", ".sidebar", ".navigation-not-searchable", ".toc", "#toc", ".mw-editsection",
  ".mw-jump-link", ".catlinks", ".printfooter", ".noprint", ".metadata", ".ambox", ".hatnote", ".portalbox",
  ".sistersitebox", ".authority-control", ".reflist", ".references", ".mw-references-wrap", "sup.reference",
  ".mw-cite-backlink", ".breadcrumb", ".breadcrumbs", ".share", ".social", ".related", ".comments", "#comments",
  ".cookie", ".newsletter", ".advert", ".ad",
].join(",");

/** Headings that start reference/link lists rather than study text (English, German, French, Spanish). */
const TRAILER_HEADING_RE =
  /^(references?|notes?|footnotes|citations|bibliography|sources|works cited|further reading|external links|see also|notes and references|einzelnachweise|anmerkungen|quellen|literatur|weblinks|siehe auch|références|notes et références|liens externes|voir aussi|bibliographie|referencias|notas|enlaces externos|véase también|bibliografía)$/i;

/** Drops reference/link-list sections and leftover citation markers from extracted Markdown. */
export function trimBoilerplate(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let skipLevel = 0;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipLevel && level > skipLevel) continue;
      skipLevel = 0;
      if (TRAILER_HEADING_RE.test(h[2].replace(/[*_:]/g, "").trim())) {
        skipLevel = level;
        continue;
      }
    }
    if (!skipLevel) out.push(line);
  }
  return out
    .join("\n")
    // turndown escapes brackets in prose (`\[12\]`) but not in code, so code like `a[0]` is untouched
    .replace(/\\\[(?:\d{1,3}|[a-z]|citation needed|edit|bearbeiten|Quelltext bearbeiten)\\\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML → readable Markdown, the same way for imports and deep research. */
export function extractReadable(html: string, url: string): ExtractedPage | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);
  doc.querySelectorAll(BOILERPLATE_SELECTORS).forEach((el) => el.remove());
  const article = new Readability(doc).parse();
  if (!article?.content) return null;
  const markdown = trimBoilerplate(turndown.turndown(article.content));
  if (markdown.length < 200) return null;
  return {
    title: (article.title || doc.title || url).trim(),
    markdown,
    excerpt: article.excerpt ?? null,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
  };
}

/** Thrown when a pasted link is a podcast feed rather than a page. */
export class FeedFound extends Error {
  constructor(public feed: Feed) {
    super("feed");
  }
}

export async function fetchReadable(url: string): Promise<ExtractedPage & { url: string }> {
  let page: FetchedPage;
  try {
    page = await api.httpGetText(url);
  } catch (e) {
    throw new Error(s.sources.pageLoadFailed((e as Error).message));
  }
  if (page.status >= 400) throw new Error(s.sources.pageHttp(page.status));
  const type = page.contentType ?? "";
  if (isFeed(page.body)) throw new FeedFound(parseFeed(page.body));
  if (type.includes("text/plain") || type.includes("markdown")) {
    return { url: page.url, title: page.url, markdown: page.body, excerpt: null, byline: null, siteName: null };
  }
  if (type && !type.includes("html") && !type.includes("xml")) {
    throw new Error(s.sources.notAWebPage(type.split(";")[0]));
  }
  const extracted = extractReadable(page.body, page.url);
  if (!extracted) throw new Error(s.sources.noReadableText);
  return { ...extracted, url: page.url };
}

export const webImporter: Importer<string> = {
  id: "web",
  canHandle: (input) => !!normalizeUrl(input) && !isYouTubeUrl(input),
  async import(spaceId, input): Promise<Source> {
    const url = normalizeUrl(input);
    if (!url) throw new Error(s.failures.thatDoesnTLookLike);
    const page = await fetchReadable(url);
    const header = [page.byline, page.siteName].filter(Boolean).join(" · ");
    const text = `# ${page.title}\n\n${header ? `${header}\n\n` : ""}${page.markdown}`;
    return api.importText(spaceId, page.title, text, "url", page.url);
  },
};
