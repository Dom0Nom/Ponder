/** Explainer CSS variable → app token. The iframe can't read the app's CSS, so values are copied in. */
export const EXPLAINER_VARS: Record<string, string> = {
  bg: "surface",
  surface: "fill-subtle",
  fg: "text",
  "fg-secondary": "text-secondary",
  muted: "text-muted",
  border: "border",
  primary: "primary",
  "on-primary": "on-primary",
  fill: "fill",
  danger: "danger",
};

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

/** Drops tags that load or embed other documents. The CSP in the frame is the real guard; this keeps exports tidy. */
export function sanitizeExplainer(html: string): string {
  return html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<(iframe|frame|object|embed|base|link)\b[^>]*>(\s*<\/\1>)?/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, "")
    .trim();
}

export function themeVars(read: (name: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(EXPLAINER_VARS).map(([v, token]) => [v, read(`--${token}`).trim()]));
}

const BOOT = `<script>addEventListener("error",(e)=>parent.postMessage({ponderExplainerError:String(e.message||e)},"*"));</script>`;
const RESIZE = `<script>(()=>{const post=()=>parent.postMessage({ponderExplainerHeight:Math.ceil(document.documentElement.scrollHeight)},"*");new ResizeObserver(post).observe(document.documentElement);addEventListener("load",post);post();})();</script>`;

/** A complete document for a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin): no network, no navigation. */
export function explainerDocument(html: string, vars: Record<string, string>, opts: { title?: string; resize?: boolean; font?: string } = {}): string {
  const root = Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
  const font = opts.font || "system-ui, -apple-system, sans-serif";
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    opts.title ? `<title>${opts.title.replace(/[<&]/g, "")}</title>` : "",
    `<style>:root{${root}--accent:var(--primary);color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ${font}}body{padding:16px}input,button,select{font:inherit;color:inherit}input[type=range]{accent-color:var(--primary)}button{background:var(--fill);border:1px solid var(--border);border-radius:8px;padding:4px 12px;cursor:pointer}canvas,svg{max-width:100%}</style>`,
    "</head><body>",
    opts.resize ? BOOT : "",
    opts.title && !opts.resize ? `<h1 style="font-size:1.4em;margin:0 0 .6em">${opts.title.replace(/[<&]/g, "")}</h1>` : "",
    sanitizeExplainer(html),
    opts.resize ? RESIZE : "",
    "</body></html>",
  ].join("");
}

/** `TITLE: …` then one ```html block; falls back to the first heading for the title. */
export function parseExplainerReply(text: string): { title: string; html: string } | null {
  const block = text.match(/```html?\s*\n([\s\S]*?)(?:\n```|$)/i)?.[1] ?? (/<script|<svg|<canvas/i.test(text) ? text : "");
  const html = sanitizeExplainer(block);
  const interactive = /<(input|button|select|canvas|svg)\b/i.test(html) && /<script\b/i.test(html);
  if (!interactive || html.length < 200 || html.length > 60_000) return null;
  const lead = html.match(/^(?:<style\b[\s\S]*?<\/style>\s*)?(<h[12]\b[^>]*>([\s\S]{2,120}?)<\/h[12]>)/i);
  const heading = html.match(/<h[1-3][^>]*>([^<]{2,80})<\/h[1-3]>/i)?.[1];
  const title = (text.match(/^\s*TITLE:\s*(.+)$/im)?.[1] ?? heading ?? "").replace(/[*#`]/g, "").trim().slice(0, 80);
  return title ? { title, html: lead ? html.replace(lead[1], "").trim() : html } : null;
}
