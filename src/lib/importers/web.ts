import { Readability } from "@mozilla/readability";
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

/** HTML → readable Markdown, the same way for imports and deep research. */
export function extractReadable(html: string, url: string): ExtractedPage | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);
  const article = new Readability(doc).parse();
  if (!article?.content) return null;
  const markdown = turndown
    .turndown(article.content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (markdown.length < 200) return null;
  return {
    title: (article.title || doc.title || url).trim(),
    markdown,
    excerpt: article.excerpt ?? null,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
  };
}

export async function fetchReadable(url: string): Promise<ExtractedPage & { url: string }> {
  let page: FetchedPage;
  try {
    page = await api.httpGetText(url);
  } catch (e) {
    throw new Error(`Couldn't load the page: ${(e as Error).message}`);
  }
  if (page.status >= 400) throw new Error(`The page returned HTTP ${page.status}.`);
  const type = page.contentType ?? "";
  if (type.includes("text/plain") || type.includes("markdown")) {
    return { url: page.url, title: page.url, markdown: page.body, excerpt: null, byline: null, siteName: null };
  }
  if (type && !type.includes("html") && !type.includes("xml")) {
    throw new Error(`This link isn't a web page (${type.split(";")[0]}). Download the file and add it as a file source.`);
  }
  const extracted = extractReadable(page.body, page.url);
  if (!extracted) throw new Error("No readable article text found on this page.");
  return { ...extracted, url: page.url };
}

export const webImporter: Importer<string> = {
  id: "web",
  canHandle: (input) => !!normalizeUrl(input) && !isYouTubeUrl(input),
  async import(spaceId, input): Promise<Source> {
    const url = normalizeUrl(input);
    if (!url) throw new Error("That doesn't look like a web address.");
    const page = await fetchReadable(url);
    const header = [page.byline, page.siteName].filter(Boolean).join(" · ");
    const text = `# ${page.title}\n\n${header ? `${header}\n\n` : ""}${page.markdown}`;
    return api.importText(spaceId, page.title, text, "url", page.url);
  },
};
