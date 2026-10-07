import { s } from "../strings";
import type { OpenRouterModel, Provider } from "../types";

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Verbosity = "low" | "medium" | "high";

export interface Choice<T extends string = string> {
  value: T;
  label: string;
}

export interface EffortCap {
  label: string;
  options: Choice<Effort>[];
  /** the model's own default; null when unknown */
  default: Effort | null;
}

export interface ThinkingCap {
  label?: string;
  /** state when the learner hasn't chosen */
  default: boolean;
  /** turning thinking off is only accepted at this effort or lower */
  offMaxEffort?: Effort;
}

export interface TemperatureCap {
  presets: number[];
  default: number | null;
  /** sampling is rejected while thinking is on */
  offWhenThinking?: boolean;
}

export interface VerbosityCap {
  options: Choice<Verbosity>[];
  default: Verbosity | null;
}

/** How the chosen values become request parameters. */
export type Wire =
  | { kind: "anthropic"; off: "disabled" | "between_tools" | null; on: "omit" | "adaptive" | "budget" }
  | { kind: "openai" }
  | { kind: "google"; style: "level" | "budget" }
  | { kind: "xai" }
  | { kind: "openrouter" }
  | { kind: "compat"; effort: boolean; thinking: "reasoning_effort-none" | "deepseek" | null }
  | { kind: "none" };

export interface ModelCaps {
  effort: EffortCap | null;
  thinking: ThinkingCap | null;
  verbosity: VerbosityCap | null;
  temperature: TemperatureCap | null;
  wire: Wire;
}

export const TEMPERATURE_PRESETS = [0, 0.3, 0.7, 1];

export const EFFORT_LABELS: Record<Effort, string> = s.models.effortLevels;

export const EFFORT_ORDER: Effort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const effortRank = (e: Effort) => EFFORT_ORDER.indexOf(e);

const choices = (...v: Effort[]): Choice<Effort>[] => v.map((value) => ({ value, label: EFFORT_LABELS[value] }));
const effort = (options: Effort[], dflt: Effort | null, label: string = s.models.effort): EffortCap => ({ label, options: choices(...options), default: dflt });
const VERBOSITY: VerbosityCap = {
  options: (["low", "medium", "high"] as const).map((value) => ({ value, label: s.models.verbosityLevels[value] })),
  default: "medium",
};
const temp = (c: Partial<TemperatureCap> = {}): TemperatureCap => ({ presets: TEMPERATURE_PRESETS, default: 1, ...c });
const NONE: Wire = { kind: "none" };
const bare = (wire: Wire): ModelCaps => ({ effort: null, thinking: null, verbosity: null, temperature: temp(), wire });

const LMH: Effort[] = ["low", "medium", "high"];
const FIVE: Effort[] = ["low", "medium", "high", "xhigh", "max"];

// ---------- Anthropic ----------

interface ClaudeId {
  family: "opus" | "sonnet" | "haiku" | "fable" | "mythos";
  version: number;
}

/** "claude-haiku-5-5", "anthropic/claude-haiku-5.5", "claude-sonnet-4-5-20250929" -> family + version */
export function parseClaude(modelId: string): ClaudeId | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  const m = id.match(/(?:claude[-\s])?(opus|sonnet|haiku|fable|mythos)[-\s](\d+)(?:[-.\s](\d{1,2}))?(?!\d)/);
  if (m) return { family: m[1] as ClaudeId["family"], version: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
  const legacy = id.match(/claude-(\d)(?:[-.](\d))?-(opus|sonnet|haiku)/);
  if (legacy) return { family: legacy[3] as ClaudeId["family"], version: Number(legacy[1]) + (legacy[2] ? Number(legacy[2]) / 10 : 0) };
  return null;
}

function anthropicCaps(modelId: string): ModelCaps | null {
  const c = parseClaude(modelId);
  if (!c) return null;
  const { family, version } = c;
  const noSampling = temperatureLocked(c);
  const sampling = noSampling ? null : temp({ offWhenThinking: true });
  const make = (e: EffortCap | null, thinking: ThinkingCap | null, wire: Wire): ModelCaps => ({
    effort: e,
    thinking,
    verbosity: null,
    temperature: sampling,
    wire,
  });
  if (family === "fable" || family === "mythos")
    return make(effort(FIVE, "high"), null, { kind: "anthropic", off: null, on: "omit" });
  if (version >= 5) {
    if (family === "opus" && version >= 5.5) return make(effort(FIVE, "medium"), null, { kind: "anthropic", off: null, on: "omit" });
    if (family === "sonnet" && version >= 5.5)
      return make(effort(FIVE, "high"), { default: true, offMaxEffort: "high" }, { kind: "anthropic", off: "between_tools", on: "omit" });
    if (family === "haiku")
      return make(effort(FIVE, "medium"), { default: true, offMaxEffort: "high" }, { kind: "anthropic", off: "disabled", on: "omit" });
    return make(
      effort(FIVE, "high"),
      { default: true, ...(family === "opus" ? { offMaxEffort: "high" as Effort } : {}) },
      { kind: "anthropic", off: "disabled", on: "omit" },
    );
  }
  if (family === "opus" && version >= 4.7)
    return make(effort(FIVE, "high"), { default: false }, { kind: "anthropic", off: "disabled", on: "adaptive" });
  if ((family === "opus" || family === "sonnet") && version >= 4.6)
    return make(effort(["low", "medium", "high", "max"], "high"), { default: false }, { kind: "anthropic", off: "disabled", on: "adaptive" });
  if (family === "opus" && version >= 4.5) return make(effort(LMH, "high"), { default: false, label: s.models.extendedThinking }, { kind: "anthropic", off: "disabled", on: "budget" });
  if (version >= 4 || (family === "sonnet" && version >= 3.7))
    return make(null, { default: false, label: s.models.extendedThinking }, { kind: "anthropic", off: "disabled", on: "budget" });
  return make(null, null, { kind: "anthropic", off: null, on: "omit" });
}

/** Newest Claude models reject any non-default temperature, top_p or top_k. */
function temperatureLocked({ family, version }: ClaudeId): boolean {
  return family === "fable" || family === "mythos" || version >= 5 || (family === "opus" && version >= 4.7);
}

// ---------- OpenAI ----------

function openaiCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  const reasoning = (levels: Effort[], dflt: Effort, verbosity = true): ModelCaps => ({
    effort: effort(levels, dflt, s.models.reasoningEffort),
    thinking: null,
    verbosity: verbosity ? VERBOSITY : null,
    temperature: levels.includes("none") ? temp({ default: null, offWhenThinking: true }) : null,
    wire: { kind: "openai" },
  });
  if (/^gpt-6\.1-sol/.test(id) || /^gpt-6-astra/.test(id)) return reasoning(FIVE, "medium");
  if (/^gpt-6/.test(id)) return reasoning(["none", ...FIVE], "medium");
  const g5 = id.match(/^gpt-5(?:\.(\d+))?/);
  if (g5) {
    const minor = g5[1] ? Number(g5[1]) : 0;
    if (/-chat/.test(id)) return bare(NONE);
    if (minor >= 5) return reasoning(["none", ...FIVE], "medium");
    if (minor >= 1) return reasoning(["none", "low", "medium", "high", "xhigh"], "medium");
    return reasoning(["minimal", ...LMH], "medium");
  }
  if (/^o\d/.test(id)) return { ...reasoning(LMH, "medium", false), temperature: null };
  return null;
}

// ---------- Google ----------

function googleCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  const m = id.match(/^gemini-(\d+)(?:\.(\d+))?-(pro|flash-lite|flash)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = m[2] ? Number(m[2]) : 0;
  const tier = m[3];
  const t = temp({ presets: [0, 0.3, 0.7, 1], default: 1 });
  if (major >= 3) {
    const minimal = tier !== "pro" && (minor === 5 || minor === 6);
    const levels: Effort[] = minimal ? ["minimal", ...LMH] : LMH;
    const dflt: Effort = tier === "flash-lite" ? "minimal" : "medium";
    return { effort: effort(levels, minimal || dflt !== "minimal" ? dflt : "low", s.models.thinkingLevel), thinking: null, verbosity: null, temperature: t, wire: { kind: "google", style: "level" } };
  }
  if (major === 2 && minor === 5)
    return {
      effort: null,
      thinking: tier === "pro" ? null : { default: tier === "flash" },
      verbosity: null,
      temperature: t,
      wire: { kind: "google", style: "budget" },
    };
  return null;
}

// ---------- xAI ----------

function xaiCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  if (/non-reasoning/.test(id)) return bare(NONE);
  const m = id.match(/^grok-(\d+)\.(\d+)/);
  if (!m) return null;
  const v = Number(m[1]) + Number(m[2]) / 100;
  if (v >= 4.06) return { ...bare({ kind: "xai" }), effort: effort(["low", "medium", "high", "xhigh"], "high", s.models.reasoningEffort) };
  if (v >= 4.05) return { ...bare({ kind: "xai" }), effort: effort(LMH, "high", s.models.reasoningEffort) };
  return null;
}

// ---------- DeepSeek, Kimi, Mistral, Groq ----------

function deepseekCaps(modelId: string, via: "direct" | "openrouter"): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  if (!/^deepseek-(v4|flash)/.test(id)) return null;
  const pro = /pro/.test(id);
  return {
    effort: effort(pro ? ["high", "max"] : ["low", "high", "max"], "high", s.models.reasoningEffort),
    thinking: { default: true },
    verbosity: null,
    temperature: temp({ offWhenThinking: true }),
    wire: via === "direct" ? { kind: "compat", effort: true, thinking: "deepseek" } : { kind: "openrouter" },
  };
}

/** Kimi K2.6/K2.7 don't take a temperature; effort and the thinking switch come from OpenRouter's own report. */
function kimiCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  return /^kimi-k2\.[67]/.test(id) ? { ...bare({ kind: "openrouter" }), temperature: null } : null;
}

function mistralCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  if (!/^mistral-(small|medium|large-4)/.test(id) || /^mistral-small-3/.test(id)) return null;
  return {
    effort: null,
    thinking: { default: true },
    verbosity: null,
    temperature: temp({ default: null }),
    wire: { kind: "compat", effort: false, thinking: "reasoning_effort-none" },
  };
}

function groqCaps(modelId: string): ModelCaps | null {
  const id = modelId.toLowerCase().replace(/^.*\//, "");
  if (/gpt-oss/.test(id)) return { ...bare({ kind: "compat", effort: true, thinking: null }), effort: effort(LMH, "medium", s.models.reasoningEffort) };
  if (/^qwen/.test(id) && /qwen-?3/.test(id))
    return { ...bare({ kind: "compat", effort: false, thinking: "reasoning_effort-none" }), thinking: { default: true } };
  return null;
}

/** Local servers: reasoning models that honour `reasoning_effort` (none turns thinking off). */
const LOCAL_REASONING = /qwen-?3|qwq|deepseek-r1|-r1\b|magistral|thinking|reasoning|glm-[45]|nemotron|granite-4|olmo-3|smollm3|gemma-4/i;

function localCaps(modelId: string): ModelCaps {
  const t = temp({ default: null });
  if (/gpt-oss/i.test(modelId))
    return { effort: effort(LMH, "medium", s.models.reasoningEffort), thinking: null, verbosity: null, temperature: t, wire: { kind: "compat", effort: true, thinking: null } };
  const reasons = LOCAL_REASONING.test(modelId);
  return {
    effort: null,
    thinking: reasons ? { default: true } : null,
    verbosity: null,
    temperature: t,
    wire: { kind: "compat", effort: false, thinking: reasons ? "reasoning_effort-none" : null },
  };
}

/** Family rules by vendor and bare model name; null when the family isn't known. */
function familyCaps(vendor: string, modelId: string, via: "direct" | "openrouter"): ModelCaps | null {
  const rule: Record<string, (id: string) => ModelCaps | null> = {
    anthropic: anthropicCaps,
    openai: openaiCaps,
    google: googleCaps,
    "x-ai": xaiCaps,
    moonshotai: kimiCaps,
  };
  if (vendor === "deepseek") return deepseekCaps(modelId, via);
  const c = rule[vendor]?.(modelId) ?? null;
  return c && via === "openrouter" ? { ...c, wire: { kind: "openrouter" } } : c;
}

// ---------- OpenRouter: family rules narrowed by what the endpoint reports ----------

const vendorOf = (modelId: string) => (modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")).replace(/^~/, "") : "");

function fromOpenRouter(modelId: string, m: OpenRouterModel | undefined): ModelCaps {
  const params = m?.supportedParameters;
  const has = (p: string) => !params || params.includes(p);
  const vendor = vendorOf(modelId);
  const fam = familyCaps(vendor, modelId.replace(/^.*\//, ""), "openrouter");
  const r = m?.reasoning;
  const reasons = has("reasoning") || has("reasoning_effort");

  const reported = r?.supportedEfforts?.filter((e): e is Effort => EFFORT_ORDER.includes(e as Effort));
  const famValues = fam?.effort?.options.map((o) => o.value) ?? [];
  let values = famValues.length ? famValues : (reported ?? []);
  if (reported?.length && famValues.length) values = values.filter((v) => reported.includes(v));
  values = EFFORT_ORDER.filter((e) => values.includes(e));

  let eff: EffortCap | null = null;
  let thinking: ThinkingCap | null = null;
  if (reasons) {
    const real = values.filter((v) => v !== "none");
    if (real.length > 1) {
      const dflt = fam?.effort?.default ?? (r?.defaultEffort as Effort | undefined) ?? null;
      eff = effort(values, dflt && values.includes(dflt) ? dflt : null, fam?.effort?.label ?? s.models.reasoningEffort);
    }
    if (!r?.mandatory) {
      // an "Off" effort already is the off switch
      if (fam) thinking = fam.thinking;
      else if (!values.includes("none") || real.length <= 1) thinking = { default: r?.defaultEnabled ?? true };
      if (eff?.options.some((o) => o.value === "none")) thinking = null;
    }
  }

  const temperature = !has("temperature") || (fam && !fam.temperature) ? null : (fam?.temperature ?? temp());
  const verbosity = vendor === "openai" && has("verbosity") ? VERBOSITY : null;
  return {
    effort: eff,
    thinking,
    verbosity,
    temperature: temperature ? { ...temperature, offWhenThinking: temperature.offWhenThinking && (!!thinking || !!eff?.options.some((o) => o.value === "none")) } : null,
    wire: { kind: "openrouter" },
  };
}

// ---------- entry point ----------

const DIRECT_VENDOR: Partial<Record<Provider["type"], string>> = {
  anthropic: "anthropic",
  openai: "openai",
  "chatgpt-oauth": "openai",
  google: "google",
  xai: "x-ai",
  "xai-oauth": "x-ai",
  deepseek: "deepseek",
};

const LOCAL = new Set<Provider["type"]>(["lmstudio", "ollama", "llamacpp"]);

/**
 * What the chosen model accepts. Direct providers use the family rules for the model id; OpenRouter combines them with
 * the endpoint's own parameter list; unknown models only get controls the provider type clearly takes.
 */
export function resolveModelCaps(provider: Pick<Provider, "type">, modelId: string, orModel?: OpenRouterModel): ModelCaps {
  const type = provider.type;
  if (type === "openrouter") return fromOpenRouter(modelId, orModel);
  const vendor = DIRECT_VENDOR[type];
  if (vendor) {
    const fam = familyCaps(vendor, modelId, "direct");
    const noSampling = type === "chatgpt-oauth" || type === "anthropic";
    if (fam) return type === "chatgpt-oauth" ? { ...fam, temperature: null } : fam;
    return { ...bare(NONE), temperature: noSampling || type === "xai-oauth" ? null : temp() };
  }
  if (LOCAL.has(type)) return localCaps(modelId);
  const fam = type === "mistral" ? mistralCaps(modelId) : type === "groq" ? groqCaps(modelId) : null;
  return fam ?? { ...bare(NONE), temperature: temp({ default: null }) };
}
