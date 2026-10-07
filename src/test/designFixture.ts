/**
 * Design fixture: seeds the in-memory mock backend with the sample data shown in
 * `design/App Screens.dc.html` and `design/Space Screen v2.dc.html`, with a frozen clock and
 * seeded randomness, so the app can be compared pixel-for-pixel with the artboards.
 *
 * Browser: `?fixture=design[&option=value…]`. Native app (mock IPC): `VITE_MOCK_IPC=1 VITE_FIXTURE=design bun run tauri dev`.
 *
 * Options (all optional):
 *   chat=plain|v2|card|none   plain (most artboards), v2 (screen 2: inline math + "Thought for 4 seconds"), card (screens 11-21: plain text, follow-ups, 12 sources), none (screen 38)
 *   spaces=all|none      none = screen 36
 *   cards=review|browse|none   review (14 due cards), browse (the four cards of screen 18), none (screen 37)
 *   curriculum=plan|practice   the topic lists differ between screens 20 and 4/12
 *   focus=none|work|break      running session (screens 2/24 work, 8/35 break)
 *   drive=1              Google Drive signed in (screen 30)
 *   sources=all|empty    empty = screen 38
 *
 * Things the mock has no field for are stored in extra properties on the rows or under
 * `settings["design.*"]`; nothing in Rust changes.
 */
import type * as T from "../lib/types";
import type { DB } from "./mockBackend";

export const FIXTURE_NOW = Date.UTC(2026, 8, 30, 14, 0, 0); // Wed 30 Sep 2026 14:00 UTC
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export interface FixtureOptions {
  chat: "plain" | "v2" | "card" | "none";
  spaces: "all" | "none";
  cards: "review" | "browse" | "none";
  curriculum: "plan" | "practice";
  focus: "none" | "work" | "break";
  drive: boolean;
  sources: "all" | "empty";
}

export function fixtureName(): string | null {
  try {
    const q = new URLSearchParams(location.search).get("fixture");
    if (q) return q;
  } catch {
    /* no location */
  }
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_FIXTURE ?? null;
}
export const isDesignFixture = () => fixtureName() === "design";

export function readOptions(search = location.search): FixtureOptions {
  const q = new URLSearchParams(search);
  const pick = <K extends string>(k: string, allowed: readonly K[], d: K): K => {
    const v = q.get(k) as K | null;
    return v && allowed.includes(v) ? v : d;
  };
  return {
    chat: pick("chat", ["plain", "v2", "card", "none"], "plain"),
    spaces: pick("spaces", ["all", "none"], "all"),
    cards: pick("cards", ["review", "browse", "none"], "browse"),
    curriculum: pick("curriculum", ["plan", "practice"], "plan"),
    focus: pick("focus", ["none", "work", "break"], "none"),
    drive: q.get("drive") === "1",
    sources: pick("sources", ["all", "empty"], "all"),
  };
}

/** Frozen Date and seeded Math.random / crypto.randomUUID. */
export function installDeterminism() {
  const Real = Date;
  let offset = 0;
  class FixedDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FIXTURE_NOW + offset);
      else super(...(args as [number]));
    }
    static now() {
      return FIXTURE_NOW + offset;
    }
  }
  (globalThis as unknown as { Date: DateConstructor }).Date = FixedDate as unknown as DateConstructor;
  (window as unknown as { __fixtureAdvance: (ms: number) => void }).__fixtureAdvance = (ms) => {
    offset += ms;
  };

  let a = 0x9e3779b9;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = rand;
  let n = 0;
  const uuid = () => {
    n++;
    const h = (n * 2654435761 >>> 0).toString(16).padStart(8, "0");
    return `${h}-0000-4000-8000-${n.toString(16).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
  };
  try {
    Object.defineProperty(crypto, "randomUUID", { value: uuid, configurable: true, writable: true });
  } catch {
    (crypto as unknown as { randomUUID: () => string }).randomUUID = uuid;
  }
}

const SP = {
  ged: "sp-ged",
  es: "sp-es",
  bio: "sp-bio",
  py: "sp-py",
  rob: "sp-rob",
  hist: "sp-hist",
} as const;
export const FIXTURE_IDS = { space: SP.ged, thread: "th-systems" } as const;

export const SPACES = [
  { id: SP.ged, name: "GED Math", icon: "calculator", recap: "Last session: systems of equations by substitution", sources: 12, opened: 2 * H },
  { id: SP.es, name: "Spanish A2", icon: "languages", recap: "Last chat: preterite vs. imperfect", sources: 5, opened: 1 * D },
  { id: SP.bio, name: "Biology", icon: "leaf", recap: "Last session: cell respiration, Krebs cycle", sources: 9, opened: 2 * D },
  { id: SP.py, name: "Python", icon: "code", recap: "Last chat: list comprehensions", sources: 7, opened: 4 * D },
  { id: SP.rob, name: "Robotics", icon: "bot", recap: "Last session: PID tuning on the line follower", sources: 3, opened: 6 * D },
  { id: SP.hist, name: "US History", icon: "landmark", recap: null, sources: 0, opened: null },
] as const;

export const THREADS = [
  { id: "th-practice-test", title: "Practice test 2 review", age: 3 * D, pinned: true },
  { id: "th-systems", title: "Systems of equations", age: 2 * H },
  { id: "th-graphing", title: "Graphing inequalities", age: 5 * H },
  { id: "th-slope", title: "Slope-intercept form", age: 1 * D },
  { id: "th-rates", title: "Word problems: rates", age: 4 * D },
  { id: "th-fractions", title: "Fractions refresher", age: 12 * D },
] as const;

export const SOURCES = [
  { id: "src-openstax", title: "OpenStax Algebra & Trigonometry", kind: "pdf", chars: 2_841_300, origin: "https://openstax.org/details/books/algebra-and-trigonometry-2e", on: true },
  { id: "src-guide", title: "GED Math Study Guide", kind: "pdf", chars: 412_880, origin: "~/Documents/GED/ged-math-study-guide.pdf", on: true },
  { id: "src-khan", title: "Khan Academy: Systems intro", kind: "youtube", chars: 18_240, origin: "https://www.youtube.com/watch?v=pAmGuFvIW2M", on: true },
  { id: "src-purple", title: "Purplemath: substitution", kind: "url", chars: 9_420, origin: "https://www.purplemath.com/modules/systsubs.htm", on: true },
  { id: "src-notes", title: "My notes, week 3", kind: "markdown", chars: 3_150, origin: null, on: true },
  { id: "src-test3", title: "Practice test 3", kind: "pdf", chars: 0, origin: "~/Documents/GED/practice-test-3.pdf", on: false },
] as const;

const OPENSTAX_TEXT = [
  "A system of linear equations consists of two or more linear equations made up of two or more variables such that all equations in the system are considered simultaneously.",
  "The substitution method is a good choice when one of the equations is already solved for one variable.",
  "To solve by elimination, we add the equations so that one variable is eliminated, then solve for the remaining variable.",
].join("\n\n");

export const MEMORY = [
  { id: "mem-1", text: "Preparing for the GED math test in March", origin: "tutor" as const, age: 9 * D },
  { id: "mem-2", text: "Finds word problems hard", origin: "user" as const, age: 12 * D },
];

export const JOURNAL = [
  { id: "jr-1", title: "Systems of equations", age: 2 * H, content: "25m focused. Worked through substitution vs. elimination, missed one sign. Next: word problems with two unknowns." },
  { id: "jr-2", title: "Slope-intercept form", age: 1 * D, content: "50m focused, 1 pause. Graphed lines from y = mx + b; comfortable now." },
  { id: "jr-3", title: "Practice test 2 review", age: 3 * D, content: "Reviewed 12 wrong answers. Most were rate problems." },
];

export const MISTAKES = [
  { id: "mk-1", q: "Solve y = 3x − 4, 2x + y = 11 for x", given: "x = 6", correct: "x = 3", topic: "Sign", age: 2 * D, resolved: false },
  { id: "mk-2", q: "A train goes 180 km in 2.5 h. Speed?", given: "72 km", correct: "72 km/h", topic: "Units", age: 4 * D, resolved: false },
  { id: "mk-3", q: "Slope of 2y = 4x + 6", given: "4", correct: "2", topic: "Method", age: 7 * D, resolved: false },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `mk-fixed-${i + 1}`,
    q: ["Simplify 3(x + 2) − x", "Solve 5x − 7 = 18", "Evaluate 2³ + 4²", "Convert 0.75 to a fraction", "Solve |x − 3| = 5", "Area of a circle with r = 4"][i],
    given: "—",
    correct: "—",
    topic: "Arithmetic",
    age: (10 + i) * D,
    resolved: true,
  })),
];

export const ABILITIES = [
  { key: "systems", title: "Systems of equations", skill: 72, n: 14 },
  { key: "slope", title: "Slope-intercept form", skill: 88, n: 9 },
  { key: "rates", title: "Word problems: rates", skill: 41, n: 6 },
];

const thetaOf = (pct: number) => Math.log(pct / 100 / (1 - pct / 100));

const CURRICULA: Record<FixtureOptions["curriculum"], { id: string; title: string; description: string; group: string }[]> = {
  plan: [
    { id: "linear", title: "Linear equations", description: "Solve one-variable linear equations", group: "Algebra" },
    { id: "systems", title: "Systems of equations", description: "Solve two equations in two unknowns", group: "Algebra" },
    { id: "rates", title: "Word problems: rates", description: "Rate, time and distance problems", group: "Algebra" },
    { id: "inequalities", title: "Inequalities", description: "Solve and graph inequalities", group: "Algebra" },
    { id: "volume", title: "Geometry: volume", description: "Volume of common solids", group: "Geometry" },
  ],
  practice: [
    { id: "systems", title: "Systems of equations", description: "Solve two equations in two unknowns", group: "Algebra" },
    { id: "slope", title: "Slope-intercept form", description: "Lines in y = mx + b form", group: "Algebra" },
    { id: "rates", title: "Word problems: rates", description: "Rate, time and distance problems", group: "Algebra" },
    { id: "inequalities", title: "Inequalities", description: "Solve and graph inequalities", group: "Algebra" },
  ],
};

const LEVELS: Record<string, T.TopicLevelValue> = { linear: "strong", systems: "ok", rates: "weak", inequalities: "unknown", volume: "unknown" };
const COVERAGE: Record<string, { similarity: number | null; keywordHits: number }> = {
  linear: { similarity: 0.82, keywordHits: 1 },
  systems: { similarity: 0.8, keywordHits: 1 },
  rates: { similarity: 0.55, keywordHits: 0 },
  inequalities: { similarity: 0.5, keywordHits: 0 },
  volume: { similarity: null, keywordHits: 0 },
  slope: { similarity: 0.8, keywordHits: 1 },
};

const COURSE_LESSONS = [
  "Prerequisites",
  "Equations and inequalities",
  "Functions",
  "Linear functions",
  "Polynomial functions",
  "Exponential functions",
  "Systems of equations",
  "Matrices",
  "Analytic geometry",
  "Sequences and series",
  "Probability",
  "Counting principles",
];

const CARDS_BROWSE = [
  { id: "c-sub", kind: "basic", front: "When should you solve a system by substitution?", back: "When one equation already has a variable on its own, or can get there in one step.", due: FIXTURE_NOW + 1 * D, state: 2, suspended: false },
  { id: "c-slope", kind: "basic", front: "What is the slope in y = mx + b?", back: "m", due: FIXTURE_NOW + 3 * D, state: 2, suspended: false },
  { id: "c-image", kind: "occlusion", front: "", back: "", due: FIXTURE_NOW - 1 * MIN, state: 2, suspended: false },
  { id: "c-image2", kind: "occlusion", front: "", back: "", due: FIXTURE_NOW - 1 * MIN, state: 2, suspended: false },
  { id: "c-image3", kind: "occlusion", front: "", back: "", due: FIXTURE_NOW - 1 * MIN, state: 2, suspended: false },
  { id: "c-elim", kind: "basic", front: "Elimination works when coefficients are…", back: "", due: FIXTURE_NOW + 5 * D, state: 2, suspended: true },
] as const;

const REVIEW_FIRST = [
  { front: "What is the slope in y = mx + b?", back: "m" },
  { front: "What does a negative slope look like?", back: "The line falls from left to right." },
  { front: "What is the y-intercept in y = mx + b?", back: "b" },
];

export const FIXTURE_QUIZ = {
  topic: "Systems of equations",
  questions: [
    { question: "What is the slope of y = 3x − 4?", options: ["3", "−4", "4", "−3"], answer: 0, explanation: "In y = mx + b the slope is m, here 3." },
    { question: "Which point lies on y = 2x + 1?", options: ["(0, 1)", "(1, 1)", "(2, 3)", "(3, 5)"], answer: 0, explanation: "At x = 0, y = 1." },
    { question: "What is x in 2x + 4 = 10?", options: ["3", "4", "5", "7"], answer: 0, explanation: "2x = 6, so x = 3." },
  ],
};

export const FIXTURE_PRACTICE = {
  question: "Solve the system. What is x?\n\n$$\n\\begin{gathered} y = 3x - 4 \\\\ 2x + y = 11 \\end{gathered}\n$$",
  answer: "3",
  solution: "Substitute $y = 3x - 4$ into $2x + y = 11$: $2x + 3x - 4 = 11$, so $5x = 15$ and $x = 3$.",
};

export const MICROSTEPS = [
  { text: "Reread the substitution example on page 412", minutes: 3, done: true },
  { text: "Solve one easy system by substitution", minutes: 5, done: true },
  { text: "Solve practice problem 2", minutes: 5, done: false },
  { text: "Check your steps with the step checker", minutes: 3, done: false },
  { text: "Try one word problem", minutes: 8, done: false },
];

export const PARKING = ["Email Ms. Reyes about the practice test", "Look up the GED test date"];

export const BREAK_MENU = ["Walk around", "Stretch", "Make tea", "Look out the window"];

export const DRIVE_ITEMS: T.CloudItem[] = [
  { id: "g-formula", name: "Math formula sheet", folder: false, mimeType: "application/pdf", size: 240 * 1024, modified: "2026-09-12T10:00:00Z", supported: true },
  { id: "g-week4", name: "Week 4 notes", folder: false, mimeType: "application/vnd.google-apps.document", size: null, modified: "2026-09-20T10:00:00Z", supported: true },
  { id: "g-answers", name: "Practice test answers", folder: false, mimeType: "application/pdf", size: Math.round(1.2 * 1024 * 1024), modified: "2026-09-28T10:00:00Z", supported: true },
  { id: "g-photo", name: "Class photo", folder: false, mimeType: "image/jpeg", size: Math.round(3.4 * 1024 * 1024), modified: "2026-08-30T10:00:00Z", supported: false },
];

export const LAN_SERVERS: T.LanServer[] = [
  { kind: "lmstudio", baseUrl: "http://192.168.1.20:1234/v1", models: ["qwen3.5-9b", "llama-3.2-3b"] },
  { kind: "ollama", baseUrl: "http://localhost:11434/v1", models: ["llama3.2", "qwen2.5", "mistral"] },
];

type Row = Record<string, unknown>;

export function seedDesignFixture(db: DB, o: FixtureOptions) {
  const at = (age: number) => FIXTURE_NOW - age;
  const x = <V extends object>(v: V, extra: Row = {}) => Object.assign(v, extra) as V;

  const spaces = o.spaces === "none" ? [] : SPACES;
  for (const s of spaces) {
    const ged = s.id === SP.ged;
    db.spaces[s.id] = x(
      {
        id: s.id,
        name: s.name,
        icon: s.icon,
        color: "slate",
        tutorStyle: ged ? "mixed" : "direct",
        strictGrounding: ged,
        modelOverride: null,
        createdAt: at(30 * D),
        updatedAt: s.opened === null ? at(30 * D) : at(s.opened),
        lastOpenedAt: s.opened === null ? null : at(s.opened),
        recap: s.recap,
      } as Omit<T.Space, "sourceCount">,
      {
        sourceCountOverride: ged && o.sources === "empty" ? 0 : s.sources,
        exam: ged ? "GED (all four subjects)" : null,
      },
    );
  }
  if (o.spaces === "none") return seedCommon(db, o, at, x);

  // providers: Sonnet 5.5 is the default model
  db.providers["prov-lmstudio"] = {
    id: "prov-lmstudio",
    type: "lmstudio",
    kind: "local",
    name: "LM Studio",
    baseUrl: "http://192.168.1.20:1234/v1",
    config: { models: ["qwen3.5-9b", "llama-3.2-3b"], defaultModel: "qwen3.5-9b" },
    createdAt: at(40 * D),
  };
  db.providers["prov-anthropic"] = {
    id: "prov-anthropic",
    type: "anthropic",
    kind: "apiKey",
    name: "Anthropic",
    baseUrl: null,
    config: { models: ["Sonnet 5.5", "Opus 5", "Haiku 5"], defaultModel: "Sonnet 5.5" },
    createdAt: at(39 * D),
  };
  db.providers["prov-chatgpt"] = {
    id: "prov-chatgpt",
    type: "chatgpt-oauth",
    kind: "oauth",
    name: "ChatGPT",
    baseUrl: null,
    config: { models: ["gpt-5"], defaultModel: "gpt-5", account: "me@example.com" },
    createdAt: at(38 * D),
  };
  db.secrets["prov-anthropic"] = true;
  db.oauth["prov-chatgpt"] = { providerId: "prov-chatgpt", state: "signedIn", account: "me@example.com", expiresAt: FIXTURE_NOW + 30 * D };
  db.settings.defaultModel = { providerId: "prov-anthropic", model: "Sonnet 5.5" };

  seedGed(db, o, at, x);
  seedCommon(db, o, at, x);
}

function seedGed(db: DB, o: FixtureOptions, at: (n: number) => number, x: <V extends object>(v: V, e?: Row) => V) {
  const sp = SP.ged;
  const spaceName = "GED Math";
  const empty = o.sources === "empty";

  if (!empty) {
    let chunkId = 1;
    for (const s of SOURCES) {
      const processing = s.id === "src-test3";
      db.sources[s.id] = {
        id: s.id,
        spaceId: sp,
        title: s.title,
        kind: s.kind,
        origin: s.origin,
        status: processing ? "processing" : "ready",
        error: null,
        summary:
          s.id === "src-openstax"
            ? "College algebra and trigonometry textbook. Chapter 7 covers systems of equations: graphing, substitution, elimination and matrices."
            : `Summary of ${s.title}.`,
        useInChat: s.on,
        progress: processing ? 0.4 : 1,
        charCount: s.chars,
        chunkCount: processing ? 0 : 3,
        createdAt: at((3 + SOURCES.findIndex((q) => q.id === s.id)) * D),
        updatedAt: at(2 * D),
      } as T.Source;
    }
    if (o.chat === "card") {
      for (let k = 1; k <= 7; k++) {
        db.sources[`src-extra-${k}`] = {
          id: `src-extra-${k}`,
          spaceId: sp,
          title: `Worksheet ${k}`,
          kind: "pdf",
          origin: null,
          status: "ready",
          error: null,
          summary: "Practice worksheet.",
          useInChat: true,
          progress: 1,
          charCount: 1200,
          chunkCount: 1,
          createdAt: at(k * H),
          updatedAt: at(k * H),
        } as T.Source;
      }
    }
    const pageOffset = 0;
    db.texts["src-openstax"] = { text: OPENSTAX_TEXT, pages: [[412, pageOffset]] };
    const paras = OPENSTAX_TEXT.split("\n\n");
    let off = 0;
    paras.forEach((p, i) => {
      db.chunks.push({ id: chunkId++, sourceId: "src-openstax", spaceId: sp, text: p, start: off, end: off + p.length, page: 412 });
      off += p.length + 2;
      void i;
    });
    const guide =
      "Elimination is the better choice when both equations are in standard form and a variable has matching or opposite coefficients.";
    db.texts["src-guide"] = { text: guide, pages: null };
    db.chunks.push({ id: chunkId++, sourceId: "src-guide", spaceId: sp, text: guide, start: 0, end: guide.length, page: null });
    db.nextId = chunkId;
  }

  if (o.chat !== "none") {
    for (const t of THREADS) {
      db.threads[t.id] = x(
        { id: t.id, spaceId: sp, title: t.title, createdAt: at(t.age + 10 * MIN), updatedAt: at(t.age) } as T.Thread,
        { pinned: "pinned" in t ? t.pinned : false },
      );
    }
    const v2 = o.chat === "v2";
    const card = o.chat === "card";
    const cite = (n: number, sourceId: string, title: string, chunkId: number, snippet: string): T.Citation => ({
      n,
      chunkId,
      sourceId,
      sourceTitle: title,
      start: 0,
      end: snippet.length,
      page: sourceId === "src-openstax" ? 412 : null,
      snippet,
    });
    const paras = OPENSTAX_TEXT.split("\n\n");
    const citations = empty
      ? null
      : [
          cite(1, "src-openstax", "OpenStax Algebra", 2, paras[1]),
          cite(2, "src-guide", "GED Study Guide", 3, paras[2]),
          cite(3, "src-guide", "GED Study Guide", 4, "Elimination is the better choice when both equations are in standard form."),
        ];
    db.messages["msg-user-1"] = {
      id: "msg-user-1",
      threadId: "th-systems",
      role: "user",
      content: "How do I know when to use substitution instead of elimination?",
      reasoning: null,
      citations: null,
      meta: null,
      status: "complete",
      error: null,
      createdAt: at(2 * H + 2 * MIN),
    };
    const first = v2
      ? "Use **substitution** when one equation already has a variable on its own, or can get there in one step, like $y = 2x + 1$. You plug that expression into the other equation and you're left with one unknown. [1][2]"
      : "Use **substitution** when one equation already has a variable on its own, or can get there in one step. You plug that expression into the other equation and you're left with one unknown. [1][2]";
    db.messages["msg-asst-1"] = {
      id: "msg-asst-1",
      threadId: "th-systems",
      role: "assistant",
      content: `${first}\n\nUse **elimination** when both equations are in standard form and a variable has matching or opposite coefficients, so adding the equations cancels it. [3]`,
      reasoning: v2 ? "Comparing when each method needs fewer steps." : null,
      citations,
      meta: { tutorStyle: "mixed", model: { providerId: "prov-anthropic", model: "Sonnet 5.5" }, thinking: v2, ...(v2 || card ? { ...(v2 ? { thinkingMs: 4000 } : {}), followUps: ["Why does substitution work?", "Show me when elimination is faster", "Give me a harder one"] } : {}) } as T.MessageMeta,
      status: "complete",
      error: null,
      createdAt: at(2 * H),
    };
    if (v2) {
      const item = (id: string, kind: T.PracticeItem["kind"]): T.PracticeItem => ({
        id,
        topicKey: "free:Systems of equations",
        kind,
        question: "Which method fits best, and what's $x$?\n$$\\begin{cases} y = 3x - 4 \\\\ 2x + y = 11 \\end{cases}$$",
        options: null,
        answer: "3",
        solution: "Substitute y into the second equation.",
        difficulty: 0,
        parentId: null,
        hint: "Replace y in the second equation.",
        createdAt: at(2 * H),
      });
      db.messages["msg-practice-1"] = {
        id: "msg-practice-1",
        threadId: "th-systems",
        role: "practice",
        content: "",
        reasoning: null,
        citations: null,
        meta: {
          practice: {
            answerId: "msg-asst-1",
            topicKey: "free:Systems of equations",
            topicTitle: "Systems of equations",
            items: [item("pi-1", "numeric"), item("pi-2", "numeric")],
            index: 1,
            results: ["right"],
            total: 3,
          },
        },
        status: "complete",
        error: null,
        createdAt: at(2 * H - MIN),
      };
    }
    db.settings["design.followUps"] = ["Why does substitution work?", "Show me when elimination is faster", "Give me a harder one"];
    db.settings["design.practiceCard"] = { index: 2, of: 3, question: "Which method fits best, and what's $x$?", system: ["y = 3x - 4", "2x + y = 11"] };
  }

  db.journal = {};
  for (const j of JOURNAL) {
    db.journal[j.id] = { id: j.id, spaceId: sp, kind: "focus", title: j.title, content: j.content, createdAt: at(j.age) };
  }

  for (const m of MEMORY) {
    db.memory[m.id] = { id: m.id, text: m.text, origin: m.origin, spaceId: null, createdAt: at(m.age), updatedAt: at(m.age) };
  }

  for (const m of MISTAKES) {
    db.mistakes[m.id] = {
      id: m.id,
      spaceId: sp,
      origin: "quiz",
      question: m.q,
      given: m.given,
      correct: m.correct,
      explanation: null,
      topic: m.topic,
      cardId: null,
      resolved: m.resolved,
      createdAt: at(m.age),
      errorType: null,
    };
  }

  for (const a of ABILITIES) {
    db.abilities[sp] ??= {};
    db.abilities[sp][a.key] = { topicKey: a.key, topicTitle: a.title, theta: thetaOf(a.skill), n: a.n, updatedAt: at(2 * D) };
  }
  const attempts: [string, string, string, number][] = [
    ...Array.from({ length: 3 }, (): [string, string, string, number] => ["systems", "Systems of equations", "sign", 2 * D]),
    ...Array.from({ length: 2 }, (): [string, string, string, number] => ["inequalities", "Inequalities", "sign", 3 * D]),
    ...Array.from({ length: 3 }, (): [string, string, string, number] => ["rates", "Word problems: rates", "arithmetic", 4 * D]),
    ...Array.from({ length: 2 }, (): [string, string, string, number] => ["rates", "Word problems: rates", "misread", 7 * D]),
  ];
  db.attempts = attempts.map(([topicKey, topicTitle, errorType, age], i) => ({
    itemId: `item-${i}`,
    topicKey,
    topicTitle,
    response: "0",
    correct: false,
    thetaBefore: 0,
    thetaAfter: 0,
    errorType: errorType as T.ErrorType,
    spaceId: sp,
    at: at(age),
  }));

  const topics = CURRICULA[o.curriculum];
  db.curricula[sp] = {
    spaceId: sp,
    curriculumId: "ged-all",
    title: "GED (all four subjects)",
    topics: topics.map((t) => ({ id: t.id, title: t.title, description: t.description, group: t.group })),
    updatedAt: at(10 * D),
  };
  db.levels[sp] = {};
  for (const t of CURRICULA.plan) {
    db.levels[sp][t.id] = { topicId: t.id, level: LEVELS[t.id], evidence: null, updatedAt: at(3 * D) };
  }

  if (!empty) {
    const cid = "course-openstax";
    db.courses[cid] = {
      id: cid,
      spaceId: sp,
      sourceId: "src-openstax",
      title: "OpenStax Algebra & Trigonometry",
      createdAt: at(15 * D),
      lessons: COURSE_LESSONS.map((title, i) => ({
        id: `les-${i + 1}`,
        courseId: cid,
        ord: i,
        title,
        startOffset: 0,
        endOffset: 100,
        status: i < 3 ? "done" : i === 3 ? "doing" : "todo",
        score: i < 3 ? 0.9 : null,
        completedAt: i < 3 ? at((10 - i) * D) : null,
      })),
    };
    db.assessments["as-slope-quiz"] = {
      id: "as-slope-quiz",
      spaceId: sp,
      kind: "lesson",
      topicId: "slope",
      title: "Slope-intercept quiz",
      questions: FIXTURE_QUIZ.questions.map((q) => ({ ...q, topicId: "slope" })),
      answers: [0, 0, 0],
      score: 1,
      createdAt: at(3 * H),
      completedAt: at(3 * H),
    };
    db.settings["design.recent"] = [
      { title: "Linear systems", kind: "flashcards", at: at(4 * H) },
      { title: "Slope-intercept quiz", kind: "quiz", at: at(3 * H) },
      { title: "Study Guide ch. 6 summary", kind: "summary", at: at(1 * D) },
    ];
    db.settings["design.studyPlan"] = { week: 3, of: 8 };
    db.settings["design.courseDone"] = 62;
  }

  db.watched["w-ged"] = { id: "w-ged", spaceId: sp, path: "~/Documents/GED", recursive: true, createdAt: at(20 * D), fileCount: 14, status: "watching", error: null };
  db.watched["w-lect"] = { id: "w-lect", spaceId: sp, path: "~/Downloads/Lectures", recursive: true, createdAt: at(1 * H), fileCount: 0, status: "scanning", error: null };

  seedCards(db, o, at, spaceName);
  seedFocus(db, o, at);
}

function seedCards(db: DB, o: FixtureOptions, at: (n: number) => number, spaceName: string) {
  const sp = SP.ged;
  const mk = (id: string, spaceId: string, name: string, c: Partial<T.Card>): T.Card => ({
    id,
    spaceId,
    kind: "basic",
    front: "",
    back: "",
    data: null,
    sourceId: null,
    chunkStart: null,
    chunkEnd: null,
    origin: "manual",
    suspended: false,
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    due: FIXTURE_NOW,
    state: 2,
    fsrs: null,
    spaceName: name,
    ...c,
  });
  if (o.cards === "browse") {
    CARDS_BROWSE.forEach((c, i) => {
      db.cards[c.id] = mk(c.id, sp, spaceName, {
        kind: c.kind,
        front: c.front,
        back: c.back,
        due: c.due,
        state: c.state,
        suspended: c.suspended,
        createdAt: at(i * H),
        data: c.kind === "occlusion" ? { image: "cell.svg", masks: [0, 1, 2].map((k) => ({ id: `m${k}`, x: 0.1 + k * 0.25, y: 0.3, w: 0.2, h: 0.12 })), mask: `m${c.id === "c-image" ? 0 : c.id === "c-image2" ? 1 : 2}` } : null,
      });
    });
  }
  if (o.cards === "review") {
    const due = (i: number) => FIXTURE_NOW - (60 - i) * MIN;
    REVIEW_FIRST.forEach((c, i) => {
      db.cards[`c-r${i}`] = mk(`c-r${i}`, sp, spaceName, { front: c.front, back: c.back, due: due(i), createdAt: at(i * H) });
    });
    db.cards["c-sub"] = mk("c-sub", sp, spaceName, {
      front: "When should you solve a system by substitution?",
      back: "When one equation already has a variable on its own, or can get there in one step.",
      due: due(3),
      sourceId: "src-openstax",
      chunkStart: 0,
      chunkEnd: 100,
    });
    for (let i = 4; i < 8; i++) db.cards[`c-g${i}`] = mk(`c-g${i}`, sp, spaceName, { front: `GED review card ${i + 1}`, back: "Answer", due: due(i) });
    for (let i = 0; i < 4; i++) db.cards[`c-es${i}`] = mk(`c-es${i}`, SP.es, "Spanish A2", { front: `Spanish card ${i + 1}`, back: "Respuesta", due: due(10 + i) });
    for (let i = 0; i < 3; i++) db.cards[`c-b${i}`] = mk(`c-b${i}`, SP.bio, "Biology", { front: `Biology card ${i + 1}`, back: "Answer", due: due(20 + i) });
  }
}

function seedFocus(db: DB, o: FixtureOptions, at: (n: number) => number) {
  const sp = SP.ged;
  const past = (id: string, ageMs: number, focusMs: number, pauses: number) => {
    db.sessions[id] = {
      id,
      spaceId: sp,
      technique: "pomodoro",
      goal: null,
      startedAt: at(ageMs),
      endedAt: at(ageMs) + focusMs + 5 * MIN,
      focusMs,
      breakMs: 5 * MIN,
      pauses,
      summary: null,
    };
  };
  past("fs-yesterday", 1 * D + 2 * H, 50 * MIN, 1);
  past("fs-mon", 2 * D + 3 * H, 25 * MIN, 0);

  if (o.focus === "none") return;
  const onBreak = o.focus === "break";
  const sessionId = "fs-now";
  const workMs = 25 * MIN;
  const elapsed = onBreak ? 48_000 : 6 * MIN + 18_000;
  const phaseStartedAt = FIXTURE_NOW - elapsed;
  db.focus = {
    sessionId,
    spaceId: sp,
    technique: "pomodoro",
    goal: null,
    workMs,
    breakMs: 5 * MIN,
    longBreakMs: 15 * MIN,
    cyclesBeforeLong: 4,
    checkInMins: 0,
    energy: "normal",
    startedAt: phaseStartedAt - (onBreak ? workMs + 25 * MIN + 5 * MIN : 25 * MIN + 5 * MIN),
    phase: onBreak ? "break" : "work",
    block: onBreak ? 2 : 2,
    phaseStartedAt,
    phaseDurationMs: onBreak ? 5 * MIN : workMs,
    pausedAt: null,
    pausedTotal: 0,
    pauseReason: null,
    pauseCount: 0,
    needAppCount: 0,
    focusDoneMs: onBreak ? 2 * workMs : workMs,
    breakDoneMs: 5 * MIN,
  };
  db.sessions[sessionId] = {
    id: sessionId,
    spaceId: sp,
    technique: "pomodoro",
    goal: null,
    startedAt: db.focus.startedAt,
    endedAt: null,
    focusMs: db.focus.focusDoneMs,
    breakMs: db.focus.breakDoneMs,
    pauses: 0,
    summary: null,
  };
  PARKING.forEach((text, i) => {
    db.parking[`pk-${i}`] = { id: `pk-${i}`, sessionId, spaceId: sp, text, resolved: false, createdAt: at((30 - i) * MIN) };
  });
}

function seedCommon(db: DB, o: FixtureOptions, at: (n: number) => number, _x: <V extends object>(v: V, e?: Row) => V) {
  db.settings["focus.hyperfocus"] = { enabled: true, minutes: 90 };
  db.settings["focus.breakMenu"] = BREAK_MENU;
  db.settings["reading.aids"] = { bionic: false, ruler: true };
  db.settings["focus.music"] = { enabled: false, playlist: "" };
  db.settings.quickCaptureEnabled = true;
  db.settings.quickCaptureShortcut = "Alt+Space";

  if (o.spaces !== "none") {
    MICROSTEPS.forEach((m, i) => {
      db.microSteps[`ms-${i}`] = {
        id: `ms-${i}`,
        spaceId: SP.ged,
        sessionId: null,
        goal: "Practice problems, systems of equations",
        text: m.text,
        minutes: m.minutes,
        done: m.done,
        position: i,
        createdAt: at(20 * MIN),
      };
    });
  }
  if (o.drive) db.cloud.google = { clientId: "design-client.apps.googleusercontent.com", hasSecret: true, state: "signedIn", account: "me@example.com", error: null };
}

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="552" height="358"><text x="276" y="184" font-family="IBM Plex Sans, sans-serif" font-size="13" fill="#8a8a8a" text-anchor="middle">Your image</text></svg>',
  );

type Args = Record<string, unknown>;

/** Handlers that replace the mock's own when the fixture is active. */
export function fixtureOverrides(): Record<string, (a: Args) => unknown> {
  return {
    cards_due_counts: () => {
      const o = readOptions();
      if (o.cards === "none" || o.spaces === "none") return [];
      return [
        { spaceId: SP.ged, spaceName: "GED Math", due: 8, new: 4, total: 52 },
        { spaceId: SP.es, spaceName: "Spanish A2", due: 1, new: 0, total: 30 },
        { spaceId: SP.bio, spaceName: "Biology", due: 1, new: 0, total: 41 },
      ];
    },
    topic_coverage: (a) =>
      (a.topics as { id: string }[]).map((t) => ({
        topicId: t.id,
        similarity: COVERAGE[t.id]?.similarity ?? null,
        keywordHits: COVERAGE[t.id]?.keywordHits ?? 0,
        best: null,
      })),
    image_store: () => "your-image.svg",
    image_read: () => PLACEHOLDER_IMAGE,
    lan_scan: () => LAN_SERVERS,
    cloud_list: () => ({ items: DRIVE_ITEMS, nextPageToken: null }),
    oauth_xai_device_start: () => ({
      userCode: "WDJB-MJHT",
      verificationUri: "https://accounts.x.ai/device",
      verificationUriComplete: "https://accounts.x.ai/device?user_code=WDJB-MJHT",
      expiresIn: 14 * 60,
    }),
  };
}

type Script = (req: { messages: { role: string; content: unknown }[]; body: Record<string, unknown> }) => { reasoning?: string; content: string };

/** LLM replies that produce the artboards' quiz and practice problem; everything else falls through. */
export function fixtureScript(fallback: Script): Script {
  return (req) => {
    const last = req.messages[req.messages.length - 1];
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
    if (/multiple-choice quiz/i.test(text)) {
      const tid = text.match(/id \\?"([^"\\]+)\\?"/)?.[1] ?? null;
      // the app shuffles options with the seeded random; this pre-order shows 3, −4, 4, −3
      const qs = FIXTURE_QUIZ.questions.map((q, i) => (i === 0 ? { ...q, options: ["−4", "4", "3", "−3"], answer: 2 } : q));
      return { content: JSON.stringify(qs.map((q) => ({ ...q, topicId: tid }))) };
    }
    if (/Write ONE (practice|new) problem/i.test(text)) {
      return { content: JSON.stringify({ kind: "numeric", ...FIXTURE_PRACTICE, level: 3 }) };
    }
    if (/Solve this problem carefully/i.test(text)) return { content: `{"answer": ${FIXTURE_PRACTICE.answer}}` };
    if (/Classify the most likely mistake/i.test(text)) return { content: JSON.stringify({ errorType: "sign", note: "" }) };
    return fallback(req);
  };
}
