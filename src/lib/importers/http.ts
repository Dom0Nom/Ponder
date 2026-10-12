import { createProxyFetch } from "../providers/proxyFetch";
import type { HttpFn } from "./youtube";

/**
 * HTTP through the Rust proxy (no CORS, browser-like). Without a provider id no credential is sent.
 * With `search:<engine>` Rust adds that engine's key, and only for the engine's own host.
 */
export const proxyHttpFor =
  (providerId?: string): HttpFn =>
  async (url, init) => {
    const res = await createProxyFetch(providerId)(url, {
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

/** Unauthenticated HTTP through the Rust proxy. */
export const proxyHttp: HttpFn = proxyHttpFor();
