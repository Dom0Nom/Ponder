# OAuth and TTS notes

Researched 2026-10-06. Re-check endpoints against the linked source before implementing.

## ChatGPT: official "Sign in with ChatGPT" for open-source apps

OpenAI officially allows open-source, locally hosted apps to use the user's ChatGPT plan. Use this path; don't copy Codex's client_id.
Docs: https://developers.openai.com/siwc/token-sharing-open-source/sign-in · limits: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

- No pre-registration. The first authorize request uses `client_id=dynamic_agent_client` plus `agent_name_hint` and a persisted `ext_agent_host_id`; the callback returns the app's own `oaiapp_…` client_id. Store it.
- Authorize: `https://auth.openai.com/api/accounts/authorize`. Token: `https://auth.openai.com/api/accounts/oauth/token`. PKCE S256.
- Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, plus `resource=https://api.openai.com/v1`.
- Redirect: loopback `http://127.0.0.1:<any port>/auth/callback`. Must be `127.0.0.1`, not `localhost`.
- Inference: `https://api.openai.com/v1/responses` only, with `store: false, stream: true`.
- Preview limits: no `temperature`, no `max_output_tokens`, no image generation, no audio. The provider must declare these capabilities as off, so TTS and image features fall back to other providers.
- Requires a Plus or Pro plan.

## xAI / Grok: Hermes Agent's approach

There is no published xAI program for third-party apps. Hermes Agent, OpenClaw, Goose, Warp, LiteLLM and cc-switch all reuse xAI's own Grok Build CLI public client. That works today but could be revoked; show a clear error if it breaks.
References: Hermes `hermes_cli/auth_xai.py` + `auth_constants.py` (github.com/NousResearch/hermes-agent), Rust: goose `crates/goose/src/providers/xai_oauth.rs`, warp `crates/ai/src/grok_subscription/oauth.rs`.

- Flow: device code (RFC 8628). Discover endpoints from `https://auth.x.ai/.well-known/openid-configuration`; device endpoint `/oauth2/device/code`; grant `urn:ietf:params:oauth:grant-type:device_code`. The UI shows the code + verification URL and polls.
- Alternative: PKCE loopback works only on exactly `http://127.0.0.1:56121/callback` (fixed registered port).
- client_id: `b1a00492-073a-47ea-816f-4c329264a828` (public, no secret).
- Scopes: `openid profile email offline_access grok-cli:access api:access`.
- Refresh: `refresh_token` grant. Refresh tokens rotate and are single-use: persist the new one atomically before using the access token. Access tokens last ~6h; refresh about an hour early.
- API: Bearer on `https://api.x.ai/v1` (Responses API). Also usable for xAI TTS, image and STT.
- Requires SuperGrok or X Premium+. Some SuperGrok tiers get 403; surface it as "your plan doesn't include API access".

## Not offered

- Claude subscription OAuth: banned outside Claude Code / claude.ai and enforced server-side since Feb 2026. Claude is API key only.
- Codex client_id reuse, Claude Code keychain reading, Copilot's borrowed VS Code client: don't.
- Gemini has no consumer OAuth for this; API key only.

## TTS

**Fish Audio** (preferred cloud voice). Docs: https://docs.fish.audio/llms.txt
- `POST https://api.fish.audio/v1/tts`, `Authorization: Bearer <key>`, model via `model` header: `s2.1-pro` (default), `s2.1-pro-free` (free, fair use), `s2-pro`, `s1`.
- Streaming: WebSocket `wss://api.fish.audio/v1/tts/live` (msgpack Start/Text/Close events).
- Voices: `reference_id` (saved voice) or inline `references` (zero-shot clone). Multi-speaker via a `reference_id` array, used for two-host audio overviews.
- Formats: mp3, wav, pcm, opus. ~$15 per 1M UTF-8 bytes. Concurrency is 5. No Rust SDK; use `reqwest`.

**OpenAI TTS, Gemini TTS, ElevenLabs**: standard API-key providers behind the same TTS interface.

**Local default**
- Kokoro-82M (Apache-2.0 weights), with Kitten TTS (Apache-2.0, smaller) as the lighter option. Run through `sherpa-onnx` (Apache-2.0, Rust bindings) or `ort` directly. Download the model on first use, not bundled in the installer.
- License catch: these models phonemize with espeak-ng (GPL-3). Don't link it into the MIT app. Prefer an espeak-free G2P (misaki without espeak fallback, Apache-2.0). Otherwise download espeak-ng as a separate executable on first use and call it as a subprocess. Document whichever is chosen in the README.
- Performance on the Intel 2019 Mac is unmeasured. Benchmark it, and if it's slower than real time, generate audio in the background with progress.
- Avoid Piper's active fork (GPL-3) and Supertonic (OpenRAIL, archived).
