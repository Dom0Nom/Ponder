/**
 * In-memory implementation of every Tauri command, installed when the UI runs outside Tauri
 * (plain browser, Playwright). State is snapshotted to localStorage so reloads behave like the
 * real app. `window.__mock` exposes test hooks (clock control, LLM script, reset).
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type * as T from "../lib/types";

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

interface DB {
  spaces: Row<Omit<T.Space, "sourceCount">>;
  sources: Row<T.Source>;
  texts: Row<T.SourceText>;
  chunks: MockChunk[];
  threads: Row<T.Thread>;
  messages: Row<T.Message>;
  journal: Row<T.JournalEntry>;
  providers: Row<T.Provider>;
  secrets: Record<string, true>;
  settings: Record<string, unknown>;
  focus: MockFocus | null;
  sessions: Row<T.FocusSessionSummary>;
  focusEvents: T.FocusEvent[];
  parking: Row<T.ParkingItem>;
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
  phase: T.FocusPhase;
  block: number;
  phaseStartedAt: number;
  phaseDurationMs: number | null;
  pausedAt: number | null;
  pausedTotal: number;
  pauseReason: "user" | "needApp" | null;
  pauseCount: number;
  needAppCount: number;
  totalFocusMs: number;
  totalBreakMs: number;
}

const STORAGE_KEY = "mock-backend-db";

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
    settings: {},
    focus: null,
    sessions: {},
    focusEvents: [],
    parking: {},
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
  return { ...sp, sourceCount: Object.values(db.sources).filter((x) => x.spaceId === sp.id).length };
}

// ---------- fake LLM ----------

type Script = (req: { messages: { role: string; content: unknown }[]; body: Record<string, unknown> }) => {
  reasoning?: string;
  content: string;
};

const defaultScript: Script = ({ messages, body }) => {
  const sys = messages.find((m) => m.role === "system");
  const sysText = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content ?? "");
  const last = messages[messages.length - 1];
  const lastText = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
  if (body.response_format || /Respond with JSON|Return JSON/i.test(sysText + lastText)) {
    return { content: "{}" };
  }
  if (/Summarize this source/i.test(lastText)) {
    return { content: "A short overview of the source's main ideas." };
  }
  const hasSources = /\[1\]/.test(sysText);
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

async function httpStream(request: T.ProxyRequest, channel: { id: number }) {
  let i = 0;
  const send = (m: T.ProxyEvent) => sendChannel(channel, i++, m);
  const url = new URL(request.url);
  if (request.providerId && !db.providers[request.providerId]) {
    send({ type: "error", message: "Unknown provider" });
    return;
  }
  if (url.pathname.endsWith("/models")) {
    send({ type: "head", status: 200, headers: { "content-type": "application/json" } });
    send({ type: "chunk", data: JSON.stringify({ data: [{ id: "mock-model" }, { id: "mock-model-2" }] }) });
    send({ type: "end" });
    return;
  }
  const body = JSON.parse(request.body ?? "{}");
  const reply = script({ messages: body.messages ?? [], body });
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
  for (const w of reply.content.split(/(?<= )/)) pieces.push(chunk({ content: w }));
  pieces.push(chunk({}, "stop"));
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
    }));
}

// ---------- focus ----------

function focusDefaults(cfg: T.FocusConfig) {
  switch (cfg.technique) {
    case "pomodoro":
      return { work: cfg.workMins ?? 25, brk: cfg.breakMins ?? 5, long: cfg.longBreakMins ?? 15 };
    case "52-17":
      return { work: 52, brk: 17, long: 17 };
    case "flowtime":
      return { work: null, brk: 0, long: 0 };
    default:
      return { work: cfg.workMins ?? 30, brk: cfg.breakMins ?? 5, long: cfg.longBreakMins ?? cfg.breakMins ?? 5 };
  }
}

function logFocus(kind: string, data: Record<string, unknown> | null = null) {
  if (!db.focus) return;
  db.focusEvents.push({ id: db.nextId++, sessionId: db.focus.sessionId, kind, at: now(), data });
}

function elapsed(f: MockFocus, t = now()): number {
  const pausedNow = f.pausedAt ? t - f.pausedAt : 0;
  return Math.max(0, t - f.phaseStartedAt - f.pausedTotal - pausedNow);
}

function focusSnapshot(): T.FocusState | null {
  const f = db.focus;
  if (!f) return null;
  const el = elapsed(f);
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
    totalFocusMs: f.totalFocusMs + (f.phase === "work" ? el : 0),
    totalBreakMs: f.totalBreakMs + (f.phase !== "work" ? el : 0),
    checkInMins: f.checkInMins,
    now: now(),
  };
}

function startPhase(f: MockFocus, phase: T.FocusPhase, durationMs: number | null) {
  const from = f.phase;
  const el = elapsed(f);
  if (from === "work") f.totalFocusMs += el;
  else f.totalBreakMs += el;
  f.phase = phase;
  f.phaseStartedAt = now();
  f.phaseDurationMs = durationMs;
  f.pausedAt = null;
  f.pausedTotal = 0;
  f.pauseReason = null;
  logFocus("phase", { from, to: phase });
  save();
  const st = focusSnapshot()!;
  emit("focus://transition", { from, to: phase, state: st });
}

function focusTick() {
  const f = db.focus;
  if (f && f.phaseDurationMs != null && f.pausedAt == null && elapsed(f) >= f.phaseDurationMs) {
    if (f.phase === "work") {
      const long = f.technique === "pomodoro" && f.block % f.cyclesBeforeLong === 0;
      startPhase(f, long ? "longBreak" : "break", long ? f.longBreakMs : f.breakMs);
    } else {
      f.block += 1;
      startPhase(f, "work", f.workMs);
    }
  }
  emit("focus://tick", focusSnapshot());
}

function endSession(): T.FocusSessionSummary {
  const f = db.focus;
  if (!f) err("invalid", "No focus session is running");
  const st = focusSnapshot()!;
  logFocus("end");
  const summary: T.FocusSessionSummary = {
    ...db.sessions[f.sessionId],
    endedAt: now(),
    focusMs: st.totalFocusMs,
    breakMs: st.totalBreakMs,
    pauses: f.pauseCount,
  };
  db.sessions[f.sessionId] = summary;
  db.focus = null;
  save();
  emit("focus://transition", { from: st.phase, to: "done", state: { ...st, phase: "done" } });
  emit("focus://tick", null);
  return summary;
}

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
    db.chunks = db.chunks.filter((c) => c.sourceId !== a.id);
    save();
    return null;
  },
  get_source_text: (a) => db.texts[a.id as string] ?? err("not_found", "source text not found"),
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
  embedder_status: () => ({ state: "ready", progress: 1, error: null }),

  list_threads: (a) =>
    Object.values(db.threads)
      .filter((t) => t.spaceId === a.spaceId)
      .sort((x, y) => y.updatedAt - x.updatedAt),
  create_thread: (a) => {
    const t: T.Thread = { id: id(), spaceId: a.spaceId as string, title: (a.title as string) ?? "New chat", createdAt: now(), updatedAt: now() };
    db.threads[t.id] = t;
    save();
    return t;
  },
  rename_thread: (a) => {
    const t = db.threads[a.id as string] ?? err("not_found", "thread not found");
    t.title = (a.title as string).trim() || err("invalid", "Title can't be empty");
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
  get_settings: () => db.settings,
  set_setting: (a) => {
    if (a.value === null) delete db.settings[a.key as string];
    else db.settings[a.key as string] = a.value;
    save();
    return null;
  },

  list_providers: () => Object.values(db.providers).sort((a, b) => a.createdAt - b.createdAt),
  save_provider: (a) => {
    const p = { ...(a.provider as T.Provider) };
    if (!p.name?.trim()) err("invalid", "Provider name can't be empty");
    if (!p.id) p.id = id();
    if (!p.createdAt) p.createdAt = now();
    db.providers[p.id] = p;
    save();
    return p;
  },
  delete_provider: (a) => {
    delete db.providers[a.id as string];
    delete db.secrets[a.id as string];
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
  lan_scan: () => [{ kind: "lmstudio", baseUrl: "http://192.168.1.50:1234/v1", models: ["mock-model"] }],
  oauth_status: (a) => ({ providerId: a.providerId, state: "signedOut" }),
  oauth_chatgpt_start: () => err("other", "OAuth isn't available in the browser preview"),
  oauth_xai_device_start: () => err("other", "OAuth isn't available in the browser preview"),
  oauth_sign_out: () => null,

  http_stream: (a) => {
    httpStream(a.request as T.ProxyRequest, a.onEvent as { id: number });
    return null;
  },
  http_abort: (a) => {
    aborted.add(a.id as string);
    return null;
  },
  http_get_text: (a) => {
    const url = a.url as string;
    return {
      status: 200,
      url,
      contentType: "text/html",
      body: `<html><head><title>Mock page</title></head><body><article><h1>Mock page</h1><p>This page talks about photosynthesis in detail. Chlorophyll absorbs light.</p><p>A second paragraph with more content so Readability accepts it as an article body worth keeping.</p></article></body></html>`,
    };
  },

  focus_start: (a) => {
    if (db.focus) err("invalid", "A focus session is already running");
    const cfg = a.config as T.FocusConfig;
    const d = focusDefaults(cfg);
    const sessionId = id();
    db.focus = {
      sessionId,
      spaceId: cfg.spaceId ?? null,
      technique: cfg.technique,
      goal: cfg.goal ?? null,
      workMs: d.work == null ? null : d.work * 60_000,
      breakMs: d.brk * 60_000,
      longBreakMs: d.long * 60_000,
      cyclesBeforeLong: cfg.cyclesBeforeLong ?? 4,
      checkInMins: cfg.checkInMins ?? 0,
      phase: "work",
      block: 1,
      phaseStartedAt: now(),
      phaseDurationMs: d.work == null ? null : d.work * 60_000,
      pausedAt: null,
      pausedTotal: 0,
      pauseReason: null,
      pauseCount: 0,
      needAppCount: 0,
      totalFocusMs: 0,
      totalBreakMs: 0,
    };
    db.sessions[sessionId] = {
      id: sessionId,
      spaceId: cfg.spaceId ?? null,
      technique: cfg.technique,
      goal: cfg.goal ?? null,
      startedAt: now(),
      endedAt: null,
      focusMs: 0,
      breakMs: 0,
      pauses: 0,
      summary: null,
    };
    logFocus("start", { technique: cfg.technique, goal: cfg.goal ?? null });
    save();
    const st = focusSnapshot()!;
    emit("focus://transition", { from: "done", to: "work", state: st });
    return st;
  },
  focus_state: () => focusSnapshot(),
  focus_pause: () => {
    const f = db.focus ?? err("invalid", "No focus session is running");
    if (f.phase !== "work") err("invalid", "Breaks can only be paused with “I need the app”");
    if (!f.pausedAt) {
      f.pausedAt = now();
      f.pauseReason = "user";
      f.pauseCount++;
      logFocus("pause", { reason: "user" });
    }
    save();
    return focusSnapshot();
  },
  focus_resume: () => {
    const f = db.focus ?? err("invalid", "No focus session is running");
    if (f.pausedAt) {
      f.pausedTotal += now() - f.pausedAt;
      f.pausedAt = null;
      f.pauseReason = null;
      logFocus("resume");
    }
    save();
    return focusSnapshot();
  },
  focus_need_app: (a) => {
    const f = db.focus ?? err("invalid", "No focus session is running");
    if (f.phase === "work") err("invalid", "Not on a break");
    if (!f.pausedAt) {
      f.pausedAt = now();
      f.pauseReason = "needApp";
      f.pauseCount++;
      f.needAppCount++;
      logFocus("need_app_pause", { reason: a.reason ?? null });
    }
    save();
    const st = focusSnapshot();
    emit("focus://tick", st);
    return st;
  },
  focus_end_work: () => {
    const f = db.focus ?? err("invalid", "No focus session is running");
    if (f.phase !== "work") err("invalid", "Not in a focus block");
    const el = elapsed(f);
    const brk = f.technique === "flowtime" ? Math.max(60_000, Math.round(el / 5)) : f.breakMs;
    startPhase(f, "break", brk);
    return focusSnapshot();
  },
  focus_stop: () => endSession(),
  focus_set_summary: (a) => {
    const sess = db.sessions[a.sessionId as string];
    if (sess) sess.summary = a.summary as string;
    save();
    return null;
  },
  focus_history: (a) =>
    Object.values(db.sessions)
      .filter((x) => !a.spaceId || x.spaceId === a.spaceId)
      .sort((x, y) => y.startedAt - x.startedAt),
  focus_events: (a) => db.focusEvents.filter((e) => e.sessionId === a.sessionId),
  parking_add: (a) => {
    const text = (a.text as string).trim();
    if (!text) err("invalid", "Nothing to park");
    const item: T.ParkingItem = {
      id: id(),
      sessionId: db.focus?.sessionId ?? null,
      spaceId: db.focus?.spaceId ?? null,
      text,
      resolved: false,
      createdAt: now(),
    };
    db.parking[item.id] = item;
    logFocus("parking", { text });
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
};

export interface MockControls {
  reset: () => void;
  /** move the mock clock forward and run a timer tick */
  advance: (ms: number) => void;
  setScript: (fn: Script | null) => void;
  setStreamDelay: (ms: number) => void;
  seedProvider: () => T.Provider;
  db: () => DB;
}

export function installMockBackend() {
  load();
  mockIPC(
    async (cmd, args) => {
      if (cmd.startsWith("plugin:")) {
        if (cmd === "plugin:dialog|open") return ["/Users/me/Documents/biology-notes.md"];
        return null;
      }
      const h = handlers[cmd];
      if (!h) err("other", `Mock backend has no command “${cmd}”`);
      return h((args ?? {}) as Args);
    },
    { shouldMockEvents: true },
  );

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

  const controls: MockControls = {
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
      script = fn ?? defaultScript;
    },
    setStreamDelay: (ms) => {
      streamDelayMs = ms;
    },
    seedProvider,
    db: () => db,
  };
  (window as unknown as { __mock: MockControls }).__mock = controls;
  if (new URLSearchParams(location.search).has("seed")) seedProvider();
  setInterval(focusTick, 1000);
}
