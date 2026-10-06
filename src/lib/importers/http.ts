import { createProxyFetch } from "../providers/proxyFetch";
import type { HttpFn } from "./youtube";

/** Unauthenticated HTTP through the Rust proxy (no CORS, browser-like). */
export const proxyHttp: HttpFn = async (url, init) => {
  const res = await createProxyFetch()(url, {
    method: init.method,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ...init.headers,
    },
    body: init.body,
  });
  return { status: res.status, body: await res.text() };
};
