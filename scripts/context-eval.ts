/**
 * Context eval: the old chat pipeline (last message → 8 passages, last 12 turns) against the new
 * context builder (src/lib/context), on a copy of real spaces, with the same answer model.
 *
 *   OPENROUTER_API_KEY=… bun scripts/context-eval.ts --data <copy of a data folder> [--only id,id] [--pipelines old,new] [--out FILE]
 *
 * Needs a debug build (`cd src-tauri && cargo build`): the script starts `ponder dev-serve` on the
 * copy for real hybrid search and source reads. Scores: source recall (expected sources/pages in
 * what the model saw), answer correctness and citation validity (claude-haiku-4.5 judge), prompt
 * tokens, cost and latency. Never point --data at the live data folder.
 */
import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveModel } from "./lib/liveModel";
import type { Message, OpenRouterModel, SearchHit, Thread } from "../src/lib/types";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const data = flag("data");
if (!data || !existsSync(resolve(data, "app.db"))) throw new Error("--data <copy of a data folder with app.db>");
if (resolve(data).includes("Application Support/dev.ponder.app")) throw new Error("--data must be a copy, not the live data folder");
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required (this script never uses LM Studio)");
const only = flag("only")?.split(",");
const pipelines = (flag("pipelines") ?? "old,new").split(",");
const out = flag("out") ?? "context-eval.json";
const PORT = Number(flag("port") ?? 1499);

// ---------- backend: dev-serve on the copy ----------
const server = spawn(resolve("src-tauri/target/debug/ponder"), ["dev-serve", "--data", resolve(data), "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((ok, fail) => {
  server.stdout!.on("data", (b: Buffer) => b.toString().includes("ready") && ok());
  server.on("exit", (c) => fail(new Error(`dev-serve exited ${c}`)));
  setTimeout(() => fail(new Error("dev-serve didn't start")), 120_000);
});
process.on("exit", () => server.kill());

let orModels: OpenRouterModel[] | null = null;
const threads = new Map<string, Thread>();
const local: Record<string, (a: Record<string, unknown>) => unknown> = {
  list_memory: () => [],
  list_providers: () => [],
  list_openrouter_models: async () => {
    if (!orModels) {
      const j = (await (await fetch("https://openrouter.ai/api/v1/models")).json()) as { data: Record<string, unknown>[] };
      orModels = j.data.map((m) => {
        const p = m.pricing as Record<string, string>;
        return {
          id: m.id as string,
          name: m.name as string,
          contextLength: (m.context_length as number) ?? null,
          supportedParameters: (m.supported_parameters as string[]) ?? [],
          created: null,
          pricing: { prompt: +p.prompt, completion: +p.completion, cacheRead: p.input_cache_read ? +p.input_cache_read : null },
          maxOutput: ((m.top_provider as Record<string, number>)?.max_completion_tokens as number) ?? null,
        };
      });
    }
    return { fetchedAt: Date.now(), models: orModels };
  },
  save_thread_summary: (a) => {
    const t = { ...threads.get(a.threadId as string)!, summary: a.summary as string, summaryUntil: a.until as number };
    threads.set(t.id, t);
    return t;
  },
};
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { __MOCK_INVOKE__: unknown }).__MOCK_INVOKE__ = async (cmd: string, a: Record<string, unknown> = {}) => {
  if (local[cmd]) return local[cmd](a);
  const r = (await (await fetch(`http://127.0.0.1:${PORT}/${cmd}`, { method: "POST", body: JSON.stringify(a) })).json()) as { ok?: unknown; error?: { message: string } };
  if (r.error) throw r.error;
  return r.ok;
};

const { api } = await import("../src/lib/ipc");
const { buildContext, contextMessages } = await import("../src/lib/context/build");
const { buildSystemPrompt, historyMessages } = await import("../src/lib/chat/context");
const { passagesFrom } = await import("../src/lib/chat/runner");
const { hitsToCitations, citedNumbers } = await import("../src/lib/chat/citations");
const { fitHistory, compactionCut } = await import("../src/lib/context/history");
const { compactThread } = await import("../src/lib/context/compact");
const { splitBudget } = await import("../src/lib/context/budget");
const { modelLimits } = await import("../src/lib/context/window");

const spaces = (await api.listSpaces()) as { id: string; name: string }[];
const spaceId = (name: string) => spaces.find((s) => s.name === name)!.id;
const answerModel = liveModel(flag("model") ?? "deepseek/deepseek-v4.1-flash");
const judge = liveModel("anthropic/claude-haiku-4.5");

// ---------- cases ----------
interface Case {
  id: string;
  space: "GED" | "Robotics" | "C";
  lang: "en" | "de";
  kind: "followup" | "chapter" | "compare" | "nokeyword" | "longthread" | "table" | "plain" | "compaction";
  /** earlier turns, alternating learner / tutor */
  turns?: string[];
  q: string;
  /** any of these substrings in a seen source title counts */
  sources: string[];
  points: string[];
  /** filler turns inserted after `turns` (long threads) */
  filler?: number;
}

const C: Case[] = [
  { id: "f-kansas", space: "GED", lang: "en", kind: "followup", turns: ["What was the Missouri Compromise?", "The Missouri Compromise of 1820 admitted Missouri as a slave state and Maine as a free state, and banned slavery north of 36°30′ in the rest of the Louisiana Purchase."], q: "And how did the Kansas-Nebraska Act change that?", sources: ["US History"], points: ["repealed / overturned the 36°30′ line of the Missouri Compromise", "let settlers decide slavery by popular sovereignty", "led to violence in Kansas (Bleeding Kansas) or the rise of the Republican Party"] },
  { id: "f-chloro", space: "GED", lang: "en", kind: "followup", turns: ["What does the mitochondrion do?", "Mitochondria carry out cellular respiration and make ATP for the cell."], q: "And which organelle makes sugar in plant cells instead?", sources: ["Biology"], points: ["chloroplasts", "by photosynthesis using light energy", "produce glucose/sugar from CO2 and water"] },
  { id: "f-free", space: "C", lang: "en", kind: "followup", turns: ["What does malloc return?", "malloc returns a void pointer to a block of at least the requested size, or NULL if it fails."], q: "And what should I do with it when I'm done?", sources: ["Beej", "N3220", "n1570", "CS341", "GNU C", "Essential C"], points: ["call free() on the pointer", "don't use it after freeing (dangling pointer) and don't free it twice", "set it to NULL or avoid leaks by freeing exactly once"] },
  { id: "f-pid-d", space: "Robotics", lang: "en", kind: "followup", turns: ["What's a PID controller?", "A PID controller computes a control output from the error: a proportional, an integral and a derivative term."], q: "How would I tune the D part of it?", sources: ["Controls engineering", "Fbs", "frc"], points: ["the derivative term reacts to the rate of change of error and damps oscillation/overshoot", "increase Kd gradually after tuning P (and I) until overshoot is reduced", "too much D amplifies sensor noise"] },
  { id: "f-deref-de", space: "C", lang: "de", kind: "followup", turns: ["Was ist ein Zeiger in C?", "Ein Zeiger ist eine Variable, die eine Speicheradresse speichert, z. B. int *p = &x;"], q: "Und wie komme ich an den Wert, auf den er zeigt?", sources: ["Beej", "Essential C", "Pointers", "GNU C", "N3220"], points: ["mit dem Dereferenzierungsoperator * (z. B. *p)", "liest oder schreibt den Wert an der Adresse", "auf gültige Adresse achten (nicht NULL/uninitialisiert)"] },
  { id: "f-judicial", space: "GED", lang: "en", kind: "followup", turns: ["What are the three branches of government?", "The legislative branch (Congress), the executive branch (the President) and the judicial branch (the courts)."], q: "Which one of them can strike down a law, and where does that power come from?", sources: ["American Government", "US History"], points: ["the judicial branch / Supreme Court", "judicial review", "established by Marbury v. Madison (1803)"] },

  { id: "ch-alg5", space: "GED", lang: "en", kind: "chapter", q: "Summarize chapter 5 of Elementary Algebra.", sources: ["Elementary Algebra", "Elementary algebra"], points: ["systems of linear equations", "solving by graphing", "solving by substitution", "solving by elimination", "applications / systems of linear inequalities"] },
  { id: "ch-prealg2", space: "GED", lang: "en", kind: "chapter", q: "Give me a summary of chapter 2 of Prealgebra 2e.", sources: ["Prealgebra"], points: ["language of algebra: variables, expressions, symbols", "evaluating and simplifying expressions", "solving equations with subtraction/addition properties", "multiples, factors, prime factorization", "least common multiple"] },
  { id: "ch-bio1", space: "GED", lang: "en", kind: "chapter", q: "Summarize chapter 1 of Concepts of Biology.", sources: ["Biology"], points: ["themes and concepts of biology / properties of life", "levels of organization", "the process of science / scientific method", "diversity of life / evolution"] },
  { id: "ch-gov3-de", space: "GED", lang: "de", kind: "chapter", q: "Fasse Kapitel 3 von American Government zusammen.", sources: ["American Government"], points: ["Föderalismus (American Federalism)", "Aufteilung der Macht zwischen Bund und Bundesstaaten", "Entwicklung des Föderalismus (dual/cooperative)", "zwischenstaatliche Beziehungen / Finanzzuweisungen (grants)", "Vor- und Nachteile"] },
  { id: "ch-phys4", space: "Robotics", lang: "en", kind: "chapter", q: "Summarize chapter 4 of University Physics Volume 1.", sources: ["University_Physics_Volume_1", "University Physics"], points: ["motion in two and three dimensions", "displacement and velocity/acceleration vectors", "projectile motion", "uniform circular motion", "relative motion"] },
  { id: "ch-mr9", space: "Robotics", lang: "en", kind: "chapter", q: "What does chapter 9 of Modern Robotics cover?", sources: ["Modern Robotics"], points: ["trajectory generation", "point-to-point trajectories / time scaling", "polynomial via-point trajectories", "time-optimal time scaling"] },
  { id: "ch-alg23", space: "GED", lang: "en", kind: "chapter", q: "Explain section 2.3 of Elementary Algebra.", sources: ["Elementary Algebra", "Elementary algebra"], points: ["solving equations with variables and constants on both sides", "collect variable terms on one side and constants on the other", "check the solution"] },

  { id: "cmp-malloc", space: "C", lang: "en", kind: "compare", q: "Compare malloc and calloc.", sources: ["Beej", "N3220", "n1570", "GNU C", "CS341"], points: ["calloc zero-initializes the memory, malloc doesn't", "calloc takes count and element size, malloc a byte count", "both return NULL on failure and need free"] },
  { id: "cmp-mitosis", space: "GED", lang: "en", kind: "compare", q: "Compare mitosis and meiosis.", sources: ["Biology"], points: ["mitosis gives 2 identical diploid cells, meiosis 4 haploid cells", "meiosis has two divisions", "crossing over / genetic variation in meiosis", "mitosis for growth/repair, meiosis for gametes"] },
  { id: "cmp-congress", space: "GED", lang: "en", kind: "compare", q: "What's the difference between the Senate and the House of Representatives?", sources: ["American Government"], points: ["Senate 100 members (2 per state), House 435 by population", "Senate 6-year terms, House 2-year terms", "Senate confirms appointments/ratifies treaties; House starts revenue bills / impeaches"] },
  { id: "cmp-buck", space: "Robotics", lang: "en", kind: "compare", q: "Compare a buck converter with a linear regulator.", sources: ["Buck", "Electric Circuits", "TI"], points: ["buck converter switches and is far more efficient", "linear regulator burns the voltage difference as heat", "buck is noisier (switching ripple) and needs inductor/more parts", "linear is simpler and quieter"] },
  { id: "cmp-stack-de", space: "C", lang: "de", kind: "compare", q: "Vergleiche Stack und Heap in C.", sources: ["CS341", "Beej", "Cpumemory", "Essential C", "CS50", "GNU C"], points: ["Stack: automatische lokale Variablen, Lebensdauer bis Funktionsende", "Heap: dynamisch mit malloc/free, Lebensdauer manuell", "Stack klein/schnell, Heap größer, Fragmentierung/Leaks möglich"] },

  { id: "nk-fraction", space: "GED", lang: "en", kind: "nokeyword", q: "On my calculator, how do I flip an answer between a fraction and a decimal?", sources: ["TI30XS", "TI-30XS", "TI30XS MultiView"], points: ["use the toggle key (◄► / f◄►d)", "on the TI-30XS MultiView"] },
  { id: "nk-stamp", space: "GED", lang: "en", kind: "nokeyword", q: "Why were the colonists so angry about having to pay for stamps on paper?", sources: ["US History"], points: ["the Stamp Act of 1765", "taxation without representation", "protests/boycotts, Stamp Act Congress, repeal 1766"] },
  { id: "nk-cache", space: "C", lang: "en", kind: "nokeyword", q: "Why does my program get much slower when I walk a big 2D array column by column instead of row by row?", sources: ["Cpumemory", "CS 61", "6.172", "CS341"], points: ["C arrays are row-major", "column order jumps across cache lines → cache misses", "row order uses spatial locality / prefetching"] },
  { id: "nk-odometry", space: "Robotics", lang: "en", kind: "nokeyword", q: "How can a robot estimate where it is just by counting how far its wheels turned?", sources: ["Autonomous Robots", "Correll", "Modern Robotics"], points: ["odometry / dead reckoning from wheel encoders", "uses wheel radius and axle distance (kinematics)", "errors accumulate over time (drift)"] },
  { id: "nk-essay", space: "GED", lang: "en", kind: "nokeyword", q: "How do they grade the writing part where I have to argue about two passages?", sources: ["Extended response", "Assessment guide for educators rla", "RLA"], points: ["extended response scored on three traits", "trait 1: creation of arguments and use of evidence", "trait 2: development and organizational structure", "trait 3: clarity and command of standard English", "each trait 0–2 points"] },

  { id: "t-ged-scores", space: "GED", lang: "en", kind: "table", q: "What score ranges mean passing, college ready, and college ready plus credit on the GED?", sources: ["Performance Level", "GED", "Gedteststudyguide"], points: ["145–164 passing (High School Equivalency)", "165–174 GED College Ready", "175–200 College Ready + Credit"] },
  { id: "t-math-test", space: "GED", lang: "en", kind: "table", q: "How long is the GED math test, how many questions does it have, and when can I use the calculator?", sources: ["Assessment guide for educators math", "Gedteststudyguide", "GED"], points: ["115 minutes", "about 46 questions", "first part (first 5 questions) without calculator, calculator for the rest"] },
  { id: "t-intmax", space: "C", lang: "en", kind: "table", q: "What is the smallest value the C standard allows for INT_MAX?", sources: ["N3220", "n1570"], points: ["32767 (2^15 − 1)", "from <limits.h> minimum magnitudes (5.2.4.2.1)"] },
  { id: "t-fbs-feedback", space: "Robotics", lang: "en", kind: "table", q: "How do Åström and Murray define feedback?", sources: ["Fbs"], points: ["two or more dynamical systems connected so that each influences the other", "their dynamics are strongly coupled / circular causality"] },

  { id: "p-thread", space: "C", lang: "en", kind: "plain", q: "What is the difference between a process and a thread?", sources: ["CS341", "CS50", "Beej"], points: ["threads share the process's address space/memory", "processes have separate address spaces", "threads are cheaper to create/switch; need synchronization"] },
  { id: "p-volatile", space: "C", lang: "en", kind: "plain", q: "What does volatile do in C?", sources: ["N3220", "n1570", "Beej", "GNU C", "bare-metal"], points: ["tells the compiler the value may change outside the program's control", "prevents optimizing away/caching reads and writes", "used for memory-mapped I/O/signal handlers; not a thread-sync tool"] },
  { id: "p-19th", space: "GED", lang: "en", kind: "plain", q: "What did the 19th Amendment do?", sources: ["US History", "American Government"], points: ["gave women the right to vote", "ratified 1920"] },
  { id: "p-slope-de", space: "GED", lang: "de", kind: "plain", q: "Was ist die Steigung einer Geraden und wie berechne ich sie?", sources: ["Algebra", "Linear-Functions", "Prealgebra"], points: ["Steigung = Änderung in y / Änderung in x (rise over run)", "m = (y2 − y1)/(x2 − x1)", "positiv steigend, negativ fallend"] },
  { id: "p-diode", space: "Robotics", lang: "en", kind: "plain", q: "How does a PN junction diode conduct?", sources: ["Semiconductors", "Electric Circuits"], points: ["conducts when forward biased", "depletion region narrows", "about 0.7 V forward voltage for silicon; blocks in reverse bias"] },
  { id: "p-freertos", space: "Robotics", lang: "en", kind: "plain", q: "In FreeRTOS, what happens when two ready tasks have the same priority?", sources: ["FreeRTOS"], points: ["they share time by time slicing / round robin", "on each tick interrupt (configUSE_TIME_SLICING)"] },
  { id: "p-pico-gpio", space: "Robotics", lang: "en", kind: "plain", q: "How do I make a GPIO pin an output and set it high on the Raspberry Pi Pico in C?", sources: ["pico c sdk", "Raspberry pi pico"], points: ["gpio_init(pin)", "gpio_set_dir(pin, GPIO_OUT)", "gpio_put(pin, 1)"] },
  { id: "p-ik", space: "Robotics", lang: "en", kind: "plain", q: "Explain inverse kinematics briefly.", sources: ["Modern Robotics", "Autonomous Robots"], points: ["find joint angles that give a desired end-effector pose", "can have zero, one or many solutions", "solved analytically or numerically (e.g. Newton-Raphson)"] },
  { id: "p-checks", space: "GED", lang: "en", kind: "plain", q: "Give me examples of checks and balances.", sources: ["American Government", "US History"], points: ["presidential veto and congressional override", "Senate confirms appointments / treaties", "judicial review of laws", "impeachment"] },
  { id: "p-photo-de", space: "GED", lang: "de", kind: "plain", q: "Wie funktioniert die Photosynthese?", sources: ["Biology"], points: ["Lichtreaktionen in den Thylakoiden erzeugen ATP/NADPH und O2", "Calvin-Zyklus fixiert CO2 zu Zucker", "CO2 + H2O + Licht → Glukose + O2"] },
  { id: "p-ohm-de", space: "Robotics", lang: "de", kind: "plain", q: "Erkläre das ohmsche Gesetz.", sources: ["Electric Circuits"], points: ["U = R · I (E = I · R)", "Strom proportional zur Spannung bei konstantem Widerstand", "Einheiten Volt, Ampere, Ohm"] },
  { id: "p-sci-tools", space: "GED", lang: "en", kind: "plain", q: "What tools am I allowed to use on the GED Science test?", sources: ["Assessment guide for educators science", "Gedteststudyguide", "GED"], points: ["an on-screen TI-30XS calculator (for some items)", "a formula sheet/reference where provided", "whiteboard/scratch paper"] },

  { id: "lt-median", space: "GED", lang: "en", kind: "longthread", filler: 32, turns: ["Hi! I'm preparing for the GED math test.", "Great, let's work on it together.", "I keep mixing up mean and median; my teacher Mrs. Alvarez said to always sort the numbers first.", "That's a good habit: sorting makes the middle value easy to see."], q: "What did my teacher tell me to do first, and for which of the two concepts does it actually matter?", sources: ["Prealgebra", "Probability", "Statistics", "Algebra"], points: ["teacher is Mrs. Alvarez", "sort the numbers first", "it matters for the median (middle value), not the mean"] },
  { id: "lt-shell", space: "C", lang: "en", kind: "longthread", filler: 34, turns: ["I'm learning C for a class.", "Nice, what's the class project?", "My project is a tiny shell called nutshell that must support pipes between commands.", "Got it, a shell with pipes."], q: "Given my project, which system calls will I need most and why?", sources: ["CS341", "Beej's Guide to Interprocess", "GNU C"], points: ["refers to the nutshell shell project with pipes", "fork to create processes and exec to run commands", "pipe and dup2 to connect stdout/stdin", "wait/waitpid to reap children"] },
  { id: "lt-exam-de", space: "GED", lang: "de", kind: "longthread", filler: 36, turns: ["Hallo, ich lerne für den GED.", "Super, wobei kann ich helfen?", "Meine Prüfung ist am 12. März 2027 und ich habe Angst vor Prozentrechnung.", "Verstanden, wir planen das ein."], q: "Wann ist meine Prüfung nochmal, und welches Thema sollte ich zuerst üben?", sources: ["Prealgebra", "Algebra", "CUNY"], points: ["Prüfung am 12. März 2027", "zuerst Prozentrechnung üben"] },

  { id: "cmp-200", space: "GED", lang: "en", kind: "compaction", filler: 196, turns: ["Hi, quick context before we start.", "Sure, tell me.", "My study code word is PELICAN-42 and my weakest subject is Social Studies.", "Noted: PELICAN-42, and Social Studies needs the most work."], q: "What's my study code word, and which subject did I say is my weakest?", sources: [], points: ["code word PELICAN-42", "weakest subject is Social Studies"] },
];

const FILLER = [
  ["Can you give me a quick tip on reading graphs?", "Read the title, the axes and their units first, then look for the trend."],
  ["What is a ratio?", "A ratio compares two quantities, like 3 to 2, written 3:2 or 3/2."],
  ["How do I find the area of a rectangle?", "Multiply the length by the width: A = l × w."],
  ["What is a variable?", "A letter that stands for a number we don't know yet."],
  ["Explain a thesis statement.", "One sentence that states your main claim, usually at the end of the introduction."],
  ["What's a hypothesis?", "A testable prediction about how two things are related."],
  ["How do I convert a fraction to a percent?", "Divide the numerator by the denominator and multiply by 100."],
  ["What is inflation?", "A general rise in prices that lowers what money can buy."],
];

function thread(c: Case): Message[] {
  const turns = [...(c.turns ?? [])];
  for (let i = 0; i < (c.filler ?? 0); i++) {
    const [u, a] = FILLER[i % FILLER.length];
    turns.push(`${u} (${i + 1})`, `${a} ${"This is worth practising with a few examples of your own. ".repeat(3)}`);
  }
  return turns.map((content, i) => ({ id: `${c.id}-${i}`, threadId: c.id, role: i % 2 ? "assistant" : "user", content, reasoning: null, citations: null, meta: null, status: "complete", error: null, createdAt: i + 1 }));
}

// ---------- pipelines ----------
interface Seen {
  titles: string[];
  passages: { n: number; title: string; text: string; page: number | null }[];
}
interface Run {
  answer: string;
  seen: Seen;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  ms: number;
  steps: number;
}

const timing: { id: string; ctxMs: number; firstMs: number; total: number }[] = [];
const usd = (inT: number, outT: number) => inT * 0.15e-6 + outT * 0.6e-6;

async function runOld(c: Case, prior: Message[]): Promise<Run> {
  const t0 = Date.now();
  const hits = (await api.searchChunks(spaceId(c.space), c.q, 8)) as SearchHit[];
  const system = buildSystemPrompt({ space: { name: c.space, strictGrounding: false }, tutorStyle: "direct", passages: passagesFrom(hits), focus: null, now: Date.now(), sourceCount: 1 });
  const history = historyMessages(prior).slice(-24) as ModelMessage[];
  const r = await generateText({ model: answerModel.model, ...answerModel.options({ thinking: false }), system, messages: [...history, { role: "user", content: c.q }] });
  const cites = hitsToCitations(hits);
  return {
    answer: r.text,
    seen: { titles: hits.map((h) => h.sourceTitle), passages: cites.map((x) => ({ n: x.n, title: x.sourceTitle, text: x.text ?? x.snippet, page: x.page })) },
    promptTokens: r.usage.inputTokens ?? 0,
    completionTokens: r.usage.outputTokens ?? 0,
    cost: usd(r.usage.inputTokens ?? 0, r.usage.outputTokens ?? 0),
    ms: Date.now() - t0,
    steps: 1,
  };
}

async function runNew(c: Case, prior: Message[]): Promise<Run & { compactions: number }> {
  const t0 = Date.now();
  let compactions = 0;
  const th: Thread = { id: c.id, spaceId: spaceId(c.space), title: c.id, createdAt: 0, updatedAt: 0, pinned: false, summary: null, summaryUntil: null, autoCompact: true };
  threads.set(th.id, th);
  // long synthetic threads: compact the way a running chat would, every few turns
  const maxContext = c.kind === "compaction" ? 12_000 : null;
  if (c.kind === "compaction") {
    const limits = await modelLimits(answerModel.provider, answerModel.modelId);
    for (let i = 10; i <= prior.length; i += 10) {
      const cur = threads.get(c.id)!;
      const b = splitBudget({ limits, maxContext, fixedTokens: 2500 });
      const h = fitHistory(prior.slice(0, i), cur, b.conversation);
      if (h.shouldCompact && compactionCut(h.live)) {
        await compactThread({ thread: cur, messages: prior.slice(0, i), llm: answerModel });
        compactions++;
      }
    }
  }
  const ctx = await buildContext({
    spaceId: spaceId(c.space),
    thread: threads.get(c.id)!,
    prior,
    latest: c.q,
    llm: answerModel,
    maxContext,
    tools: true,
    passageCap: process.env.PASSAGE_CAP ? Number(process.env.PASSAGE_CAP) : undefined,
    onThread: () => compactions++,
    instructions: ({ sourceMap, fullText, toolInstruction }) =>
      buildSystemPrompt({ space: { name: c.space, strictGrounding: false }, tutorStyle: "direct", passages: [], focus: null, now: Date.now(), sourceCount: 1, sourceMap, fullText, passagesInMessage: true, toolInstruction, focusInMessage: true }),
  });
  const ctxMs = Date.now() - t0;
  let firstMs = 0;
  const st = streamText({
    model: answerModel.model,
    ...answerModel.options({ thinking: false }),
    system: ctx.system,
    messages: contextMessages(ctx),
    ...(ctx.tools ? { tools: ctx.tools, stopWhen: stepCountIs(8) } : {}),
  });
  for await (const part of st.fullStream) if (part.type === "text-delta" && !firstMs) firstMs = Date.now() - t0;
  const r = { text: await st.text, totalUsage: await st.totalUsage, steps: await st.steps };
  timing.push({ id: c.id, ctxMs, firstMs, total: Date.now() - t0 });
  const cites = ctx.finalCitations();
  return {
    answer: r.text,
    seen: { titles: [...new Set(cites.map((x) => x.sourceTitle))], passages: cites.map((x) => ({ n: x.n, title: x.sourceTitle, text: x.text ?? x.snippet, page: x.page })) },
    promptTokens: r.totalUsage.inputTokens ?? 0,
    completionTokens: r.totalUsage.outputTokens ?? 0,
    cost: usd(r.totalUsage.inputTokens ?? 0, r.totalUsage.outputTokens ?? 0),
    ms: Date.now() - t0,
    steps: r.steps.length,
    compactions,
  };
}

// ---------- scoring ----------
const recall = (c: Case, seen: Seen) => (c.sources.length === 0 ? 1 : seen.titles.some((t) => c.sources.some((s) => t.toLowerCase().includes(s.toLowerCase()))) ? 1 : 0);

async function grade(c: Case, run: Run): Promise<{ correctness: number; citations: number | null; note: string }> {
  const cited = citedNumbers(run.answer, 999).slice(0, 12);
  const quoted = cited
    .map((n) => run.seen.passages.find((p) => p.n === n))
    .filter(Boolean)
    .map((p) => `[${p!.n}] (${p!.title}${p!.page != null ? `, p. ${p!.page}` : ""})\n${p!.text.slice(0, 2500)}`)
    .join("\n\n");
  const prompt = [
    `Question (${c.lang}): ${c.q}`,
    c.turns?.length ? `Earlier in the chat the learner said: ${c.turns.filter((_, i) => i % 2 === 0).join(" / ")}` : "",
    `Expected answer points:\n${c.points.map((p) => `- ${p}`).join("\n")}`,
    `Answer to grade:\n${run.answer}`,
    cited.length ? `The passages the answer cites:\n${quoted}` : "The answer cites no passages.",
    'Return JSON {"points": number of expected points the answer gets right (partial = 0.5), "wrong": true if it states something clearly false, "citationsValid": fraction 0..1 of cited passages that support the sentence citing them (null if none cited), "note": one short sentence}.',
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await generateText({ model: judge.model, ...judge.options({ thinking: false }), system: "You grade a tutor's answer strictly against expected points. Reply with JSON only.", prompt, temperature: 0 });
  const { extractJson } = await import("../src/lib/chat/json");
  const j = extractJson<{ points: number; wrong: boolean; citationsValid: number | null; note: string }>(r.text) ?? { points: 0, wrong: false, citationsValid: null, note: "unparsable" };
  const correctness = Math.max(0, Math.min(1, j.points / c.points.length - (j.wrong ? 0.25 : 0)));
  return { correctness, citations: cited.length ? (j.citationsValid ?? 0) : null, note: j.note };
}

// ---------- run ----------
const results: Record<string, unknown>[] = [];
const cases = C.filter((c) => !only || only.includes(c.id));
for (const c of cases) {
  const prior = thread(c);
  for (const p of pipelines) {
    try {
      const run = p === "old" ? await runOld(c, prior) : await runNew(c, prior);
      const g = await grade(c, run);
      const row = { id: c.id, kind: c.kind, lang: c.lang, pipeline: p, recall: recall(c, run.seen), ...g, promptTokens: run.promptTokens, cost: run.cost, ms: run.ms, steps: run.steps, compactions: (run as { compactions?: number }).compactions ?? 0, answer: run.answer.slice(0, 1500) };
      results.push(row);
      console.log(`${c.id.padEnd(16)} ${p.padEnd(3)} recall ${row.recall} correct ${g.correctness.toFixed(2)} cites ${g.citations?.toFixed(2) ?? "–"} tok ${run.promptTokens} $${run.cost.toFixed(4)} ${(run.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`${c.id} ${p} FAILED: ${(e as Error).message}`);
      results.push({ id: c.id, kind: c.kind, pipeline: p, error: (e as Error).message });
    }
  }
}

type Row = { pipeline: string; kind: string; recall: number; correctness: number; citations: number | null; promptTokens: number; cost: number; ms: number; error?: string };
const rows = results as unknown as Row[];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const summary: Record<string, Record<string, number>> = {};
for (const p of pipelines) {
  const r = rows.filter((x) => x.pipeline === p && !x.error);
  summary[p] = {
    n: r.length,
    errors: rows.filter((x) => x.pipeline === p && x.error).length,
    recall: mean(r.map((x) => x.recall)),
    correctness: mean(r.map((x) => x.correctness)),
    citations: mean(r.filter((x) => x.citations != null).map((x) => x.citations!)),
    promptTokens: mean(r.map((x) => x.promptTokens)),
    cost: mean(r.map((x) => x.cost)),
    seconds: mean(r.map((x) => x.ms)) / 1000,
  };
  for (const kind of [...new Set(r.map((x) => x.kind))]) summary[p][`correct.${kind}`] = mean(r.filter((x) => x.kind === kind).map((x) => x.correctness));
}
console.log(JSON.stringify(summary, null, 2));
if (timing.length) console.log("timing (context ms / first token ms / total ms):", timing.map((t) => `${t.id} ${t.ctxMs}/${t.firstMs}/${t.total}`).join(", "));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: answerModel.modelId, summary, results }, null, 2));
server.kill();
process.exit(0);
