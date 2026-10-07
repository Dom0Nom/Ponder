# Model controls

The chat model menu shows only the controls the selected model accepts. Rules live in `src/lib/providers/modelCaps.ts` (`resolveModelCaps(provider, modelId, openRouterModel?)`); `callOptions` in `model.ts` turns chosen values into request parameters. Unset means the model's own default is used and nothing is sent. Stored values per `(provider, model)` that a model doesn't offer are dropped on read (`sanitizeControls`) and legacy `reasoning` values are migrated in the `ui` store (v3).

Researched October 2026. Items marked (unverified) came from a summary of the docs or conflicting pages; the OpenRouter-side values were verified live (see `scripts/e2e-model-menu.ts`).

## Anthropic (direct and via OpenRouter)

Sources: platform.claude.com/docs/en/build-with-claude/effort, .../thinking, .../thinking-troubleshooting.

| Model | Effort (default) | Thinking |
|---|---|---|
| Fable 5 / 5.1, Mythos | low..max (high) | always on, no switch |
| Opus 5.5 | low..max (medium) | always on, no switch |
| Sonnet 5.5 | low..max (high) | `between_tools` turns up-front thinking off, only at effort high or below |
| Haiku 5.5 | low..max (medium) | `disabled` allowed at effort high or below, 400 at xhigh/max |
| Opus 5 | low..max (high) | `disabled` at high or below |
| Sonnet 5 | low..max (high) | `disabled` |
| Opus 4.7 / 4.8 | low..max (high) | off by default, `adaptive` turns it on |
| Opus / Sonnet 4.6 | low, medium, high, max (high) | off by default, `adaptive` (budget deprecated) |
| Opus 4.5 | low, medium, high (high) | off by default, `enabled` + `budget_tokens` |
| Haiku 4.5, Sonnet 4.5, Sonnet 3.7 | none | off by default, `enabled` + `budget_tokens` |

- Request: `output_config.effort`; `thinking: {type: adaptive|enabled|disabled|between_tools}`. AI SDK: `providerOptions.anthropic.{effort, thinking}`.
- Sampling: Fable, Mythos, Opus 5/5.5/4.7/4.8, Sonnet 5/5.5, Haiku 5.5 return 400 for any non-default `temperature`/`top_p`/`top_k`, so no Temperature row. Older models: not while thinking is on (the row hides when the switch is on).
- `display` defaults to `omitted` on newer models; the app sends `adaptive` + `summarized` only when the learner turns thinking on for models that default to off.
- Effort or thinking changes between requests invalidate the prompt cache (docs).

## OpenAI (Responses API)

Sources: developers.openai.com/api/docs/guides/reasoning, .../latest-model.

- `reasoning.effort` (AI SDK `providerOptions.openai.reasoningEffort`), `text.verbosity` (`textVerbosity`).
- GPT-6.1 Sol and GPT-6 Astra: low..max, default medium, no `none`. GPT-6 Sol/Luna: `none` + low..max (list partly unverified). GPT-5: minimal, low, medium, high. GPT-5.1+: `none`, low..xhigh (no `minimal`; OpenRouter reports none for 5.4); 5.5+: also `max` (unverified). o-series: low, medium, high. GPT-4.x: none.
- Docs say temperature/top_p must be removed unless effort is `none`; temperature shows only for models with `none` and only while effort is Off.
- `text.verbosity` values and model coverage (unverified in docs; OpenRouter lists `verbosity` for GPT-6).

## Google Gemini

Source: ai.google.dev/gemini-api/docs/thinking.

- Gemini 3.x: `thinkingConfig.thinkingLevel`. 3.7/3.8 flash: low, medium, high (medium). 3.5/3.6 flash: minimal..high (medium). Flash-lite defaults to minimal. Pro tiers: low..high (unverified). Thinking cannot be switched off; `minimal` is the lowest level.
- Gemini 2.5: `thinkingConfig.thinkingBudget`; flash/flash-lite get an on/off switch (off = budget 0), pro has none (budget 0 not accepted) (unverified from the fetched page; widely documented earlier).

## xAI

Source: docs.x.ai/docs/guides/reasoning.

- `reasoning_effort`: grok-4.6/4.7 low, medium, high, xhigh; grok-4.5 low, medium, high; default high; reasoning cannot be disabled. `*-non-reasoning` has no control. Temperature allowed (unverified).

## DeepSeek

Source: api-docs.deepseek.com (create-chat-completion, thinking_mode).

- `thinking: {type: enabled|disabled}` (default enabled), `reasoning_effort`: none, low, high, max (default high). Flash: low, high, max; Pro: high, max (OpenRouter reports xhigh/high for Pro; narrowed per OpenRouter).
- Thinking mode ignores `temperature`; the row shows only while thinking is off.

## Mistral, Groq, Kimi, Qwen

- Mistral Small/Medium/Large 4: `reasoning_effort` `high` or `none` (unverified for Large 4) shown as a thinking switch.
- Groq: gpt-oss `reasoning_effort` low/medium/high; Qwen3 `reasoning_effort: none` as switch.
- Kimi K3: effort low/high/max, always on; K2.6/K2.7: no temperature. Via OpenRouter only.
- Qwen: `enable_thinking` / `thinking_budget` on Model Studio; via OpenRouter shown as a thinking switch from its `reasoning` metadata. No direct Qwen provider in the app.

## Local servers

- LM Studio / Ollama / llama.cpp: temperature always. Thinking switch only for model ids that look like reasoning models (Qwen3, QwQ, DeepSeek-R1, Magistral, GLM, etc.); off sends `reasoning_effort: "none"` (llama.cpp documents it; Ollama maps it to `think: false`; LM Studio relies on the model template, verified earlier with Qwen). gpt-oss gets low/medium/high effort.

## OpenRouter

Sources: openrouter.ai/docs/guides/best-practices/reasoning-tokens, /docs/api-reference/parameters.

- Sends `reasoning: {effort | enabled}` and `verbosity` (`providerOptions.openrouter.{reasoning, textVerbosity}` passthrough). Effort accepts max, xhigh, high, medium, low, minimal, none. For Claude it becomes `output_config.effort`; OpenRouter's `verbosity` also maps to `output_config.effort` for Claude, so the app never shows Verbosity for non-OpenAI models.
- `GET /models` returns per model `reasoning: {mandatory, supported_efforts, default_effort, default_enabled, supports_max_tokens}` plus `supported_parameters`. The app keeps these (Rust `openrouter.rs`, cache file `openrouter-chat-models-v2.json`) and narrows the family rules: effort options must be in `supported_efforts`; no thinking switch when `mandatory`; no Temperature/Verbosity unless in `supported_parameters`.
- OpenRouter lists `temperature` for Claude 5.x even though Anthropic rejects non-defaults, so the family rule wins there.
