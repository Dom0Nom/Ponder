// Hostile OpenAI-compatible SSE server for reproducing streaming bugs.
//
//   bun scripts/mock-sse-server.ts [port]        (default 18765)
//
// Add it as an OpenAI-compatible provider with base URL http://127.0.0.1:18765/v1. The model id
// picks the behaviour; parts combine with "+", e.g. "pause-10+split+close-early":
//   pause-N        stop for N seconds halfway through the answer (keep-alive comments every 2 s)
//   silent-N       same, without keep-alive comments
//   split          write the body in tiny pieces that cut through UTF-8 characters and JSON
//   close-early    drop the connection halfway, no [DONE], no chunked terminator
//   close-after-done  send [DONE], then drop the connection without the chunked terminator
//   long           ~6000 characters instead of ~1200
//   gzip           compress the body (Content-Encoding: gzip), flushing after every event
import net from "node:net";
import zlib from "node:zlib";

const port = Number(process.argv[2] ?? 18765);

const PARAGRAPH =
  "Photosynthesis turns light into chemical energy — Lichtenergie wird in chemische Energie umgewandelt. " +
  "In the light reactions, water is split and O₂ is released; the Calvin cycle then fixes CO₂ into sugar. " +
  "Formula: $6CO_2 + 6H_2O \\to C_6H_{12}O_6 + 6O_2$. Emoji check: 🌱🌞. ";

export function answerFor(model: string): string {
  const reps = model.includes("long") ? 25 : 5;
  return Array.from({ length: reps }, (_, i) => `**${i + 1}.** ${PARAGRAPH}`).join("\n\n");
}

function deltas(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/(?<= )/);
  for (let i = 0; i < words.length; i += 3) out.push(words.slice(i, i + 3).join(""));
  return out;
}

function event(model: string, content: string | null, finish: string | null = null): string {
  const chunk = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta: content == null ? {} : { content }, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(model: string, key: string): number | null {
  const m = new RegExp(`${key}-(\\d+)`).exec(model);
  return m ? Number(m[1]) : null;
}

async function streamAnswer(sock: net.Socket, model: string) {
  const gzip = model.includes("gzip");
  const split = model.includes("split");
  const pause = num(model, "pause") ?? num(model, "silent");
  const keepAlive = num(model, "pause") != null;
  const headers = [
    "HTTP/1.1 200 OK",
    "Content-Type: text/event-stream",
    "Cache-Control: no-cache",
    "Transfer-Encoding: chunked",
    ...(gzip ? ["Content-Encoding: gzip"] : []),
    "",
    "",
  ].join("\r\n");
  sock.write(headers);

  const gz = gzip ? zlib.createGzip() : null;
  const writeChunk = (buf: Buffer) => {
    if (!buf.length || sock.destroyed) return;
    sock.write(`${buf.length.toString(16)}\r\n`);
    sock.write(buf);
    sock.write("\r\n");
  };
  gz?.on("data", (b: Buffer) => writeChunk(b));
  const send = async (s: string) => {
    const buf = Buffer.from(s, "utf8");
    if (gz) {
      gz.write(buf);
      await new Promise<void>((r) => gz.flush(zlib.constants.Z_SYNC_FLUSH, () => r()));
      return;
    }
    if (!split) return writeChunk(buf);
    for (let i = 0; i < buf.length; i += 5) {
      writeChunk(buf.subarray(i, i + 5));
      await sleep(1);
    }
  };

  const parts = deltas(answerFor(model));
  const half = Math.floor(parts.length / 2);
  await send(": mock processing\n\n");
  for (let i = 0; i < parts.length; i++) {
    if (sock.destroyed) return;
    if (i === half) {
      if (model.includes("close-early")) return sock.destroy();
      if (pause) {
        const end = Date.now() + pause * 1000;
        while (Date.now() < end) {
          await sleep(Math.min(2000, end - Date.now()));
          if (keepAlive && Date.now() < end) await send(": keep-alive\n\n");
        }
      }
    }
    await send(event(model, parts[i]));
    await sleep(15);
  }
  await send(event(model, null, "stop"));
  await send("data: [DONE]\n\n");
  if (model.includes("close-after-done")) return sock.destroy();
  if (gz) {
    gz.end();
    await new Promise((r) => gz.on("end", r));
  }
  sock.end("0\r\n\r\n");
}

function respondJson(sock: net.Socket, status: number, body: unknown) {
  const s = JSON.stringify(body);
  sock.end(
    `HTTP/1.1 ${status} OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(s)}\r\nConnection: close\r\n\r\n${s}`,
  );
}

const MODELS = [
  "plain",
  "long",
  "split",
  "pause-5",
  "pause-30",
  "silent-10",
  "close-early",
  "close-after-done",
  "gzip",
  "long+split+pause-10",
];

export function startMockSse(listenPort = port): net.Server {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("error", () => {});
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const headEnd = buf.indexOf("\r\n\r\n");
      if (headEnd < 0) return;
      const head = buf.subarray(0, headEnd).toString();
      const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? 0);
      if (buf.length < headEnd + 4 + len) return;
      sock.removeAllListeners("data");
      const [line] = head.split("\r\n");
      const [method, path] = line.split(" ");
      const body = buf.subarray(headEnd + 4, headEnd + 4 + len).toString();
      if (method === "GET" && path.endsWith("/models")) {
        return respondJson(sock, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model" })) });
      }
      if (method === "POST" && path.endsWith("/chat/completions")) {
        let model = "plain";
        try {
          model = JSON.parse(body).model ?? "plain";
        } catch {}
        void streamAnswer(sock, model);
        return;
      }
      respondJson(sock, 404, { error: "not found" });
    });
  });
  server.listen(listenPort, "127.0.0.1");
  return server;
}

if (import.meta.main) {
  startMockSse();
  console.log(`mock SSE server on http://127.0.0.1:${port}/v1`);
}
