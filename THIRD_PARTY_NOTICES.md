# Third-party notices

This app is MIT-licensed. The components below are included under their own licenses.

## Transitions.dev snippets (not MIT)

The files in `src/styles/transitions/` contain CSS transitions from the free tier of
Transitions.dev, modified for this app. They are © 2026 Jakub Antalik / Transitions.dev
and are used under the Transitions.dev License (https://transitions.dev/terms.html),
**not** under this repository's MIT license. You may use them as part of this app. You may
not extract and redistribute them, or a substantial part of the Transitions.dev
collection, as a transitions library, motion pack or animation kit.

Transitions used: Accordion expand, Checkbox check, Error state shake, Icon swap,
Learn more hover, Menu dropdown, Modal open / close, Notification badge, Number pop-in,
Page side-by-side, Panel reveal, Reasoning stream, Skeleton loader and reveal,
Streaming text, Success check, Tabs sliding, Text states swap, Texts reveal,
Thinking states, Toast open / close, Tooltip open/close.

## thinking-orbs, border-beam, metal-fx (MIT)

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## metal-fx: Paper Shaders (Apache-2.0)

metal-fx
Copyright (c) Jakub Antalik

This product includes software developed by Paper Design, Inc.

  Paper Shaders (https://github.com/paper-design/shaders)
  Copyright (c) Paper Design, Inc.
  Licensed under the Apache License, Version 2.0
  http://www.apache.org/licenses/LICENSE-2.0

The `liquidMetal` fragment shader and the sizing vertex shader are included unmodified
in the metal-fx bundle.

## Paper Shaders (Apache-2.0)

`@paper-design/shaders-react` and `@paper-design/shaders` 0.0.81 (the `LiquidMetal` shader
that animates the Ponder mark).

Copyright (c) Paper Design, Inc.
Licensed under the Apache License, Version 2.0
http://www.apache.org/licenses/LICENSE-2.0

## Ponder logo and font (not MIT)

The Ponder logo (`src/assets/brand/`, `design/brand/`) and the "ponder" display font belong to
the project owner. They are not covered by this repository's MIT license, and they are not to
be reused in forks without permission.

## Language fonts (SIL Open Font License 1.1)

Loaded only for the languages that need them, bundled through Fontsource so they work offline:

- IBM Plex Sans Arabic, IBM Plex Sans Devanagari, IBM Plex Sans JP, IBM Plex Sans KR (`@fontsource/ibm-plex-sans-*`): © IBM Corp., Reserved Font Name "Plex".
- Noto Sans Bengali, Noto Sans SC, Noto Sans TC (`@fontsource/noto-sans-*`): © Google LLC / Adobe, Reserved Font Name "Noto". IBM Plex Sans has no Simplified or Traditional Chinese package on npm, so Noto Sans is used for those two.

The license text is at https://openfontlicense.org.

## Provider logos (trademarks)

The icons in `src/assets/providers/` are the logos or favicons of the services the app connects to. They are trademarks of their owners, used only to identify the provider, and are not covered by this repository's MIT license. Downscaled to 64 px from the sources below.

- OpenRouter: https://openrouter.ai/favicon/glyph.png
- LM Studio: https://lmstudio.ai/assets/marketing/logo-192x192.png
- Ollama: https://ollama.com/public/apple-touch-icon.png
- llama.cpp (ggml-org): https://github.com/ggml-org.png
- Anthropic: https://www.anthropic.com (site favicon)
- OpenAI: https://developers.openai.com/favicon.png
- Google Gemini: https://gemini.google.com (site icon)
- xAI: https://x.ai/favicon.ico
- Groq: https://groq.com/apple-touch-icon.png
- Mistral AI: https://mistral.ai/favicon.ico
- DeepSeek: https://www.deepseek.com/favicon.ico
- Meta: https://ai.meta.com (site icon, SVG)
- Qwen: https://qwen.ai (site icon)

## Logos fetched at runtime

Model authors and custom providers without a bundled logo get their icon from the owner's own website at runtime (its favicon or touch icon, found from the homepage). Icons are cached locally in the app data directory and are never redistributed with the app. They are trademarks of their owners, used only to identify the provider or model author.
