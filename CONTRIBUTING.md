# Contributing

## Development

```sh
bun install
bun run tauri dev     # the app
bun run dev           # UI only, in a browser with a mocked backend
bun run typecheck
bun run test          # Vitest, includes the locale check
bun run e2e           # Playwright against the mocked backend
cd src-tauri && cargo test
```

See `CLAUDE.md` for conventions (strings, colors, motion, migrations, commands).

## Translations

- `src/locales/en.ts` is the English source. Text with values uses `msg<[...]>("Week {0} of {1}")`; counts use `plural<[...]>({ one: "…", other: "…" })`.
- `src/locales/en.json` is generated from it: `bun scripts/i18n.ts extract`. Don't edit it by hand.
- Each language is `src/locales/<code>.json` with flat keys (`"common.cancel": "Abbrechen"`). Plural values are objects with the categories your language uses (`Intl.PluralRules`), e.g. Russian `one`, `few`, `many`, `other`.
- Keep placeholders (`{0}`, `{1, number}`) and "Ponder" unchanged. Keep keyboard keys and brand names as they are.
- A key missing from a language file shows English; that is "not translated yet", not an error.
- `bun scripts/i18n.ts check` (also part of `bun run test` and CI) fails on wrong placeholders, wrong plural categories, unknown keys and literal UI text in `.tsx` files.
- Glossaries for consistent terms are in `src/locales/glossary/<code>.json`. To machine-translate new or changed keys: `OPENROUTER_API_KEY=… bun scripts/translate.ts --langs de,fr` (only missing or changed keys are sent).
- Native menus, the tray and notifications use the `native.*` keys from the same files.
