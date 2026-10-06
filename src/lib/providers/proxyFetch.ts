import { api, Channel } from "../ipc";
import type { ProxyEvent } from "../types";

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function abortError(signal?: AbortSignal | null): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function bodyToString(body: unknown, headers: Record<string, string>): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) {
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    }
    return body.toString();
  }
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.text();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    throw new TypeError("Multipart bodies aren't supported by the app's HTTP proxy");
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return new Response(body).text();
  }
  return String(body);
}

/**
 * A `fetch` that goes through the Rust `http_stream` command. Rust adds the provider's key or
 * OAuth token, so `providerId` decides which credential (if any) is used.
 */
export function createProxyFetch(providerId?: string | null): typeof fetch {
  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();

    const headers: Record<string, string> = {};
    if (req) req.headers.forEach((v, k) => (headers[k] = v));
    if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));

    let rawBody: unknown = init?.body;
    if (rawBody == null && req && method !== "GET" && method !== "HEAD") rawBody = await req.text();
    const body = await bodyToString(rawBody, headers);

    const signal = init?.signal ?? req?.signal ?? null;
    if (signal?.aborted) throw abortError(signal);

    const id = newId();
    return new Promise<Response>((resolve, reject) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      let headReceived = false;
      let finished = false;
      const encoder = new TextEncoder();

      const finish = () => {
        finished = true;
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (err: unknown) => {
        if (finished) return;
        finish();
        if (headReceived) controller.error(err);
        else reject(err);
      };
      const onAbort = () => {
        if (finished) return;
        api.httpAbort(id).catch(() => {});
        fail(abortError(signal));
      };

      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
        cancel() {
          if (finished) return;
          finish();
          api.httpAbort(id).catch(() => {});
        },
      });

      const channel = new Channel<ProxyEvent>();
      channel.onmessage = (ev) => {
        if (finished) return;
        switch (ev.type) {
          case "head": {
            headReceived = true;
            const nullBody = NULL_BODY_STATUS.has(ev.status);
            resolve(new Response(nullBody ? null : stream, { status: ev.status, headers: ev.headers }));
            if (nullBody) {
              finish();
              api.httpAbort(id).catch(() => {});
            }
            break;
          }
          case "chunk":
            if (headReceived && ev.data) controller.enqueue(encoder.encode(ev.data));
            break;
          case "end":
            finish();
            if (headReceived) controller.close();
            else reject(new Error("The connection closed before a response arrived"));
            break;
          case "error":
            fail(new Error(ev.message));
            break;
        }
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      api
        .httpStream({ id, url, method, headers, body, providerId: providerId ?? null }, channel)
        .catch((e) => fail(e));
    });
  };
  return proxyFetch as typeof fetch;
}
