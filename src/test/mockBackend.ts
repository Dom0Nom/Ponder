/**
 * In-memory implementation of every Tauri command, installed when the UI runs outside Tauri
 * (plain browser, Playwright). State is snapshotted to localStorage so reloads behave like the
 * real app. `window.__mock` exposes test hooks (clock control, LLM script, reset).
 */
import { studioReply } from "./studioFixtures";
import { tinyPdf } from "./tinyPdf";
import { notesReply } from "./notesFixtures";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type * as T from "../lib/types";
import { DEFAULT_SHORTCUT, sameShortcut, validateShortcut } from "../lib/capture/shortcut";
import { parsePlaylistUri } from "../lib/music";
import { importKind, originFor } from "../lib/importers/cloud";
import { openRouterFixture } from "./openrouterFixture";
import { fixtureOverrides, fixtureScript, installDeterminism, isDesignFixture, readOptions, seedDesignFixture } from "./designFixture";

type Row<T> = Record<string, T>;

interface MockChunk {
  id: number;
  sourceId: string;
  spaceId: string;
  text: string;
  start: number;
  end: number;
  page: number | null;
}

interface MockPack {
  name: string;
  space: Omit<T.Space, "sourceCount">;
  sources: T.Source[];
  texts: Record<string, T.SourceText>;
  chunks: MockChunk[];
  notes: T.Note[];
  cards: T.Card[];
  outputs: T.StudioOutput[];
}

export interface DB {
  spaces: Row<Omit<T.Space, "sourceCount">>;
  sources: Row<T.Source>;
  texts: Row<T.SourceText>;
  chunks: MockChunk[];
  threads: Row<T.Thread>;
  messages: Row<T.Message>;
  journal: Row<T.JournalEntry>;
  providers: Row<T.Provider>;
  secrets: Record<string, true>;
  oauth: Record<string, T.OAuthStatus>;
  cloud: Partial<Record<T.CloudService, MockCloud>>;
  settings: Record<string, unknown>;
  focus: MockFocus | null;
  sessions: Row<T.FocusSessionSummary>;
  focusEvents: T.FocusEvent[];
  musicCalls: string[];
  microSteps: Row<T.MicroStep>;
  parking: Row<T.ParkingItem>;
  memory: Row<T.MemoryItem>;
  cards: Row<T.Card>;
  mistakes: Row<T.Mistake>;
  abilities: Record<string, Row<T.Ability>>;
  practiceItems: Row<T.PracticeItem & { spaceId: string }>;
  attempts: (T.NewAttempt & { spaceId: string; at: number })[];
  mastery?: Record<string, Record<string, T.MasteryRow>>;
  reviews?: T.ReviewRow[];
  exams?: Row<T.ExamAttempt>;
  outputs?: Row<T.StudioOutput>;
  notes?: Row<T.Note>;
  glossaries?: Row<T.Glossary>;
  rewrites?: T.PassageRewrite[];
  annotations?: T.Annotation[];
  inbox?: T.InboxItem[];
  exports?: { name: string; extension: string; size: number }[];
  mcpCalls?: { server: string; tool: string; arguments: unknown }[];
  mcpAuth?: Record<string, boolean>;
  prints?: number;
  images: Record<string, string>;
  curricula: Row<T.SpaceCurriculum>;
  levels: Record<string, Row<T.TopicLevel>>;
  assessments: Row<T.Assessment>;
  courses: Row<T.Course>;
  plans: Row<T.StudyPlan>;
  planTasks: Row<T.PlanTask>;
  watched: Row<T.WatchedFolder>;
  speech: { url: string; body: unknown }[];
  packs?: Record<string, MockPack>;
  lastPack?: string;
  backups: T.BackupInfo[];
  backup: { folder: string | null; enabled: boolean; frequency: "daily" | "weekly"; keep: number; restoreStaged: boolean; lastError: string | null };
  nextId: number;
  clockOffset: number;
}

interface MockFocus {
  sessionId: string;
  spaceId: string | null;
  technique: T.FocusTechnique;
  goal: string | null;
  workMs: number | null;
  breakMs: number;
  longBreakMs: number;
  cyclesBeforeLong: number;
  checkInMins: number;
  energy?: T.Energy;
  startedAt: number;
  phase: T.FocusPhase;
  block: number;
  phaseStartedAt: number;
  phaseDurationMs: number | null;
  pausedAt: number | null;
  pausedTotal: number;
  pauseReason: "user" | "needApp" | null;
  pauseCount: number;
  needAppCount: number;
  /** totals of completed phases */
  focusDoneMs: number;
  breakDoneMs: number;
}

const STORAGE_KEY = isDesignFixture() ? "mock-backend-db-design" : "mock-backend-db";

function emptyDb(): DB {
  return {
    spaces: {},
    sources: {},
    texts: {},
    chunks: [],
    threads: {},
    messages: {},
    journal: {},
    providers: {},
    secrets: {},
    oauth: {},
    cloud: {},
    settings: {},
    focus: null,
    sessions: {},
    focusEvents: [],
    musicCalls: [],
    parking: {},
    microSteps: {},
    memory: {},
    cards: {},
    mistakes: {},
    abilities: {},
    practiceItems: {},
    attempts: [],
    images: {},
    curricula: {},
    levels: {},
    assessments: {},
    courses: {},
    plans: {},
    planTasks: {},
    watched: {},
    speech: [],
    backups: [],
    backup: { folder: null, enabled: false, frequency: "daily", keep: 7, restoreStaged: false, lastError: null },
    nextId: 1,
    clockOffset: 0,
  };
}

let db: DB = emptyDb();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) db = { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    db = emptyDb();
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota or disabled storage: mock stays in memory */
  }
}

const now = () => Date.now() + db.clockOffset;
const id = () => crypto.randomUUID();

function err(code: string, message: string): never {
  throw { code, message };
}

function spaceOut(sp: Omit<T.Space, "sourceCount">): T.Space {
  const override = (sp as { sourceCountOverride?: number }).sourceCountOverride;
  return { ...sp, sourceCount: override ?? Object.values(db.sources).filter((x) => x.spaceId === sp.id).length };
}

function planBundle(spaceId: string): T.StudyPlanBundle | null {
  const plan = db.plans[spaceId];
  if (!plan) return null;
  const tasks = Object.values(db.planTasks)
    .filter((x) => x.spaceId === spaceId)
    .sort((x, y) => x.date.localeCompare(y.date) || x.ord - y.ord);
  return { plan, tasks };
}

function microList(spaceId: string | null): T.MicroStep[] {
  return Object.values(db.microSteps)
    .filter((m) => m.spaceId === spaceId)
    .sort((x, y) => x.position - y.position);
}

// ---------- fake LLM ----------

type Script = (req: { messages: { role: string; content: unknown }[]; body: Record<string, unknown> }) => {
  reasoning?: string;
  content: string;
  toolCall?: { name: string; arguments: string };
};

const defaultScript: Script = ({ messages, body }) => {
  const sys = messages.find((m) => m.role === "system");
  const sysText = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content ?? "");
  const last = messages[messages.length - 1];
  const lastText = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
  const notes = notesReply(lastText);
  if (notes) return { content: notes };
  const tools = (body.tools as { function: { name: string } }[] | undefined) ?? [];
  const lookup = tools.find((t) => t.function.name.endsWith("__lookup"))?.function.name;
  if (last?.role === "tool") return { content: `From your glossary: ${lastText.replace(/^"|"$/g, "")}` };
  if (lookup && last?.role === "user" && /glossary/i.test(lastText)) {
    return { content: "", toolCall: { name: lookup, arguments: JSON.stringify({ term: "osmosis" }) } };
  }
  if (/^Solve this problem carefully/.test(lastText)) {
    const n = Number(lastText.match(/10% of (\d+)/)?.[1] ?? 0);
    return { content: `$0.1 \\cdot ${n} = ${n / 10}$\n{"answer": ${n / 10}}` };
  }
  if (/Write ONE (practice|new) problem/i.test(lastText)) {
    const level = Number(lastText.match(/difficulty (\d)\/5/)?.[1] ?? 3);
    const n = 10 + level * 5 + (/new problem/.test(lastText) ? 1 : 0);
    return {
      content: JSON.stringify({ kind: "numeric", question: `What is 10% of ${n * 10}?`, answer: String(n), solution: `$0.1 \\cdot ${n * 10} = ${n}$`, level }),
    };
  }
  if (/Classify the most likely mistake/i.test(lastText)) {
    return { content: JSON.stringify({ errorType: "arithmetic", note: "Calculation slip." }) };
  }
  if (/Break this goal into micro-steps/i.test(lastText)) {
    return {
      content: JSON.stringify([
        { text: "Open your notes to the first page", minutes: 2 },
        { text: "Read the first paragraph out loud", minutes: 3 },
        { text: "Write one question about it", minutes: 4 },
      ]),
    };
  }
  if (/Make \d+ flashcards/i.test(lastText)) {
    const passage = lastText.match(/\[1\] \([^)]*\)\n([^\n]+)/)?.[1] ?? "Photosynthesis happens in the chloroplasts.";
    const quote = passage.split(" ").slice(0, 6).join(" ");
    return {
      content: JSON.stringify([
        { type: "basic", front: "Where does photosynthesis happen?", back: "In the chloroplasts", passage: 1, quote },
        { type: "cloze", text: "Photosynthesis happens in the {{c1::chloroplasts}}.", passage: 1, quote },
      ]),
    };
  }
  if (/multiple-choice quiz/i.test(lastText)) {
    const ids = [...lastText.matchAll(/id \\?"([^"\\]+)\\?"/g)].map((m) => m[1]);
    const per = Number(lastText.match(/write (?:exactly )?(\d+) question/)?.[1] ?? 1);
    const qs = ids.flatMap((tid) =>
      Array.from({ length: per }, (_, k) => ({
        topicId: tid,
        question: `Question ${k + 1} about ${tid}?`,
        options: ["Correct answer", "Wrong A", "Wrong B", "Wrong C"],
        answer: 0,
        explanation: "Because it's the correct one.",
      })),
    );
    return { content: JSON.stringify(qs) };
  }
  if (/Describe this screenshot as study material/i.test(lastText)) {
    return { content: "Plant cell diagram\n\nA labelled plant cell. The chloroplast sits next to the cell wall and carries out photosynthesis." };
  }
  if (/Transcribe the handwritten math work/i.test(lastText)) {
    return { content: JSON.stringify({ problem: "Solve -2(x-3)+4=10", steps: ["-2x-6+4=10", "-2x-2=10", "-2x=12", "x=-6"] }) };
  }
  if (/check a learner's worked math solution/i.test(lastText)) {
    const steps = [...(lastText.split("STEPS:\n")[1]?.split("\n\n")[0] ?? "").matchAll(/^(\d+)\. (.*)$/gm)].map((m) => m[2]);
    const flagged = new Set([...lastText.matchAll(/Step (\d+) is NOT equivalent/g)].map((m) => Number(m[1])));
    return {
      content: JSON.stringify({
        steps: steps.map((t, i) =>
          flagged.has(i + 1)
            ? { step: i + 1, ok: false, issue: "The minus in front of the bracket wasn't applied to every term.", hint: "What is $-2 \\cdot (-3)$?", fix: t.replace("-6", "+6") }
            : { step: i + 1, ok: true },
        ),
        finalCorrect: flagged.size ? false : null,
        summary: flagged.size ? `Step ${Math.min(...flagged)} has a sign error.` : "Looks fine.",
      }),
    };
  }
  if (/strict fact-checker/i.test(lastText)) {
    return {
      content: JSON.stringify([
        { claim: "Photosynthesis happens in the chloroplasts", verdict: "supported", passages: [1] },
        { claim: "Plants release oxygen", verdict: "unsupported", passages: [], note: "Not in the passages" },
      ]),
    };
  }
  if (/^A learner wants study sources/.test(lastText)) {
    return { content: '{"language":"en","queries":["cell biology"]}' };
  }
  if (/^The learner's question:/.test(lastText)) {
    const n = [...lastText.matchAll(/^### \d+$/gm)].length;
    return {
      content: JSON.stringify(
        Array.from({ length: n }, (_, i) => ({ i, about: "cells", answers: true, relevance: 85, credibility: 70, summary: "Explains how cells divide." })),
      ),
    };
  }
  if (/^Find what a learner's collected sources still don't cover/.test(lastText)) {
    return { content: '{"gaps": [], "queries": []}' };
  }
  if (/^Write a short study report for a learner/.test(lastText)) {
    const n = [...lastText.matchAll(/<source n="\d+"/g)].length;
    return {
      content: `# Cell division\n\nCells divide by mitosis [1]. ${n > 1 ? "Checkpoints keep it orderly [2, 1]. " : ""}A made-up claim [9].\n\n## Not covered\n\nNothing important.`,
    };
  }
  const studio = studioReply(lastText);
  if (studio) return { content: studio };
  if (body.response_format || /Respond with JSON|Return JSON/i.test(sysText + lastText)) {
    return { content: "{}" };
  }
  if (/Summarize this source/i.test(lastText)) {
    return { content: "A short overview of the source's main ideas." };
  }
  const hasSources = /\[1\]/.test(sysText);
  if (/image_url/.test(lastText)) {
    return {
      content: `The screenshot shows a labelled plant cell with a chloroplast next to the cell wall.${hasSources ? " Photosynthesis happens in the chloroplasts [1]." : ""}`,
    };
  }
  if (sysText.includes("Voice conversation:")) {
    return {
      content: `${hasSources ? "Chloroplasts capture light energy and turn it into sugar [1]. " : "Chloroplasts capture light energy. "}{{general}}Plants release oxygen too.{{/general}} **Where** in the leaf do you think that happens?`,
    };
  }
  return {
    reasoning: body.reasoning_effort === "none" ? undefined : "Looking at the passages first.",
    content: hasSources
      ? "Photosynthesis turns light energy into chemical energy stored in glucose [1]. It happens in the chloroplasts [1].\n\n{{general}}Plants also release oxygen as a by-product.{{/general}}"
      : "Here is a general answer. {{general}}This comes from general knowledge.{{/general}}",
  };
};

let script: Script = defaultScript;
let streamDelayMs = 15;
const aborted = new Set<string>();

function sendChannel(channel: { id: number }, index: number, message: T.ProxyEvent) {
  // mockIPC routes Channel callbacks through __TAURI_INTERNALS__.runCallback
  (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, d: unknown) => void } }).__TAURI_INTERNALS__.runCallback(
    channel.id,
    { index, message },
  );
}

/** Search engine answers for deep research: DuckDuckGo finds two pages (a "checkpoint" query finds another), the rest find nothing. */
function searchFixture(url: URL): { type: string; body: string } | null {
  const hit = (href: string, title: string) =>
    `<div class="result"><a rel="nofollow" class="result__a" href="${href}">${title}</a><a class="result__snippet" href="x">About ${title}</a></div>`;
  switch (url.hostname) {
    case "html.duckduckgo.com": {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("openstax")) return { type: "text/html", body: hit("https://openstax.org/books/biology/pages/1", "Biology 2e") };
      if (q.includes("checkpoint")) return { type: "text/html", body: hit("https://example.org/checkpoints", "Cell cycle checkpoints") };
      return { type: "text/html", body: hit("https://example.org/cells-1", "Cell biology basics") + hit("https://example.org/cells-2", "Mitosis explained") };
    }
    case "export.arxiv.org":
      return { type: "application/atom+xml", body: "<feed></feed>" };
    case "en.wikipedia.org":
      return { type: "application/json", body: '{"query":{"search":[]}}' };
    case "api.openalex.org":
      return { type: "application/json", body: '{"results":[]}' };
    default:
      return null;
  }
}

/** 0.2 s of silence as 16-bit mono WAV at 8 kHz. */
function silentWav(): Uint8Array {
  const pcm = 3200;
  const out = new Uint8Array(44 + pcm);
  const v = new DataView(out.buffer);
  [..."RIFF"].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 36 + pcm, true);
  [..."WAVEfmt "].forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0)));
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  [..."data"].forEach((c, i) => v.setUint8(36 + i, c.charCodeAt(0)));
  v.setUint32(40, pcm, true);
  return out;
}

const speechModels = {
  data: [
    { id: "hexgrad/kokoro-82m", name: "Kokoro 82M", supported_voices: ["af_heart", "am_adam", "bf_emma"], pricing: { prompt: "0.0000008" } },
    { id: "fish-audio/s2.1-pro-free:free", name: "Fish Audio S2.1 Pro (free)", supported_voices: null, pricing: { prompt: "0" } },
  ],
};
const transcriptionModels = { data: [{ id: "openai/whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", pricing: { prompt: "0.0000001" } }] };

const PODCAST_FEED = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Plant Talk</title>
<item><title>The Calvin cycle</title><guid>pt-2</guid><pubDate>Mon, 05 Oct 2026 07:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/pt-2.mp3" length="402" type="audio/mpeg"/><itunes:duration>12:00</itunes:duration><podcast:transcript url="https://cdn.example.com/pt-2.vtt" type="text/vtt"/></item>
<item><title>Light reactions</title><guid>pt-1</guid><pubDate>Mon, 28 Sep 2026 07:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/pt-1.mp3" length="402" type="audio/mpeg"/><itunes:duration>9:30</itunes:duration></item>
</channel></rss>`;

function httpBytes(request: T.ProxyRequest): ArrayBuffer {
  const pid = request.providerId ?? "";
  if (!pid && /\.mp3(\?|$)/.test(request.url)) {
    db.speech.push({ url: request.url, body: null });
    save();
    return new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...new Array(400).fill(0)]).buffer as ArrayBuffer;
  }
  const provider = db.providers[pid];
  if (pid.startsWith("tts:") ? !db.secrets[pid] : !provider || (provider.kind === "apiKey" && !db.secrets[pid]))
    err("auth", `No API key saved for ${provider?.name ?? pid.slice(4)}. Add one in Settings.`);
  const body = request.body ? JSON.parse(request.body) : null;
  db.speech.push({ url: request.url, body });
  save();
  const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).buffer as ArrayBuffer;
  if (request.url.includes("output_modalities=speech")) return enc(speechModels);
  if (request.url.includes("output_modalities=transcription")) return enc(transcriptionModels);
  if (request.url.endsWith("/audio/transcriptions")) return enc({ text: "Chloroplasts capture light energy.", usage: { seconds: 2 } });
  const wav = silentWav();
  if (request.url.includes(":generateContent")) {
    let bin = "";
    wav.subarray(44).forEach((b) => (bin += String.fromCharCode(b)));
    return enc({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=8000", data: btoa(bin) } }] } }] });
  }
  return wav.buffer as ArrayBuffer;
}

async function httpStream(request: T.ProxyRequest, channel: { id: number }) {
  let i = 0;
  const send = (m: T.ProxyEvent) => sendChannel(channel, i++, m);
  const url = new URL(request.url);
  if (request.providerId?.startsWith("search:")) {
    if (!db.secrets[request.providerId]) {
      send({ type: "error", message: `No API key saved for ${request.providerId.slice(7)}. Add one in Settings.` });
      return;
    }
    send({ type: "head", status: 200, headers: { "content-type": "application/json" } });
    send({ type: "chunk", data: '{"results":[],"web":{"results":[]}}' });
    send({ type: "end" });
    return;
  }
  const provider = request.providerId ? db.providers[request.providerId] : undefined;
  if (request.providerId && !provider) {
    send({ type: "error", message: "provider not found" });
    return;
  }
  if (provider?.kind === "apiKey" && provider.type !== "openai-compatible" && !db.secrets[provider.id]) {
    send({ type: "error", message: `No API key saved for ${provider.name}. Add one in Settings.` });
    return;
  }
  if (provider?.kind === "oauth" && db.oauth[provider.id]?.state !== "signedIn") {
    send({ type: "error", message: "Not signed in. Sign in again in Settings." });
    return;
  }
  if (url.pathname.endsWith("/models")) {
    send({ type: "head", status: 200, headers: { "content-type": "application/json" } });
    const list = url.hostname.startsWith("generativelanguage")
      ? { models: [{ name: "models/mock-model", supportedGenerationMethods: ["generateContent"] }] }
      : { data: [{ id: "mock-model" }, { id: "mock-model-2" }] };
    send({ type: "chunk", data: JSON.stringify(list) });
    send({ type: "end" });
    return;
  }
  if (!provider) {
    const page = searchFixture(url);
    if (page) {
      await new Promise((r) => setTimeout(r, streamDelayMs));
      send({ type: "head", status: 200, headers: { "content-type": page.type } });
      send({ type: "chunk", data: page.body });
      send({ type: "end" });
      return;
    }
  }
  const body = JSON.parse(request.body ?? "{}");
  const reply = script({ messages: body.messages ?? [], body });
  if (!body.stream && url.pathname.endsWith("/messages")) {
    send({ type: "head", status: 200, headers: { "content-type": "application/json" } });
    send({
      type: "chunk",
      data: JSON.stringify({
        id: "m",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: reply.content }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    send({ type: "end" });
    return;
  }
  if (!body.stream) {
    send({ type: "head", status: 200, headers: { "content-type": "application/json" } });
    send({
      type: "chunk",
      data: JSON.stringify({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: reply.content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    send({ type: "end" });
    return;
  }
  send({ type: "head", status: 200, headers: { "content-type": "text/event-stream" } });
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const pieces: string[] = [];
  if (reply.reasoning) for (const w of reply.reasoning.split(/(?<= )/)) pieces.push(chunk({ reasoning_content: w }));
  if (reply.content) for (const w of reply.content.split(/(?<= )/)) pieces.push(chunk({ content: w }));
  if (reply.toolCall) {
    pieces.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: reply.toolCall.name, arguments: reply.toolCall.arguments } }] }));
    pieces.push(chunk({}, "tool_calls"));
  } else pieces.push(chunk({}, "stop"));
  pieces.push(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: body.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
  pieces.push("data: [DONE]\n\n");
  for (const p of pieces) {
    if (aborted.has(request.id)) {
      send({ type: "error", message: "aborted" });
      return;
    }
    await new Promise((r) => setTimeout(r, streamDelayMs));
    send({ type: "chunk", data: p });
  }
  send({ type: "end" });
}

// ---------- ingestion ----------

function chunkText(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^\n]+(\n(?!\n)[^\n]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function ingest(src: T.Source, text: string) {
  db.texts[src.id] = { text, pages: null };
  for (const c of chunkText(text)) {
    db.chunks.push({ id: db.nextId++, sourceId: src.id, spaceId: src.spaceId, page: null, ...c });
  }
  const done: T.Source = {
    ...src,
    status: "ready",
    progress: 1,
    charCount: text.length,
    chunkCount: db.chunks.filter((c) => c.sourceId === src.id).length,
    updatedAt: now(),
  };
  db.sources[src.id] = done;
  save();
  setTimeout(() => emit("source://updated", done), 50);
}

const deepLinkQueue: string[] = [];

const packCounts = (p: MockPack): T.PackCounts => ({
  sources: p.sources.length,
  chunks: p.chunks.length,
  notes: p.notes.length,
  cards: p.cards.length,
  outputs: p.outputs.length,
  files: 0,
});

function backupStatus(): T.BackupStatus {
  const { folder, enabled, frequency, keep, restoreStaged, lastError } = db.backup;
  return {
    config: { folder, enabled, frequency, keep },
    backups: folder ? [...db.backups].sort((x, y) => y.createdAt - x.createdAt) : [],
    running: false,
    lastError,
    restoreStaged,
  };
}

function captureStatus(): T.CaptureStatus {
  const enabled = (db.settings.quickCaptureEnabled as boolean | undefined) ?? true;
  return {
    enabled,
    shortcut: (db.settings.quickCaptureShortcut as string | undefined) ?? DEFAULT_SHORTCUT,
    registered: enabled,
    error: null,
  };
}

function askStatus(): T.AskStatus {
  const enabled = (db.settings.askEnabled as boolean | undefined) ?? true;
  const snipEnabled = (db.settings.askSnipEnabled as boolean | undefined) ?? false;
  return {
    enabled,
    shortcut: (db.settings.askShortcut as string | undefined) ?? "Alt+CommandOrControl+A",
    registered: enabled,
    error: null,
    snipEnabled,
    snipShortcut: (db.settings.askSnipShortcut as string | undefined) ?? "Alt+CommandOrControl+S",
    snipRegistered: snipEnabled,
    snipError: null,
  };
}

/** 1x1 PNG standing in for a screen region. */
const SNIP_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function newSource(spaceId: string, title: string, kind: T.SourceKind, origin: string | null): T.Source {
  if (!db.spaces[spaceId]) err("not_found", "space not found");
  const src: T.Source = {
    id: id(),
    spaceId,
    title,
    kind,
    origin,
    status: "processing",
    error: null,
    summary: null,
    useInChat: true,
    progress: 0,
    charCount: 0,
    chunkCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  db.sources[src.id] = src;
  save();
  return src;
}

function search(spaceId: string, query: string, limit: number, sourceIds: string[] | null): T.SearchHit[] {
  const terms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  return db.chunks
    .filter((c) => c.spaceId === spaceId)
    .filter((c) => db.sources[c.sourceId]?.useInChat && (!sourceIds || sourceIds.includes(c.sourceId)))
    .map((c) => ({ c, score: terms.filter((t) => c.text.toLowerCase().includes(t)).length + 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ c, score }) => ({
      chunkId: c.id,
      sourceId: c.sourceId,
      sourceTitle: db.sources[c.sourceId].title,
      text: c.text,
      start: c.start,
      end: c.end,
      page: c.page,
      score,
      ord: ordOf(c),
      heading: null,
    }));
}

function ordOf(c: MockChunk): number {
  return db.chunks.filter((x) => x.sourceId === c.sourceId && x.id < c.id).length;
}

function readRange(r: T.RangeRequest): T.SourceRange {
  const src = db.sources[r.sourceId] ?? err("not_found", "source not found");
  const text = db.texts[src.id]?.text ?? err("not_found", "source text not found");
  const chunks = db.chunks.filter((c) => c.sourceId === src.id).sort((a, b) => a.id - b.id);
  let start = 0;
  let end = text.length;
  if (r.unit === "chunk") {
    const a = Math.min(r.from ?? 0, r.to ?? 0);
    const b = Math.max(r.from ?? 0, r.to ?? 0);
    const sel = chunks.filter((_, i) => i >= a && i <= b);
    if (!sel.length) err("invalid", "No chunks in that range.");
    start = sel[0].start;
    end = sel[sel.length - 1].end;
  } else if (r.unit === "page") err("invalid", "This source has no page numbers.");
  const max = r.maxChars ?? 400_000;
  const truncated = end - start > max;
  if (truncated) end = start + max;
  const inside = chunks.filter((c) => c.end > start && c.start < end);
  return {
    sourceId: src.id,
    sourceTitle: src.title,
    chunkId: inside[0]?.id ?? null,
    ordFrom: inside.length ? chunks.indexOf(inside[0]) : 0,
    ordTo: inside.length ? chunks.indexOf(inside[inside.length - 1]) : 0,
    start,
    end,
    pageFrom: null,
    pageTo: null,
    heading: null,
    text: text.slice(start, end),
    truncated,
    totalChunks: chunks.length,
    totalPages: null,
    pageStarts: [],
    chunkStarts: inside.map((c) => [c.id, Math.max(c.start, start)] as [number, number]),
  };
}

// ---------- focus (mirrors src-tauri/src/focus/machine.rs + service.rs) ----------

const MIN = 60_000;
const SLEEP_GRACE_MS = 10_000;

interface MockTransition {
  from: T.FocusPhase;
  to: T.FocusPhase;
  state: T.FocusState;
  at: number;
  autoPaused: boolean;
}

interface FocusOutcome {
  state: T.FocusState | null;
  transitions: MockTransition[];
}

const isBreak = (p: T.FocusPhase) => p === "break" || p === "longBreak";

function minsToMs(v: number | null | undefined, dflt: number, what: string): number {
  const m = v ?? dflt;
  const ms = Math.round(m * MIN);
  if (!Number.isFinite(m) || m <= 0 || m > 24 * 60 || ms < 1000) {
    err("invalid", `${what} must be between 1 second and 24 hours`);
  }
  return ms;
}

function focusDefaults(cfg: T.FocusConfig): { work: number | null; brk: number; long: number } {
  switch (cfg.technique) {
    case "pomodoro":
      return {
        work: minsToMs(cfg.workMins, 25, "Focus length"),
        brk: minsToMs(cfg.breakMins, 5, "Break length"),
        long: minsToMs(cfg.longBreakMins, 15, "Long break length"),
      };
    case "52-17":
      return { work: 52 * MIN, brk: 17 * MIN, long: 17 * MIN };
    case "flowtime":
      return { work: null, brk: 0, long: 0 };
    default: {
      const brk = minsToMs(cfg.breakMins, 5, "Break length");
      const long = cfg.longBreakMins != null ? minsToMs(cfg.longBreakMins, 5, "Long break length") : brk;
      return { work: minsToMs(cfg.workMins, 30, "Focus length"), brk, long };
    }
  }
}

const clampRound = (v: number | null | undefined, dflt: number, lo: number, hi: number, bad: number) => {
  const x = v ?? dflt;
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : bad;
};
const cleanText = (v: string | null | undefined) => (v ?? "").trim() || null;

function rawElapsed(f: MockFocus, t: number): number {
  if (f.phase === "done") return 0;
  const end = f.pausedAt ?? t;
  return Math.max(0, end - f.phaseStartedAt - f.pausedTotal);
}

function elapsed(f: MockFocus, t: number): number {
  const el = rawElapsed(f, t);
  return f.phaseDurationMs == null ? el : Math.min(el, f.phaseDurationMs);
}

function snapshotOf(f: MockFocus, t: number): T.FocusState {
  const el = elapsed(f, t);
  return {
    sessionId: f.sessionId,
    spaceId: f.spaceId,
    technique: f.technique,
    goal: f.goal,
    phase: f.phase,
    block: f.block,
    phaseStartedAt: f.phaseStartedAt,
    phaseDurationMs: f.phaseDurationMs,
    elapsedMs: el,
    remainingMs: f.phaseDurationMs == null ? null : Math.max(0, f.phaseDurationMs - el),
    paused: f.pausedAt != null,
    pauseReason: f.pauseReason,
    pauseCount: f.pauseCount,
    needAppCount: f.needAppCount,
    totalFocusMs: f.focusDoneMs + (f.phase === "work" ? el : 0),
    totalBreakMs: f.breakDoneMs + (isBreak(f.phase) ? el : 0),
    checkInMins: f.checkInMins,
    energy: f.energy ?? "normal",
    now: t,
  };
}

function focusSnapshot(t = now()): T.FocusState | null {
  return db.focus ? snapshotOf(db.focus, t) : null;
}

function enter(f: MockFocus, phase: T.FocusPhase, at: number, durationMs: number | null) {
  f.phase = phase;
  f.phaseStartedAt = at;
  f.phaseDurationMs = durationMs;
  f.pausedAt = null;
  f.pausedTotal = 0;
  f.pauseReason = null;
}

function nextBreak(f: MockFocus, worked: number): [T.FocusPhase, number] {
  if (f.technique === "flowtime") return ["break", Math.max(MIN, Math.round(worked / 5))];
  if ((f.technique === "pomodoro" || f.technique === "custom") && f.block % f.cyclesBeforeLong === 0) {
    return ["longBreak", f.longBreakMs];
  }
  return ["break", f.breakMs];
}

function completePhase(f: MockFocus, at: number, spent: number) {
  if (f.phase === "work") {
    f.focusDoneMs += spent;
    const [p, d] = nextBreak(f, spent);
    enter(f, p, at, d);
  } else {
    f.breakDoneMs += spent;
    if (f.technique === "timebox") enter(f, "done", at, null);
    else {
      f.block += 1;
      enter(f, "work", at, f.workMs);
    }
  }
}

function machineTick(f: MockFocus, t: number): MockTransition[] {
  const out: MockTransition[] = [];
  while (f.pausedAt == null && f.phase !== "done" && f.phaseDurationMs != null) {
    const boundary = f.phaseStartedAt + f.pausedTotal + f.phaseDurationMs;
    if (t < boundary) break;
    const from = f.phase;
    completePhase(f, boundary, f.phaseDurationMs);
    let autoPaused = false;
    if (f.phase === "work" && t - boundary > SLEEP_GRACE_MS) {
      f.pausedAt = boundary;
      f.pauseReason = "user";
      autoPaused = true;
    }
    out.push({ from, to: f.phase, state: snapshotOf(f, boundary), at: boundary, autoPaused });
  }
  if (out.length) out[out.length - 1].state = snapshotOf(f, t);
  return out;
}

function requireActive(f: MockFocus) {
  if (f.phase === "done") err("invalid", "No focus session is running");
}

function machinePause(f: MockFocus, t: number): boolean {
  requireActive(f);
  if (f.phase !== "work") err("invalid", "Breaks can only be paused with “I need the app”");
  if (f.pausedAt != null) return false;
  f.pausedAt = t;
  f.pauseReason = "user";
  f.pauseCount++;
  return true;
}

function machineResume(f: MockFocus, t: number): boolean {
  requireActive(f);
  if (f.pausedAt == null) return false;
  f.pausedTotal += Math.max(0, t - f.pausedAt);
  f.pausedAt = null;
  f.pauseReason = null;
  return true;
}

function machineNeedApp(f: MockFocus, t: number): boolean {
  requireActive(f);
  if (!isBreak(f.phase)) err("invalid", "Not on a break");
  if (f.pausedAt != null) return false;
  f.pausedAt = t;
  f.pauseReason = "needApp";
  f.pauseCount++;
  f.needAppCount++;
  return true;
}

function machineEndWork(f: MockFocus, t: number): MockTransition {
  requireActive(f);
  if (f.phase !== "work") err("invalid", "Not in a focus block");
  if (f.pausedAt != null) {
    f.pausedTotal += Math.max(0, t - f.pausedAt);
    f.pausedAt = null;
  }
  completePhase(f, t, elapsed(f, t));
  return { from: "work", to: f.phase, state: snapshotOf(f, t), at: t, autoPaused: false };
}

function logFocus(f: MockFocus, kind: string, at: number, data: Record<string, unknown> | null = null) {
  db.focusEvents.push({ id: db.nextId++, sessionId: f.sessionId, kind, at, data });
}

function logTransitions(f: MockFocus, trans: MockTransition[], t: number) {
  for (const tr of trans) {
    logFocus(f, "phase", tr.at, { from: tr.from, to: tr.to, block: tr.state.block });
    if (tr.autoPaused) logFocus(f, "auto_pause_sleep", tr.at, { gapMs: t - tr.at });
  }
}

function persistFocus(f: MockFocus, t: number) {
  const st = snapshotOf(f, t);
  Object.assign(db.sessions[f.sessionId], { focusMs: st.totalFocusMs, breakMs: st.totalBreakMs, pauses: f.pauseCount });
}

function finalizeFocus(f: MockFocus, t: number) {
  const st = snapshotOf(f, t);
  f.focusDoneMs = st.totalFocusMs;
  f.breakDoneMs = st.totalBreakMs;
  enter(f, "done", t, null);
  logFocus(f, "end", t);
  Object.assign(db.sessions[f.sessionId], {
    endedAt: t,
    focusMs: st.totalFocusMs,
    breakMs: st.totalBreakMs,
    pauses: f.pauseCount,
  });
}

/** Runs `op` on a copy of the active session after catching it up; commits only if nothing throws. */
function withActive(t: number, op?: (f: MockFocus, trans: MockTransition[]) => void): FocusOutcome {
  if (!db.focus) err("invalid", "No focus session is running");
  const f: MockFocus = structuredClone(db.focus);
  const evLen = db.focusEvents.length;
  const nextId = db.nextId;
  try {
    const trans = machineTick(f, t);
    logTransitions(f, trans, t);
    if (f.phase !== "done") op?.(f, trans);
    if (f.phase === "done") finalizeFocus(f, t);
    else persistFocus(f, t);
    db.focus = f.phase === "done" ? null : f;
    save();
    return { state: focusSnapshot(t), transitions: trans };
  } catch (e) {
    db.focusEvents.length = evLen;
    db.nextId = nextId;
    throw e;
  }
}

const EMBEDDING_MODELS: T.EmbeddingModel[] = [
  { id: "all-MiniLM-L6-v2", sizeMb: 91, multilingual: false },
  { id: "multilingual-e5-small", sizeMb: 488, multilingual: true },
];
const REMOTE_EMBEDDING_MODELS: T.RemoteEmbeddingModel[] = [
  { id: "openai/text-embedding-3-small", name: "OpenAI: Text Embedding 3 Small", price: 0.02 },
  { id: "qwen/qwen3-embedding-8b", name: "Qwen: Qwen3 Embedding 8B", price: 0.01 },
];
const embeddingModel = () => (db.settings.embeddingModel as string | undefined) ?? EMBEDDING_MODELS[0].id;
const embedderStatus = (state: T.EmbedderStatus["state"], progress: number): T.EmbedderStatus => ({
  state,
  model: embeddingModel(),
  progress,
  error: null,
});

function emitOutcome(out: FocusOutcome) {
  for (const tr of out.transitions) emit("focus://transition", { from: tr.from, to: tr.to, state: tr.state });
  emit("focus://tick", out.state);
}

function finishFocus(out: FocusOutcome): T.FocusState {
  emitOutcome(out);
  if (!out.state) err("invalid", "No focus session is running");
  return out.state;
}

function focusTick() {
  const t = now();
  let out: FocusOutcome = { state: null, transitions: [] };
  if (db.focus) {
    const probe: MockFocus = structuredClone(db.focus);
    out =
      machineTick(probe, t).length === 0 && db.focus.phase !== "done"
        ? { state: snapshotOf(db.focus, t), transitions: [] }
        : withActive(t);
  }
  emitOutcome(out);
}

// ---------- providers / oauth ----------

const PROVIDER_TYPES: T.ProviderType[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "openai-compatible",
  "lmstudio",
  "ollama",
  "llamacpp",
  "chatgpt-oauth",
  "xai-oauth",
];

function setOAuth(st: T.OAuthStatus) {
  db.oauth[st.providerId] = st;
  save();
  emit("oauth://status", st);
}

/** Simulates the browser / device approval finishing after `ms`. */
function mockSignIn(providerId: string, account: string, ms: number) {
  setOAuth({ providerId, state: "pending" });
  setTimeout(() => {
    const p = db.providers[providerId];
    if (!p || db.oauth[providerId]?.state !== "pending") return;
    p.config = { ...p.config, account };
    setOAuth({ providerId, state: "signedIn", account, expiresAt: now() + 3_600_000 });
  }, ms);
}

// ---------- cloud imports ----------

interface MockCloud {
  clientId: string;
  hasSecret: boolean;
  state: T.CloudStatus["state"];
  account: string | null;
  error: string | null;
}

function cloudItem(id: string, name: string, opts: Partial<T.CloudItem> = {}): T.CloudItem {
  const item: T.CloudItem = { id, name, folder: false, mimeType: null, size: 48_213, modified: "2026-09-14T09:30:00Z", supported: false, ...opts };
  if (item.folder) item.size = null;
  item.supported = importKind(item) !== null;
  return item;
}
const cloudFolder = (id: string, name: string) => cloudItem(id, name, { folder: true, mimeType: "application/vnd.google-apps.folder" });
const gdoc = (id: string, name: string) => cloudItem(id, name, { mimeType: "application/vnd.google-apps.document", size: null });

/** folder id ("root" / "" for the top level) → children */
const CLOUD_TREE: Record<T.CloudService, Record<string, T.CloudItem[]>> = {
  google: {
    root: [
      cloudFolder("g-bio", "Biology"),
      cloudFolder("g-math", "Math"),
      gdoc("g-lecture", "Lecture notes"),
      cloudItem("g-syllabus", "Syllabus.pdf", { mimeType: "application/pdf", size: 182_004 }),
      cloudItem("g-photo", "Whiteboard.jpg", { mimeType: "image/jpeg", size: 2_401_337 }),
    ],
    "g-bio": [
      cloudFolder("g-cells", "Cells"),
      cloudItem("g-photosynthesis", "Photosynthesis.pdf", { mimeType: "application/pdf", size: 1_204_551 }),
      gdoc("g-genetics", "Genetics summary"),
      cloudItem("g-slides", "Respiration", { mimeType: "application/vnd.google-apps.presentation", size: null }),
      cloudItem("g-form", "Quiz form", { mimeType: "application/vnd.google-apps.form", size: null }),
    ],
    "g-cells": [cloudItem("g-mito", "Mitochondria.md", { mimeType: "text/markdown", size: 3_120 })],
    "g-math": [cloudItem("g-algebra", "Algebra.epub", { mimeType: "application/epub+zip", size: 830_220 })],
  },
  dropbox: {
    "": [
      cloudFolder("/Biology", "Biology"),
      cloudItem("/Reading list.txt", "Reading list.txt", { size: 812 }),
      cloudItem("/song.mp3", "song.mp3", { size: 4_022_100 }),
    ],
    "/Biology": [
      cloudItem("/Biology/Photosynthesis.pdf", "Photosynthesis.pdf", { size: 1_204_551 }),
      cloudItem("/Biology/Essay.docx", "Essay.docx", { size: 22_430 }),
    ],
  },
};

function cloudStatusOf(service: T.CloudService): T.CloudStatus {
  const c = db.cloud[service];
  return {
    service,
    configured: !!c,
    clientId: c?.clientId ?? null,
    hasSecret: c?.hasSecret ?? false,
    state: c?.state ?? "signedOut",
    account: c?.account ?? null,
    error: c?.error ?? null,
    redirectUri: service === "dropbox" ? "http://127.0.0.1:53789/auth/callback" : null,
  };
}

function emitCloud(service: T.CloudService): T.CloudStatus {
  save();
  const st = cloudStatusOf(service);
  emit("cloud://status", st);
  return st;
}

function requireCloud(service: T.CloudService): MockCloud {
  const c = db.cloud[service];
  if (!c) err("invalid", service === "google" ? "Add a Google client ID in Settings first." : "Add a Dropbox app key in Settings first.");
  if (c.state !== "signedIn") err("other", `Not signed in. Connect ${service === "google" ? "Google Drive" : "Dropbox"} in Settings.`);
  return c;
}

const cloudHandlers: Record<string, (a: Args) => unknown> = {
  cloud_status: (a) => cloudStatusOf(a.service as T.CloudService),
  cloud_set_client: (a) => {
    const service = a.service as T.CloudService;
    const clientId = ((a.clientId as string) ?? "").trim();
    const secret = ((a.clientSecret as string | null) ?? "").trim();
    const old = db.cloud[service];
    if (!clientId) {
      delete db.cloud[service];
      return emitCloud(service);
    }
    const sameId = old?.clientId === clientId;
    db.cloud[service] = {
      clientId,
      hasSecret: service === "google" && (!!secret || (sameId && !!old?.hasSecret)),
      state: sameId ? old!.state : "signedOut",
      account: sameId ? old!.account : null,
      error: null,
    };
    return emitCloud(service);
  },
  cloud_connect: (a) => {
    const service = a.service as T.CloudService;
    const c = db.cloud[service];
    if (!c) err("invalid", service === "google" ? "Add a Google client ID in Settings first." : "Add a Dropbox app key in Settings first.");
    if (service === "google" && !c.hasSecret) err("invalid", "Add the Google client secret in Settings first.");
    Object.assign(c, { state: "pending", error: null });
    emitCloud(service);
    setTimeout(() => {
      const cur = db.cloud[service];
      if (cur?.state !== "pending") return;
      Object.assign(cur, { state: "signedIn", account: "you@example.com" });
      emitCloud(service);
    }, 800);
    return { authUrl: service === "google" ? "https://accounts.google.com/o/oauth2/v2/auth?mock" : "https://www.dropbox.com/oauth2/authorize?mock" };
  },
  cloud_disconnect: (a) => {
    const service = a.service as T.CloudService;
    const c = db.cloud[service];
    if (c) Object.assign(c, { state: "signedOut", account: null, error: null });
    return emitCloud(service);
  },
  cloud_list: async (a) => {
    const service = a.service as T.CloudService;
    requireCloud(service);
    await new Promise((r) => setTimeout(r, 150));
    const tree = CLOUD_TREE[service];
    const query = ((a.query as string | null) ?? "").trim().toLowerCase();
    const all = query
      ? Object.values(tree).flat().filter((i) => i.name.toLowerCase().includes(query))
      : (tree[(a.folder as string | null) ?? (service === "google" ? "root" : "")] ?? []);
    const pageSize = 50;
    const offset = Number((a.pageToken as string | null) ?? 0);
    const items = all.slice(offset, offset + pageSize);
    return { items, nextPageToken: offset + pageSize < all.length ? String(offset + pageSize) : null };
  },
  cloud_import: async (a) => {
    const service = a.service as T.CloudService;
    requireCloud(service);
    const sources: T.Source[] = [];
    const failures: { name: string; error: string }[] = [];
    for (const item of a.items as T.CloudItem[]) {
      const kind = importKind(item);
      if (!kind) {
        failures.push({ name: item.name, error: `${item.name} can't be imported (unsupported file type).` });
        continue;
      }
      await new Promise((r) => setTimeout(r, 100));
      const exported = item.mimeType?.startsWith("application/vnd.google-apps.");
      const title = exported ? item.name : item.name.replace(/\.[^.]+$/, "");
      const src = newSource(a.spaceId as string, title, kind, originFor(service, item.id));
      setTimeout(() => ingest(src, `Mock content of ${item.name}.\n\nPhotosynthesis happens in chloroplasts.`), 300);
      sources.push(src);
    }
    return { sources, failures };
  },
};

// ---------- command router ----------

type Args = Record<string, unknown>;

const handlers: Record<string, (a: Args) => unknown> = {
  list_spaces: () =>
    Object.values(db.spaces)
      .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
      .map(spaceOut),
  get_space: (a) => {
    const sp = db.spaces[a.id as string];
    if (!sp) err("not_found", "space not found");
    return spaceOut(sp);
  },
  create_space: (a) => {
    const input = a.input as T.SpacePatch;
    const name = (input.name ?? "").trim();
    if (!name) err("invalid", "Space name can't be empty");
    const sp = {
      id: id(),
      name,
      icon: input.icon ?? "book",
      color: input.color ?? "blue",
      tutorStyle: input.tutorStyle ?? "mixed",
      strictGrounding: input.strictGrounding ?? false,
      modelOverride: input.modelOverride ?? null,
      language: input.language ?? null,
      createdAt: now(),
      updatedAt: now(),
      lastOpenedAt: null,
      recap: null,
    };
    db.spaces[sp.id] = sp;
    save();
    return spaceOut(sp);
  },
  update_space: (a) => {
    const sp = db.spaces[a.id as string];
    if (!sp) err("not_found", "space not found");
    const p = a.patch as T.SpacePatch;
    if (p.name !== undefined && !p.name.trim()) err("invalid", "Space name can't be empty");
    Object.assign(sp, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), { updatedAt: now() });
    if (p.name) sp.name = p.name.trim();
    save();
    return spaceOut(sp);
  },
  touch_space: (a) => {
    const sp = db.spaces[a.id as string];
    if (sp) sp.lastOpenedAt = now();
    save();
    return null;
  },
  delete_space: (a) => {
    const sid = a.id as string;
    if (!db.spaces[sid]) err("not_found", "space not found");
    delete db.spaces[sid];
    for (const src of Object.values(db.sources)) if (src.spaceId === sid) delete db.sources[src.id];
    db.chunks = db.chunks.filter((c) => c.spaceId !== sid);
    for (const t of Object.values(db.threads)) if (t.spaceId === sid) delete db.threads[t.id];
    for (const w of Object.values(db.watched)) if (w.spaceId === sid) delete db.watched[w.id];
    for (const m of Object.values(db.microSteps)) if (m.spaceId === sid) delete db.microSteps[m.id];
    delete db.plans[sid];
    for (const x of Object.values(db.planTasks)) if (x.spaceId === sid) delete db.planTasks[x.id];
    save();
    return null;
  },

  list_sources: (a) =>
    Object.values(db.sources)
      .filter((x) => x.spaceId === a.spaceId)
      .sort((x, y) => y.createdAt - x.createdAt),
  get_source: (a) => db.sources[a.id as string] ?? err("not_found", "source not found"),
  update_source: (a) => {
    const src = db.sources[a.id as string] ?? err("not_found", "source not found");
    Object.assign(src, Object.fromEntries(Object.entries(a.patch as object).filter(([, v]) => v !== undefined)), {
      updatedAt: now(),
    });
    save();
    return src;
  },
  delete_source: (a) => {
    delete db.sources[a.id as string];
    db.annotations = (db.annotations ?? []).filter((y) => y.sourceId !== a.id);
    db.chunks = db.chunks.filter((c) => c.sourceId !== a.id);
    save();
    return null;
  },
  get_source_text: (a) => db.texts[a.id as string] ?? err("not_found", "source text not found"),
  source_pdf: (a) => {
    const src = db.sources[a.id as string] ?? err("not_found", "Source not found");
    if (src.kind !== "pdf") err("invalid", "Only PDFs have a page view.");
    if (src.origin?.includes("missing")) err("not_found", "The original PDF not found");
    const st = db.texts[src.id] ?? { text: "", pages: null };
    const starts = st.pages?.length ? st.pages : [[1, 0] as [number, number]];
    const pages = starts.map(([, off], i) => st.text.slice(off, i + 1 < starts.length ? starts[i + 1][1] : undefined));
    return tinyPdf(pages).buffer;
  },
  import_file: (a) => {
    const path = a.path as string;
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.split(".").pop()?.toLowerCase();
    const kind = ({ pdf: "pdf", epub: "epub", docx: "docx", md: "markdown", txt: "text" } as const)[ext ?? ""];
    if (!kind) err("invalid", `Unsupported file type: .${ext}`);
    const src = newSource(a.spaceId as string, name.replace(/\.[^.]+$/, ""), kind, path);
    setTimeout(() => ingest(src, `Mock content of ${name}.\n\nPhotosynthesis happens in chloroplasts.`), 300);
    return src;
  },
  import_text: (a) => {
    const text = (a.text as string) ?? "";
    if (!text.trim()) err("invalid", "The source is empty");
    const src = newSource(a.spaceId as string, a.title as string, a.kind as T.SourceKind, (a.origin as string) ?? null);
    setTimeout(() => ingest(src, text), 300);
    return src;
  },
  reindex_source: (a) => {
    const src = db.sources[a.id as string] ?? err("not_found", "source not found");
    src.status = "processing";
    src.error = null;
    const text = db.texts[src.id]?.text ?? "";
    db.chunks = db.chunks.filter((c) => c.sourceId !== src.id);
    setTimeout(() => ingest(src, text), 300);
    return src;
  },
  search_chunks: (a) =>
    search(a.spaceId as string, a.query as string, (a.limit as number) ?? 8, (a.sourceIds as string[]) ?? null),
  search_many_chunks: (a) =>
    (a.queries as string[]).map((q) =>
      search(a.spaceId as string, q, (a.limit as number) ?? 20, (a.sourceIds as string[]) ?? null),
    ),
  read_source_ranges: (a) =>
    (a.ranges as T.RangeRequest[]).map((r) => {
      try {
        return { range: readRange(r), error: null };
      } catch (e) {
        return { range: null, error: (e as { message?: string }).message ?? String(e) };
      }
    }),
  source_outlines: (a) =>
    Object.values(db.sources)
      .filter((x) => x.spaceId === a.spaceId && x.status === "ready")
      .map((x) => ({ sourceId: x.id, method: "none", entries: [] })),
  set_source_context_mode: (a) => {
    const src = db.sources[a.id as string] ?? err("not_found", "source not found");
    if (!["auto", "summary", "full"].includes(a.mode as string)) err("invalid", "Unknown context mode.");
    src.contextMode = a.mode as T.ContextMode;
    save();
    return src;
  },
  embedder_status: () => embedderStatus("ready", 1),
  embedding_models: () => EMBEDDING_MODELS,
  openrouter_embedding_models: () => REMOTE_EMBEDDING_MODELS,
  set_embedding_model: (a) => {
    const model = a.model as string;
    if (!EMBEDDING_MODELS.some((m) => m.id === model) && !/^openrouter:\S/.test(model))
      throw err("invalid", `Unknown embedding model: ${model}`);
    if (embeddingModel() === model) return null;
    db.settings.embeddingModel = model;
    emit("embedder://status", embedderStatus("downloading", 0));
    setTimeout(() => emit("embedder://status", embedderStatus("indexing", 0.5)), 400);
    setTimeout(() => emit("embedder://status", embedderStatus("ready", 1)), 900);
    return null;
  },

  watch_list: (a) =>
    Object.values(db.watched)
      .filter((w) => w.spaceId === a.spaceId)
      .sort((x, y) => x.createdAt - y.createdAt),
  watch_add: (a) => {
    const spaceId = a.spaceId as string;
    const path = a.path as string;
    if (!db.spaces[spaceId]) err("not_found", "space not found");
    if (!path.startsWith("/")) err("invalid", `Folder not found: ${path}`);
    if (Object.values(db.watched).some((w) => w.spaceId === spaceId && w.path === path))
      err("invalid", "This folder is already watched in this space.");
    const folder: T.WatchedFolder = {
      id: id(),
      spaceId,
      path,
      recursive: (a.recursive as boolean) ?? true,
      createdAt: now(),
      fileCount: 0,
      status: "scanning",
      error: null,
    };
    db.watched[folder.id] = folder;
    save();
    // pretend the folder holds two lecture files
    setTimeout(() => {
      const f = db.watched[folder.id];
      if (!f) return;
      for (const name of ["Lecture 1.pdf", "Week 2 notes.md"]) {
        const src = newSource(spaceId, name.replace(/\.[^.]+$/, ""), name.endsWith(".pdf") ? "pdf" : "markdown", `${path}/${name}`);
        emit("source://updated", src);
        setTimeout(() => ingest(src, `Mock content of ${name}.\n\nMitosis has four phases.`), 200);
      }
      f.fileCount = 2;
      f.status = "watching";
      save();
      emit("watch://updated", { id: f.id, spaceId });
    }, 300);
    return folder;
  },
  watch_remove: (a) => {
    const f = db.watched[a.id as string] ?? err("not_found", "watched folder not found");
    delete db.watched[f.id];
    save();
    emit("watch://updated", { id: f.id, spaceId: f.spaceId });
    return null;
  },

  music_status: () => ({ available: true, backend: "mock", running: false, lastError: null }),
  music_test: (a) => {
    const r = parsePlaylistUri(String(a.playlist ?? ""));
    if (!r.ok) err("invalid", r.error);
    db.musicCalls.push(`play ${r.uri}`);
    save();
    return null;
  },
  music_pause: () => {
    db.musicCalls.push("pause");
    save();
    return null;
  },

  open_calculator_window: () => {
    window.open("/?window=calculator", "ponder-calculator", "width=400,height=560");
    return null;
  },

  capture_status: () => captureStatus(),
  capture_configure: (a) => {
    const shortcut = String(a.shortcut ?? "").trim();
    const invalid = validateShortcut(shortcut);
    if (invalid) err("invalid", invalid);
    // Spotlight's shortcut stands in for one that another app already owns
    if (a.enabled && /^(CommandOrControl|Command|Super)\+Space$/i.test(shortcut))
      err("invalid", "This shortcut is already used by another app or by macOS. Choose a different one.");
    db.settings.quickCaptureEnabled = !!a.enabled;
    db.settings.quickCaptureShortcut = shortcut;
    save();
    return captureStatus();
  },

  ask_status: () => askStatus(),
  ask_configure: (a) => {
    const shortcut = String(a.shortcut ?? "").trim();
    const snipShortcut = String(a.snipShortcut ?? "").trim();
    for (const sc of [shortcut, snipShortcut]) {
      const invalid = validateShortcut(sc);
      if (invalid) err("invalid", invalid);
    }
    if (a.enabled && a.snipEnabled && sameShortcut(shortcut, snipShortcut)) err("invalid", "The ask and snip shortcuts must be different.");
    const capture = captureStatus().shortcut;
    if ((a.enabled && sameShortcut(shortcut, capture)) || (a.snipEnabled && sameShortcut(snipShortcut, capture)))
      err("invalid", "That shortcut is already used by quick capture. Choose a different one.");
    db.settings.askEnabled = !!a.enabled;
    db.settings.askShortcut = shortcut;
    db.settings.askSnipEnabled = !!a.snipEnabled;
    db.settings.askSnipShortcut = snipShortcut;
    save();
    return askStatus();
  },
  ask_take_pending: () => new URLSearchParams(location.search).has("snip"),
  ask_close: () => null,
  ask_set_height: () => null,
  ask_open_in_main: (a) => {
    ((window as unknown as { __askOpened?: unknown[] }).__askOpened ??= []).push(a.request);
    return null;
  },
  snip_screen: () => {
    const w = window as unknown as { __snipCancel?: boolean };
    if (w.__snipCancel) return null;
    return { mediaType: "image/png", data: SNIP_PNG };
  },
  backup_status: () => backupStatus(),
  backup_configure: (a) => {
    if (a.enabled && !db.backup.folder) err("invalid", "Choose a backup folder first.");
    db.backup.enabled = !!a.enabled;
    db.backup.frequency = a.frequency === "weekly" ? "weekly" : "daily";
    db.backup.keep = Math.min(100, Math.max(1, Number(a.keep) || 7));
    save();
    return backupStatus();
  },
  backup_choose_folder: () => {
    db.backup.folder = "/Users/me/Backups/Ponder";
    save();
    return backupStatus();
  },
  backup_now: () => {
    if (!db.backup.folder) err("invalid", "Choose a backup folder first.");
    const t = now();
    const info: T.BackupInfo = { name: `ponder-backup-${new Date(t).toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "")}.zip`, size: 2_400_000 + db.backups.length * 1000, createdAt: t };
    db.backups = [info, ...db.backups.filter((b) => b.name !== info.name)].slice(0, db.backup.keep);
    save();
    return info;
  },
  backup_delete: (a) => {
    db.backups = db.backups.filter((b) => b.name !== a.name);
    save();
    return backupStatus();
  },
  backup_restore: (a) => {
    if (!db.backups.some((b) => b.name === a.name)) err("not_found", "backup not found");
    db.backup.restoreStaged = true;
    save();
    return backupStatus();
  },
  backup_cancel_restore: () => {
    db.backup.restoreStaged = false;
    save();
    return backupStatus();
  },
  deeplink_take: () => deepLinkQueue.splice(0),
  inbox_pending: () => structuredClone((db.inbox ?? []).filter((x) => x.status === "pending")),
  inbox_finish: (a) => {
    const item = db.inbox?.find((x) => x.id === a.id);
    if (!item) err("not_found", "inbox item not found");
    item.status = a.error ? "error" : "done";
    item.resultId = (a.resultId as string | null) ?? null;
    item.error = (a.error as string | null) ?? null;
    item.body = "";
    save();
  },
  integrations_info: () => ({ exePath: "/Applications/Ponder.app/Contents/MacOS/ponder", dbPath: "/Users/me/Library/Application Support/dev.ponder.app/app.db" }),
  restart_app: () => {
    db.backup.restoreStaged = false;
    save();
    return null;
  },

  list_threads: (a) =>
    Object.values(db.threads)
      .filter((t) => t.spaceId === a.spaceId)
      .sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.updatedAt - x.updatedAt),
  create_thread: (a) => {
    const t: T.Thread = { id: id(), spaceId: a.spaceId as string, title: (a.title as string) ?? "New chat", createdAt: now(), updatedAt: now(), pinned: false };
    db.threads[t.id] = t;
    save();
    return t;
  },
  get_thread: (a) => db.threads[a.id as string] ?? err("not_found", "thread not found"),
  save_thread_summary: (a) => {
    const t = db.threads[a.threadId as string] ?? err("not_found", "thread not found");
    t.summary = (a.summary as string | null) ?? null;
    t.summaryUntil = (a.until as number | null) ?? null;
    save();
    return t;
  },
  set_thread_auto_compact: (a) => {
    const t = db.threads[a.threadId as string] ?? err("not_found", "thread not found");
    t.autoCompact = !!a.on;
    save();
    return t;
  },
  rename_thread: (a) => {
    const t = db.threads[a.id as string] ?? err("not_found", "thread not found");
    t.title = (a.title as string).trim() || err("invalid", "Title can't be empty");
    save();
    return t;
  },
  pin_thread: (a) => {
    const t = db.threads[a.id as string] ?? err("not_found", "thread not found");
    t.pinned = !!a.pinned;
    save();
    return t;
  },
  delete_thread: (a) => {
    delete db.threads[a.id as string];
    for (const m of Object.values(db.messages)) if (m.threadId === a.id) delete db.messages[m.id];
    save();
    return null;
  },
  list_messages: (a) =>
    Object.values(db.messages)
      .filter((m) => m.threadId === a.threadId)
      .sort((x, y) => x.createdAt - y.createdAt),
  add_message: (a) => {
    const n = a.message as T.NewMessage;
    const m: T.Message = {
      id: id(),
      threadId: n.threadId,
      role: n.role,
      content: n.content ?? "",
      reasoning: n.reasoning ?? null,
      citations: n.citations ?? null,
      meta: n.meta ?? null,
      status: n.status ?? "complete",
      error: null,
      // keep insertion order stable even within the same millisecond
      createdAt: Math.max(now(), ...Object.values(db.messages).map((x) => x.createdAt + 1)),
    };
    db.messages[m.id] = m;
    const t = db.threads[n.threadId];
    if (t) t.updatedAt = now();
    save();
    return m;
  },
  update_message: (a) => {
    const m = db.messages[a.id as string] ?? err("not_found", "message not found");
    Object.assign(m, Object.fromEntries(Object.entries(a.patch as object).filter(([, v]) => v !== undefined)));
    save();
    return m;
  },
  delete_message: (a) => {
    delete db.messages[a.id as string];
    save();
    return null;
  },
  list_journal: (a) =>
    Object.values(db.journal)
      .filter((j) => j.spaceId === a.spaceId)
      .sort((x, y) => y.createdAt - x.createdAt),
  add_journal: (a) => {
    const j: T.JournalEntry = {
      id: id(),
      spaceId: a.spaceId as string,
      kind: a.kind as string,
      title: a.title as string,
      content: a.content as string,
      createdAt: now(),
    };
    db.journal[j.id] = j;
    save();
    return j;
  },
  topic_coverage: (a) => {
    const topics = a.topics as { id: string; text: string }[];
    return topics.map((tp) => {
      const hits = search(a.spaceId as string, tp.text, 1, null);
      const words = tp.text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const best = hits[0] ?? null;
      const matched = best ? words.filter((w) => best.text.toLowerCase().includes(w)).length : 0;
      const similarity = best ? Math.min(0.9, 0.2 + matched * 0.12) : null;
      return { topicId: tp.id, similarity, keywordHits: matched >= 2 ? 1 : 0, best };
    });
  },
  curriculum_get: (a) => db.curricula[a.spaceId as string] ?? null,
  curriculum_set: (a) => {
    const topics = a.topics as T.TopicRef[];
    if (!topics?.length) err("invalid", "A curriculum needs at least one topic");
    const c: T.SpaceCurriculum = { spaceId: a.spaceId as string, curriculumId: a.curriculumId as string, title: a.title as string, topics, updatedAt: now() };
    const old = db.curricula[c.spaceId];
    if (old && (old.curriculumId !== c.curriculumId || JSON.stringify(old.topics) !== JSON.stringify(c.topics))) {
      delete db.levels[c.spaceId];
      for (const k of Object.keys(db.abilities[c.spaceId] ?? {})) if (!k.startsWith("free:")) delete db.abilities[c.spaceId][k];
      for (const x of Object.values(db.planTasks)) if (x.spaceId === c.spaceId && x.topicId && !x.doneAt) delete db.planTasks[x.id];
    }
    db.curricula[c.spaceId] = c;
    save();
    return c;
  },
  curriculum_clear: (a) => {
    delete db.curricula[a.spaceId as string];
    save();
    return null;
  },
  topic_levels: (a) => Object.values(db.levels[a.spaceId as string] ?? {}),
  topic_level_set: (a) => {
    const sp = (db.levels[a.spaceId as string] ??= {});
    sp[a.topicId as string] = { topicId: a.topicId as string, level: a.level as T.TopicLevelValue, evidence: (a.evidence as string) ?? null, updatedAt: now() };
    save();
    return null;
  },
  assessment_create: (a) => {
    const x: T.Assessment = {
      id: id(),
      spaceId: a.spaceId as string,
      kind: a.kind as T.AssessmentKind,
      topicId: (a.topicId as string) ?? null,
      title: a.title as string,
      questions: a.questions as T.QuizQuestion[],
      answers: null,
      score: null,
      createdAt: now(),
      completedAt: null,
    };
    db.assessments[x.id] = x;
    save();
    return x;
  },
  assessment_complete: (a) => {
    const x = db.assessments[a.id as string] ?? err("not_found", "assessment not found");
    Object.assign(x, { answers: a.answers, score: a.score, completedAt: now() });
    save();
    return x;
  },
  assessments_list: (a) => Object.values(db.assessments).filter((x) => x.spaceId === a.spaceId),
  courses_list: (a) => Object.values(db.courses).filter((c) => c.spaceId === a.spaceId),
  course_create: (a) => {
    const lessons = a.lessons as { title: string; startOffset: number; endOffset: number }[];
    if (!lessons?.length) err("invalid", "No chapters found in this source");
    const cid = id();
    const c: T.Course = {
      id: cid,
      spaceId: a.spaceId as string,
      sourceId: a.sourceId as string,
      title: a.title as string,
      createdAt: now(),
      lessons: lessons.map((l, i) => ({ id: id(), courseId: cid, ord: i, title: l.title, startOffset: l.startOffset, endOffset: l.endOffset, status: "todo", score: null, completedAt: null })),
    };
    db.courses[cid] = c;
    save();
    return c;
  },
  course_delete: (a) => {
    delete db.courses[a.id as string];
    save();
    return null;
  },
  lesson_set_status: (a) => {
    for (const c of Object.values(db.courses)) {
      const l = c.lessons.find((x) => x.id === a.id);
      if (l) {
        l.status = a.status as T.Lesson["status"];
        if (a.score != null) l.score = a.score as number;
        l.completedAt = l.status === "done" ? now() : null;
      }
    }
    save();
    return null;
  },
  cards_add: (a) => {
    const sp = db.spaces[a.spaceId as string] ?? err("not_found", "space not found");
    const cards = a.cards as T.NewCard[];
    for (const c of cards) {
      if (!["basic", "cloze", "occlusion", "mcq"].includes(c.kind)) err("invalid", `Unknown card type: ${c.kind}`);
      if (!c.front?.trim() && c.kind !== "occlusion") err("invalid", "A card needs a front");
      if (c.kind === "basic" && !c.back?.trim()) err("invalid", "A card needs a back");
      if (c.kind === "cloze" && !c.front.includes("{{c")) err("invalid", "A cloze card needs at least one {{c1::…}} gap");
    }
    const out = cards.map((c) => {
      const card: T.Card = {
        id: id(),
        spaceId: sp.id,
        kind: c.kind,
        front: c.front.trim(),
        back: (c.back ?? "").trim(),
        data: c.data ?? null,
        sourceId: c.sourceId ?? null,
        chunkStart: c.chunkStart ?? null,
        chunkEnd: c.chunkEnd ?? null,
        origin: c.origin ?? "manual",
        suspended: false,
        createdAt: now(),
        updatedAt: now(),
        due: now(),
        state: 0,
        fsrs: null,
        spaceName: sp.name,
      };
      db.cards[card.id] = card;
      return card;
    });
    save();
    return out;
  },
  card_update: (a) => {
    const c = db.cards[a.id as string] ?? err("not_found", "card not found");
    Object.assign(c, Object.fromEntries(Object.entries(a.patch as object).filter(([, v]) => v !== undefined)), { updatedAt: now() });
    save();
    return c;
  },
  card_delete: (a) => {
    delete db.cards[a.id as string];
    save();
    return null;
  },
  cards_list: (a) => Object.values(db.cards).filter((c) => c.spaceId === a.spaceId).sort((x, y) => y.createdAt - x.createdAt),
  cards_due: (a) =>
    Object.values(db.cards)
      .filter((c) => !c.suspended && c.due <= now() && (!a.spaceId || c.spaceId === a.spaceId))
      .sort((x, y) => (x.state === 0 ? 1 : 0) - (y.state === 0 ? 1 : 0) || x.due - y.due)
      .slice(0, (a.limit as number) ?? 200),
  cards_due_counts: () => {
    const by = new Map<string, T.DueCount>();
    for (const c of Object.values(db.cards)) {
      const e = by.get(c.spaceId) ?? { spaceId: c.spaceId, spaceName: c.spaceName, due: 0, new: 0, total: 0 };
      e.total++;
      if (!c.suspended && c.state === 0) e.new++;
      else if (!c.suspended && c.due <= now()) e.due++;
      by.set(c.spaceId, e);
    }
    return [...by.values()];
  },
  card_review: (a) => {
    const c = db.cards[a.id as string] ?? err("not_found", "card not found");
    const rating = a.rating as number;
    if (rating < 1 || rating > 4) err("invalid", "Rating must be 1–4");
    Object.assign(c, { fsrs: a.fsrs, due: a.due, state: a.cardState });
    const logs = ((db as unknown as { reviewLogs?: Record<string, number[]> }).reviewLogs ??= {});
    (logs[c.id] ??= []).push(rating);
    (db.reviews ??= []).push({ cardId: c.id, spaceId: c.spaceId, sourceId: c.sourceId, rating, reviewedAt: now(), confidence: (a.confidence as T.Confidence | null) ?? null });
    const last = logs[c.id].slice(-2);
    if (last.length === 2 && last.every((r) => r >= 3)) for (const m of Object.values(db.mistakes)) if (m.cardId === c.id) m.resolved = true;
    save();
    return c;
  },
  mistakes_add: (a) => {
    const items = a.items as T.NewMistake[];
    return items.map((m) => {
      const opts = m.options && m.options.length >= 2 && m.options.includes(m.correct) ? m.options : null;
      const [card] = handlers.cards_add({
        spaceId: a.spaceId,
        cards: [
          {
            kind: opts ? "mcq" : "basic",
            front: m.question,
            back: m.explanation ? `${m.correct}\n\n${m.explanation}` : m.correct,
            data: opts ? { options: opts, answer: opts.indexOf(m.correct) } : null,
            origin: "mistake",
          },
        ],
      }) as T.Card[];
      const mk: T.Mistake = {
        id: id(),
        spaceId: a.spaceId as string,
        origin: m.origin,
        question: m.question,
        given: m.given ?? null,
        correct: m.correct,
        explanation: m.explanation ?? null,
        topic: m.topic ?? null,
        cardId: card.id,
        resolved: false,
        createdAt: now(),
        errorType: null,
      };
      db.mistakes[mk.id] = mk;
      save();
      return mk;
    });
  },
  mistakes_list: (a) =>
    Object.values(db.mistakes)
      .filter((m) => !a.spaceId || m.spaceId === a.spaceId)
      .sort((x, y) => Number(x.resolved) - Number(y.resolved) || y.createdAt - x.createdAt),
  mistake_set_resolved: (a) => {
    const m = db.mistakes[a.id as string];
    if (m) m.resolved = a.resolved as boolean;
    save();
    return null;
  },
  mistake_delete: (a) => {
    delete db.mistakes[a.id as string];
    save();
    return null;
  },
  image_store: (a) => {
    const name = `${id()}.svg`;
    const label = String(a.path).split("/").pop();
    db.images[name] =
      "data:image/svg+xml;base64," +
      btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eef"/><text x="20" y="40">${label}</text><text x="60" y="150">Nucleus</text><text x="250" y="220">Membrane</text></svg>`);
    save();
    return name;
  },
  image_read: (a) => db.images[a.name as string] ?? err("not_found", "image not found"),
  abilities_list: (a) => Object.values(db.abilities[a.spaceId as string] ?? {}),
  ability_get: (a) => db.abilities[a.spaceId as string]?.[a.topicKey as string] ?? null,
  practice_item_add: (a) => {
    const it = a.item as T.PracticeItem;
    if (!["mcq", "numeric", "short"].includes(it.kind)) err("invalid", `Unknown item kind: ${it.kind}`);
    const item = { ...it, hint: it.hint?.trim() || null, id: id(), createdAt: now(), spaceId: a.spaceId as string };
    db.practiceItems[item.id] = item;
    save();
    return item;
  },
  practice_recent: (a) =>
    Object.values(db.practiceItems)
      .filter((i) => i.spaceId === a.spaceId && i.topicKey === a.topicKey)
      .sort((x, y) => y.createdAt - x.createdAt)
      .slice(0, (a.limit as number) ?? 15)
      .map((i) => i.question),
  practice_attempt: (a) => {
    const at = a.attempt as T.NewAttempt;
    const sp = (db.abilities[a.spaceId as string] ??= {});
    const prev = sp[at.topicKey];
    sp[at.topicKey] = { topicKey: at.topicKey, topicTitle: at.topicTitle, theta: at.thetaAfter, n: (prev?.n ?? 0) + 1, updatedAt: now() };
    db.attempts.push({ ...at, spaceId: a.spaceId as string, at: now() });
    save();
    return sp[at.topicKey];
  },
  mastery_list: (a) => Object.values((db.mastery ??= {})[a.spaceId as string] ?? {}),
  mastery_upsert: (a) => {
    const row = a.row as T.MasteryRow;
    if (!["learning", "retest", "mastered"].includes(row.state)) err("invalid", `Unknown mastery state: ${row.state}`);
    ((db.mastery ??= {})[a.spaceId as string] ??= {})[row.topicKey] = row;
    save();
    return null;
  },
  mistake_set_error_type: (a) => {
    const m = db.mistakes[a.id as string];
    if (m) m.errorType = a.errorType as T.ErrorType;
    save();
    return null;
  },
  error_patterns_list: (a) => {
    const rows = [
      ...db.attempts.filter((x) => x.errorType && (!a.spaceId || x.spaceId === a.spaceId)).map((x) => ({ et: x.errorType!, at: x.at, topic: x.topicTitle })),
      ...Object.values(db.mistakes).filter((m) => m.errorType && m.origin !== "practice" && (!a.spaceId || m.spaceId === a.spaceId)).map((m) => ({ et: m.errorType!, at: m.createdAt, topic: m.topic ?? m.origin })),
    ];
    const by = new Map<string, { count: number; lastAt: number; topics: string[] }>();
    for (const r of rows) {
      const e = by.get(r.et) ?? { count: 0, lastAt: 0, topics: [] };
      e.count++;
      e.lastAt = Math.max(e.lastAt, r.at);
      if (!e.topics.includes(r.topic)) e.topics.push(r.topic);
      by.set(r.et, e);
    }
    return [...by.entries()].map(([errorType, e]) => ({ errorType, ...e, topics: e.topics.slice(0, 3) })).sort((x, y) => y.count - x.count);
  },
  list_memory: () => Object.values(db.memory).sort((a, b) => b.createdAt - a.createdAt),
  add_memory: (a) => {
    const text = String(a.text ?? "").trim();
    if (!text) err("invalid", "Memory text can't be empty");
    const dup = Object.values(db.memory).find((m) => m.text.toLowerCase() === text.toLowerCase());
    if (dup) return dup;
    const m: T.MemoryItem = {
      id: id(),
      text,
      origin: a.origin as "user" | "tutor",
      spaceId: (a.spaceId as string) ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    db.memory[m.id] = m;
    save();
    return m;
  },
  update_memory: (a) => {
    const m = db.memory[a.id as string] ?? err("not_found", "memory not found");
    const text = String(a.text ?? "").trim();
    if (!text) err("invalid", "Memory text can't be empty");
    m.text = text;
    m.updatedAt = now();
    save();
    return m;
  },
  delete_memory: (a) => {
    delete db.memory[a.id as string];
    save();
    return null;
  },
  get_settings: () => db.settings,
  set_locale: (a) => {
    db.settings.locale = a.locale;
    save();
    void emit("locale://changed", a.locale);
    return null;
  },
  set_setting: (a) => {
    if (a.value === null) delete db.settings[a.key as string];
    else db.settings[a.key as string] = a.value;
    save();
    return null;
  },

  list_providers: () => Object.values(db.providers).sort((a, b) => a.createdAt - b.createdAt),
  save_provider: (a) => {
    const p = { ...(a.provider as T.Provider) };
    if (!PROVIDER_TYPES.includes(p.type)) err("invalid", `Unknown provider type ${p.type}`);
    if (!p.name?.trim()) err("invalid", "Provider name can't be empty");
    p.baseUrl = p.baseUrl?.trim().replace(/\/+$/, "") || null;
    if (p.baseUrl && !/^https?:\/\/[^/]+/.test(p.baseUrl)) err("invalid", "Base URL must start with http:// or https://");
    if (!p.id) p.id = id();
    if (!p.createdAt) p.createdAt = now();
    p.config = p.config ?? {};
    db.providers[p.id] = p;
    save();
    return p;
  },
  delete_provider: (a) => {
    delete db.providers[a.id as string];
    delete db.secrets[a.id as string];
    delete db.oauth[a.id as string];
    save();
    return null;
  },
  secret_set: (a) => {
    if (!(a.value as string)?.trim()) err("invalid", "Key can't be empty");
    db.secrets[a.providerId as string] = true;
    save();
    return null;
  },
  secret_has: (a) => !!db.secrets[a.providerId as string],
  secret_delete: (a) => {
    delete db.secrets[a.providerId as string];
    save();
    return null;
  },
  mcp_client_tools: (a) => {
    const srv = a.server as { id: string; command: string; url?: string | null };
    if (srv.command === "missing-server") err("other", "Couldn't start missing-server: No such file or directory");
    if (srv.url && !db.mcpAuth?.[srv.id]) err("auth", "This MCP server needs you to sign in.");
    return [
      {
        name: "lookup",
        description: "Look up a term in the learner's glossary",
        inputSchema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
      },
    ];
  },
  mcp_client_call: (a) => {
    const srv = a.server as { id: string };
    (db.mcpCalls ??= []).push({ server: srv.id, tool: a.tool as string, arguments: a.arguments });
    save();
    const term = (a.arguments as { term?: string } | null)?.term ?? "";
    return { text: `${term}: water moving across a membrane`, isError: false };
  },
  mcp_client_stop: () => null,
  mcp_client_auth_status: (a) => ({ signedIn: !!db.mcpAuth?.[a.id as string] }),
  mcp_client_sign_in: async (a) => {
    const srv = a.server as { id: string; url?: string | null };
    if (!srv.url) err("invalid", "Only servers added by URL can sign in.");
    await new Promise((r) => setTimeout(r, 300));
    (db.mcpAuth ??= {})[srv.id] = true;
    save();
    return null;
  },
  mcp_client_sign_out: (a) => {
    if (db.mcpAuth) delete db.mcpAuth[a.id as string];
    save();
    return null;
  },
  lan_scan: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return [{ kind: "lmstudio", baseUrl: "http://192.168.1.50:1234/v1", models: ["mock-model"] }];
  },
  oauth_status: (a) => db.oauth[a.providerId as string] ?? { providerId: a.providerId, state: "signedOut" },
  oauth_chatgpt_start: (a) => {
    const pid = a.providerId as string;
    if (db.providers[pid]?.type !== "chatgpt-oauth") err("invalid", "This provider doesn't use that sign-in method");
    mockSignIn(pid, "you@example.com", 1500);
    return { authUrl: "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client" };
  },
  oauth_xai_device_start: (a) => {
    const pid = a.providerId as string;
    if (db.providers[pid]?.type !== "xai-oauth") err("invalid", "This provider doesn't use that sign-in method");
    mockSignIn(pid, "you@example.com", 3000);
    return {
      userCode: "WDJB-MJHT",
      verificationUri: "https://accounts.x.ai/device",
      verificationUriComplete: "https://accounts.x.ai/device?user_code=WDJB-MJHT",
      expiresIn: 840,
    };
  },
  oauth_sign_out: (a) => {
    const pid = a.providerId as string;
    setOAuth({ providerId: pid, state: "signedOut" });
    const p = db.providers[pid];
    if (p) p.config = { ...p.config, account: undefined };
    save();
    return null;
  },

  http_stream: (a) => {
    httpStream(a.request as T.ProxyRequest, a.onEvent as { id: number });
    return null;
  },
  list_openrouter_models: () => ({ fetchedAt: Math.floor(Date.now() / 1000), models: openRouterFixture }),
  site_icon: (a) => {
    const host = String(a.host).toLowerCase();
    const known = ["kimi.ai", "mi.com", "minimax.io", "moonshot.ai", "nvidia.com", "z.ai", "cohere.com"];
    if (!known.some((k) => host === k || host.endsWith(`.${k}`))) return null;
    const hue = [...host].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" rx="2" fill="hsl(${hue} 60% 45%)"/></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  },
  http_bytes: (a) => httpBytes(a.request as T.ProxyRequest),
  http_abort: (a) => {
    aborted.add(a.id as string);
    return null;
  },
  http_get_text: (a) => {
    const url = a.url as string;
    if (url.includes("/feed")) return { status: 200, url, contentType: "application/rss+xml", body: PODCAST_FEED };
    if (url.endsWith(".vtt"))
      return { status: 200, url, contentType: "text/vtt", body: "WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nToday: how the Calvin cycle fixes carbon dioxide into sugar.\n\n00:01:30.000 --> 00:01:34.000\nRubisco is the enzyme that does it." };
    return {
      status: 200,
      url,
      contentType: "text/html",
      body: `<html><head><title>Mock page</title></head><body><article><h1>Mock page</h1><p>This page talks about photosynthesis in detail. Chlorophyll absorbs light.</p><p>A second paragraph with more content so Readability accepts it as an article body worth keeping.</p><p>${"Cells divide by mitosis, a process in which one nucleus becomes two identical nuclei, and checkpoints in the cell cycle keep it orderly. ".repeat(5)}</p></article></body></html>`,
    };
  },

  focus_start: (a) => {
    if (db.focus) err("invalid", "A focus session is already running");
    const cfg = a.config as T.FocusConfig;
    const t = now();
    const d = focusDefaults(cfg);
    const sessionId = id();
    const f: MockFocus = {
      sessionId,
      spaceId: cleanText(cfg.spaceId),
      technique: cfg.technique,
      goal: cleanText(cfg.goal),
      workMs: d.work,
      breakMs: d.brk,
      longBreakMs: d.long,
      cyclesBeforeLong: clampRound(cfg.cyclesBeforeLong, 4, 1, 100, 4),
      checkInMins: clampRound(cfg.checkInMins, 0, 0, 600, 0),
      energy: cfg.energy === "low" ? "low" : "normal",
      startedAt: t,
      phase: "work",
      block: 1,
      phaseStartedAt: t,
      phaseDurationMs: d.work,
      pausedAt: null,
      pausedTotal: 0,
      pauseReason: null,
      pauseCount: 0,
      needAppCount: 0,
      focusDoneMs: 0,
      breakDoneMs: 0,
    };
    db.sessions[sessionId] = {
      id: sessionId,
      spaceId: f.spaceId,
      technique: f.technique,
      goal: f.goal,
      startedAt: t,
      endedAt: null,
      focusMs: 0,
      breakMs: 0,
      pauses: 0,
      summary: null,
    };
    logFocus(f, "start", t, { technique: f.technique, goal: f.goal });
    db.focus = f;
    save();
    const state = snapshotOf(f, t);
    return finishFocus({ state, transitions: [{ from: "done", to: "work", state, at: t, autoPaused: false }] });
  },
  focus_state: () => focusSnapshot(),
  focus_pause: () => {
    const t = now();
    return finishFocus(
      withActive(t, (f) => {
        if (machinePause(f, t)) logFocus(f, "pause", t, { reason: "user" });
      }),
    );
  },
  focus_resume: () => {
    const t = now();
    return finishFocus(
      withActive(t, (f) => {
        if (machineResume(f, t)) logFocus(f, "resume", t);
      }),
    );
  },
  focus_need_app: (a) => {
    const t = now();
    return finishFocus(
      withActive(t, (f) => {
        if (machineNeedApp(f, t)) logFocus(f, "need_app_pause", t, { reason: a.reason ?? null });
      }),
    );
  },
  focus_end_work: () => {
    const t = now();
    return finishFocus(
      withActive(t, (f, trans) => {
        const tr = machineEndWork(f, t);
        logTransitions(f, [tr], t);
        trans.push(tr);
      }),
    );
  },
  focus_stop: () => {
    if (!db.focus) err("invalid", "No focus session is running");
    const t = now();
    const f: MockFocus = structuredClone(db.focus);
    const trans = machineTick(f, t);
    logTransitions(f, trans, t);
    const from = f.phase;
    finalizeFocus(f, t);
    if (from !== "done") trans.push({ from, to: "done", state: snapshotOf(f, t), at: t, autoPaused: false });
    db.focus = null;
    save();
    emitOutcome({ state: null, transitions: trans });
    return db.sessions[f.sessionId];
  },
  focus_set_summary: (a) => {
    const sess = db.sessions[a.sessionId as string];
    if (sess) sess.summary = a.summary as string;
    save();
    return null;
  },
  focus_history: (a) =>
    Object.values(db.sessions)
      .filter((x) => !a.spaceId || x.spaceId === a.spaceId)
      .sort((x, y) => y.startedAt - x.startedAt)
      .slice(0, 500),
  focus_events: (a) => db.focusEvents.filter((e) => e.sessionId === a.sessionId),
  running_apps: (): T.AppInfo[] => [
    { id: "com.apple.Safari", name: "Safari" },
    { id: "com.hnc.Discord", name: "Discord" },
    { id: "com.apple.Music", name: "Music" },
  ],
  exam_save: (a) => {
    const x = structuredClone(a.attempt as T.ExamAttempt);
    if (!x.id) x.id = id();
    if (!x.startedAt) x.startedAt = now();
    (db.exams ??= {})[x.id] = x;
    return x;
  },
  exams_list: (a) =>
    Object.values(db.exams ?? {})
      .filter((x) => x.spaceId === a.spaceId)
      .sort((x, y) => y.startedAt - x.startedAt),
  exam_get: (a) => db.exams?.[a.id as string] ?? null,
  exam_delete: (a) => {
    delete db.exams?.[a.id as string];
  },
  output_save: (a) => {
    const x = structuredClone(a.output as T.StudioOutput);
    if (!x.id) x.id = id();
    if (!x.createdAt) x.createdAt = now();
    x.updatedAt = Math.max(now(), (db.outputs?.[x.id]?.updatedAt ?? 0) + 1);
    (db.outputs ??= {})[x.id] = x;
    return x;
  },
  outputs_list: (a) =>
    Object.values(db.outputs ?? {})
      .filter((x) => x.spaceId === a.spaceId)
      .sort((x, y) => y.updatedAt - x.updatedAt),
  output_get: (a) => db.outputs?.[a.id as string] ?? null,
  output_delete: (a) => {
    delete db.outputs?.[a.id as string];
  },
  notes_list: (a) =>
    Object.values(db.notes ?? {})
      .filter((x) => x.spaceId === a.spaceId)
      .sort((x, y) => y.updatedAt - x.updatedAt),
  note_get: (a) => db.notes?.[a.id as string] ?? null,
  note_save: (a) => {
    const input = structuredClone(a.note as T.Note);
    if (!db.spaces[input.spaceId]) err("not_found", "space not found");
    const cur = input.id ? db.notes?.[input.id] : undefined;
    const t = now();
    const n: T.Note = {
      id: cur?.id ?? (input.id || id()),
      spaceId: input.spaceId,
      title: input.title.trim() || "Untitled",
      body: input.body ?? "",
      useAsSource: !!input.useAsSource,
      sourceId: cur?.sourceId ?? null,
      createdAt: cur?.createdAt ?? t,
      updatedAt: Math.max(t, (cur?.updatedAt ?? 0) + 1),
    };
    const want = n.useAsSource && !!n.body.trim();
    const existing = n.sourceId ? db.sources[n.sourceId] : undefined;
    if (a.sync === false || (want && existing && existing.title === n.title && db.texts[existing.id]?.text === n.body)) {
      // note row only
    } else if (want && existing) {
      existing.title = n.title;
      existing.summary = null;
      existing.status = "processing";
      db.chunks = db.chunks.filter((c) => c.sourceId !== existing.id);
      const body = n.body;
      setTimeout(() => ingest(existing, body), 300);
    } else if (want) {
      const src = newSource(n.spaceId, n.title, "markdown", `note:${n.id}`);
      n.sourceId = src.id;
      const body = n.body;
      setTimeout(() => ingest(src, body), 300);
    } else if (n.sourceId) {
      handlers.delete_source({ id: n.sourceId });
      n.sourceId = null;
    }
    (db.notes ??= {})[n.id] = n;
    save();
    return n;
  },
  note_delete: (a) => {
    const n = db.notes?.[a.id as string];
    if (n?.sourceId) handlers.delete_source({ id: n.sourceId });
    delete db.notes?.[a.id as string];
    delete db.glossaries?.[a.id as string];
    save();
    return null;
  },
  glossary_get: (a) => db.glossaries?.[a.subjectId as string] ?? null,
  glossary_save: (a) => {
    const g = { ...(a.glossary as T.Glossary), createdAt: now() };
    (db.glossaries ??= {})[g.subjectId] = g;
    save();
    return g;
  },
  annotations_list: (a) => (db.annotations ?? []).filter((x) => x.sourceId === a.sourceId).sort((x, y) => x.start - y.start || x.createdAt - y.createdAt),
  annotation_add: (a) => {
    const start = a.start as number;
    const end = a.end as number;
    const quote = a.quote as string;
    if (start < 0 || end <= start) return err("invalid", "Select some text to highlight.");
    if (!quote.trim() || quote.length > 20_000) return err("invalid", "Highlights can be up to 20,000 characters.");
    if (!db.sources[a.sourceId as string]) return err("not_found", "source not found");
    const now = Date.now();
    const x: T.Annotation = { id: crypto.randomUUID(), sourceId: a.sourceId as string, start, end, quote, note: (a.note as string) ?? "", createdAt: now, updatedAt: now };
    (db.annotations ??= []).push(x);
    save();
    return x;
  },
  annotation_update: (a) => {
    const x = (db.annotations ?? []).find((y) => y.id === a.id);
    if (!x) return err("not_found", "This highlight no longer exists.");
    Object.assign(x, { start: a.start as number, end: a.end as number, note: a.note as string, updatedAt: Date.now() });
    save();
    return x;
  },
  annotation_delete: (a) => {
    db.annotations = (db.annotations ?? []).filter((y) => y.id !== a.id);
    save();
    return null;
  },
  rewrites_list: (a) => (db.rewrites ?? []).filter((r) => r.sourceId === a.sourceId && r.kind === a.kind),
  rewrite_save: (a) => {
    const w = a.rewrite as T.PassageRewrite;
    db.rewrites = (db.rewrites ?? []).filter((r) => !(r.sourceId === w.sourceId && r.kind === w.kind && r.start === w.start && r.end === w.end));
    db.rewrites.push(w);
    save();
    return null;
  },
  pack_export: (a) => {
    const space = db.spaces[a.spaceId as string] ?? err("not_found", "Space not found");
    const sources = Object.values(db.sources).filter((x) => x.spaceId === space.id);
    const ids = new Set(sources.map((x) => x.id));
    const pack: MockPack = {
      name: space.name,
      space: structuredClone(space),
      sources: structuredClone(sources),
      texts: structuredClone(Object.fromEntries(Object.entries(db.texts).filter(([k]) => ids.has(k)))),
      chunks: structuredClone(db.chunks.filter((c) => c.spaceId === space.id)),
      notes: structuredClone(Object.values(db.notes ?? {}).filter((n) => n.spaceId === space.id)),
      cards: structuredClone(Object.values(db.cards).filter((c) => c.spaceId === space.id)),
      outputs: structuredClone(Object.values(db.outputs ?? {}).filter((o) => o.spaceId === space.id)),
    };
    const path = `/Users/me/Documents/${space.name}.ponderpack`;
    (db.packs ??= {})[path] = pack;
    db.lastPack = path;
    save();
    return { path, counts: packCounts(pack) };
  },
  pack_import: () => {
    const pack = db.lastPack ? db.packs?.[db.lastPack] : undefined;
    if (!pack) return null;
    if (!Array.isArray(pack.sources)) err("invalid", "This study pack is damaged (data/sources.json).");
    const names = new Set(Object.values(db.spaces).map((x) => x.name.toLowerCase()));
    let name = pack.name;
    for (let n = 1; names.has(name.toLowerCase()); n++) name = `${pack.name} (imported${n > 1 ? ` ${n}` : ""})`;
    const spaceId = id();
    db.spaces[spaceId] = { ...structuredClone(pack.space), id: spaceId, name, createdAt: now(), updatedAt: now(), lastOpenedAt: null };
    const map: Record<string, string> = {};
    for (const s of pack.sources) map[s.id] = id();
    const sourceIds: string[] = [];
    for (const s of pack.sources) {
      const nid = map[s.id];
      const src: T.Source = { ...structuredClone(s), id: nid, spaceId, status: "processing", progress: 0, error: null };
      db.sources[nid] = src;
      sourceIds.push(nid);
      const text = pack.texts[s.id]?.text;
      if (text) setTimeout(() => ingest(src, text), 300);
      else db.sources[nid] = { ...src, status: "error", error: "The original text of this source is missing from the study pack." };
    }
    for (const n of pack.notes) {
      const nn = id();
      (db.notes ??= {})[nn] = { ...structuredClone(n), id: nn, spaceId, sourceId: n.sourceId ? (map[n.sourceId] ?? null) : null };
    }
    for (const c of pack.cards) {
      const nc = id();
      db.cards[nc] = { ...structuredClone(c), id: nc, spaceId, sourceId: c.sourceId ? (map[c.sourceId] ?? null) : null, due: now(), state: 0, fsrs: null, spaceName: name };
    }
    for (const o of pack.outputs) {
      const no = id();
      (db.outputs ??= {})[no] = { ...structuredClone(o), id: no, spaceId };
    }
    save();
    return { spaceId, name, counts: packCounts(pack), sourceIds };
  },
  export_file: (a) => {
    const bytes = a.bytes as number[];
    (db.exports ??= []).push({ name: a.name as string, extension: a.extension as string, size: bytes.length });
    return `/Users/me/Downloads/${a.name}.${a.extension}`;
  },
  print_window: () => {
    db.prints = (db.prints ?? 0) + 1;
  },
  insights_activity: (a) => {
    const since = a.since as number;
    const inSpace = (id: string | null) => !a.spaceId || id === a.spaceId;
    return {
      reviews: (db.reviews ?? []).filter((r) => inSpace(r.spaceId) && r.reviewedAt >= since),
      focus: Object.values(db.sessions)
        .filter((x) => inSpace(x.spaceId) && x.startedAt >= since && x.focusMs > 0)
        .sort((x, y) => x.startedAt - y.startedAt)
        .map((x) => ({ spaceId: x.spaceId, startedAt: x.startedAt, focusMs: x.focusMs })),
      attempts: db.attempts
        .filter((x) => inSpace(x.spaceId) && x.at >= since)
        .map((x) => ({ spaceId: x.spaceId, topicKey: x.topicKey, correct: x.correct, createdAt: x.at, confidence: x.confidence ?? null })),
    } satisfies T.InsightsActivity;
  },
  parking_add: (a) => {
    const text = String(a.text ?? "").trim();
    if (!text) err("invalid", "Nothing to park");
    const t = now();
    const item: T.ParkingItem = {
      id: id(),
      sessionId: db.focus?.sessionId ?? null,
      spaceId: db.focus?.spaceId ?? null,
      text,
      resolved: false,
      createdAt: t,
    };
    db.parking[item.id] = item;
    if (db.focus) logFocus(db.focus, "parking", t, { text });
    save();
    return item;
  },
  parking_list: (a) =>
    Object.values(db.parking)
      .filter((p) => !a.sessionId || p.sessionId === a.sessionId)
      .sort((x, y) => x.createdAt - y.createdAt),
  parking_resolve: (a) => {
    const p = db.parking[a.id as string];
    if (p) p.resolved = true;
    save();
    return null;
  },
  micro_steps_list: (a) => microList((a.spaceId as string | null) ?? null),
  micro_steps_replace: (a) => {
    const spaceId = (a.spaceId as string | null) ?? null;
    const steps = ((a.steps as T.NewMicroStep[]) ?? []).map((x) => ({ text: String(x.text ?? "").trim(), minutes: Math.min(5, Math.max(2, Math.round(x.minutes))) }));
    if (!steps.length || steps.some((x) => !x.text)) err("invalid", "A step needs some text");
    for (const m of microList(spaceId)) delete db.microSteps[m.id];
    const goal = cleanText(a.goal as string | null);
    steps.slice(0, 12).forEach((x, position) => {
      const m: T.MicroStep = { id: id(), spaceId, sessionId: (a.sessionId as string | null) ?? null, goal, text: x.text, minutes: x.minutes, done: false, position, createdAt: now() };
      db.microSteps[m.id] = m;
    });
    save();
    return microList(spaceId);
  },
  micro_step_set_done: (a) => {
    const m = db.microSteps[a.id as string] ?? err("not_found", "step not found");
    m.done = a.done as boolean;
    save();
    return m;
  },
  micro_step_update: (a) => {
    const m = db.microSteps[a.id as string] ?? err("not_found", "step not found");
    if (typeof a.text === "string") {
      if (!a.text.trim()) err("invalid", "A step needs some text");
      m.text = a.text.trim();
    }
    if (typeof a.minutes === "number") m.minutes = Math.min(5, Math.max(2, Math.round(a.minutes)));
    save();
    return m;
  },
  micro_step_delete: (a) => {
    delete db.microSteps[a.id as string];
    save();
    return null;
  },
  micro_steps_clear: (a) => {
    for (const m of microList((a.spaceId as string | null) ?? null)) delete db.microSteps[m.id];
    save();
    return null;
  },
  get_study_plan: (a) => planBundle(a.spaceId as string),
  save_study_plan: (a) => {
    const sid = a.spaceId as string;
    if (!db.spaces[sid]) err("not_found", "space not found");
    const f = a.plan as T.PlanFields;
    const tasks = a.tasks as T.NewPlanTask[];
    if (!f.goal.trim()) err("invalid", "A plan needs a goal");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.examDate)) err("invalid", "The exam date must look like 2026-12-31");
    if (!(f.weeklyMinutes > 0)) err("invalid", "Weekly study time must be more than zero");
    if (!f.studyDays.length || f.studyDays.some((d) => d < 0 || d > 6)) err("invalid", "Pick at least one study day");
    for (const x of tasks) {
      if (!["learn", "practice", "review", "mock"].includes(x.kind)) err("invalid", `Unknown task kind: ${x.kind}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !(x.minutes > 0) || !x.title.trim()) err("invalid", "Invalid plan task");
    }
    const prev = db.plans[sid];
    db.plans[sid] = {
      spaceId: sid,
      goal: f.goal.trim(),
      examDate: f.examDate,
      weeklyMinutes: f.weeklyMinutes,
      studyDays: f.studyDays,
      replannedAt: a.replanned ? now() : (prev?.replannedAt ?? null),
      createdAt: prev?.createdAt ?? now(),
      updatedAt: now(),
    };
    for (const x of Object.values(db.planTasks)) if (x.spaceId === sid && !x.doneAt) delete db.planTasks[x.id];
    for (const x of tasks) {
      const row: T.PlanTask = { ...x, title: x.title.trim(), id: id(), spaceId: sid, doneAt: null };
      db.planTasks[row.id] = row;
    }
    save();
    return planBundle(sid);
  },
  set_plan_task_done: (a) => {
    const x = db.planTasks[a.id as string] ?? err("not_found", "plan task not found");
    x.doneAt = a.done ? now() : null;
    save();
    return x;
  },
  delete_study_plan: (a) => {
    const sid = a.spaceId as string;
    delete db.plans[sid];
    for (const x of Object.values(db.planTasks)) if (x.spaceId === sid) delete db.planTasks[x.id];
    save();
    return null;
  },
  list_plan_tasks: (a) =>
    Object.values(db.planTasks)
      .filter((x) => x.date >= (a.fromDate as string) && x.date <= (a.toDate as string) && db.spaces[x.spaceId])
      .map((x): T.DatedPlanTask => ({ ...x, spaceName: db.spaces[x.spaceId].name, spaceIcon: db.spaces[x.spaceId].icon }))
      .sort((x, y) => x.date.localeCompare(y.date) || x.spaceName.localeCompare(y.spaceName) || x.ord - y.ord),
  ...cloudHandlers,
};

export interface MockControls {
  reset: () => void;
  /** move the mock clock forward and run a timer tick */
  advance: (ms: number) => void;
  setScript: (fn: Script | null) => void;
  setStreamDelay: (ms: number) => void;
  seedProvider: () => T.Provider;
  db: () => DB;
  /** emit a backend event, e.g. a distraction nudge */
  emit: (event: string, payload: unknown) => void;
  /** queue a ponder:// link as if the OS delivered it */
  deepLink: (url: string) => void;
}

export function installMockBackend() {
  (window as unknown as { __MOCK_BACKEND__: boolean }).__MOCK_BACKEND__ = true;
  const fixture = isDesignFixture() ? fixtureOverrides() : null;
  if (fixture) {
    installDeterminism();
    try {
      localStorage.removeItem("ui");
    } catch {
      /* storage disabled */
    }
    db = emptyDb();
    seedDesignFixture(db, readOptions());
    script = fixtureScript(defaultScript);
    save();
  } else load();
  void import("../stores/ui").then((m) => ((window as unknown as { __ui: unknown }).__ui = m.useUi));
  void import("../lib/queries").then((m) => ((window as unknown as { __qc: unknown }).__qc = m.queryClient));
  const handle = async (cmd: string, args?: unknown) => {
    if (cmd.startsWith("plugin:")) {
      if (cmd === "plugin:dialog|open") {
        const opts = (args as { options?: { directory?: boolean; filters?: { extensions: string[] }[] } } | undefined)?.options;
        if (opts?.filters?.some((f) => f.extensions.includes("png"))) return "/Users/me/Pictures/cell-diagram.png";
        return opts?.directory ? "/Users/me/Documents/Lecture notes" : ["/Users/me/Documents/biology-notes.md"];
      }
      return null;
    }
    const h = (fixture && fixture[cmd]) || handlers[cmd];
    if (!h) err("other", `Mock backend has no command “${cmd}”`);
    // clone so callers never hold live references into the mock DB (React Query would miss in-place updates)
    const out = await h((args ?? {}) as Args);
    return out === undefined ? out : structuredClone(out);
  };
  // inside the real app (design fixture on the native window) Tauri's IPC object is read-only, so ipc.ts calls this directly
  try {
    mockIPC(handle, { shouldMockEvents: true });
  } catch {
    (window as unknown as { __MOCK_INVOKE__?: typeof handle }).__MOCK_INVOKE__ = handle;
  }

  const seedProvider = () => {
    const existing = Object.values(db.providers).find((p) => p.name === "Mock LM Studio");
    if (existing) return existing;
    const p: T.Provider = {
      id: "mock-lmstudio",
      type: "lmstudio",
      kind: "local",
      name: "Mock LM Studio",
      baseUrl: "http://mock.local:1234/v1",
      config: { models: ["mock-model"], defaultModel: "mock-model" },
      createdAt: now(),
    };
    db.providers[p.id] = p;
    db.settings.defaultModel = { providerId: p.id, model: "mock-model" };
    save();
    return p;
  };

  const seedOpenRouter = () => {
    const p: T.Provider = {
      id: "mock-openrouter",
      type: "openrouter",
      kind: "apiKey",
      name: "OpenRouter",
      baseUrl: null,
      config: { models: ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-4.5"], defaultModel: "deepseek/deepseek-v4.1-flash" },
      createdAt: now(),
    };
    db.providers[p.id] = p;
    save();
    return p;
  };

  const controls: MockControls = {
    emit: (event, payload) => emit(event, payload),
    reset: () => {
      db = emptyDb();
      save();
    },
    advance: (ms) => {
      db.clockOffset += ms;
      save();
      focusTick();
    },
    setScript: (fn) => {
      script = fn ?? (fixture ? fixtureScript(defaultScript) : defaultScript);
    },
    setStreamDelay: (ms) => {
      streamDelayMs = ms;
    },
    seedProvider,
    db: () => db,
    deepLink: (url) => {
      deepLinkQueue.push(url);
      void emit("deeplink://pending");
    },
  };
  (window as unknown as { __mock: MockControls }).__mock = controls;
  if (new URLSearchParams(location.search).has("seed")) seedProvider();
  if (new URLSearchParams(location.search).has("openrouter")) seedOpenRouter();
  if (new URLSearchParams(location.search).has("manymodels")) {
    const p = seedProvider();
    p.config = { ...p.config, models: ["mock-model", ...Array.from({ length: 11 }, (_, i) => `local-model-${i + 1}`)] };
    save();
  }
  if (new URLSearchParams(location.search).has("localqwen")) {
    const p = seedProvider();
    p.config = { ...p.config, models: ["mock-model", "qwen3.5-9b"] };
    save();
  }
  setInterval(focusTick, 1000);
}
