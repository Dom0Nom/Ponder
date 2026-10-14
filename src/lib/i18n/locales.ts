export type Dir = "ltr" | "rtl";
export type FontGroup = "arabic" | "jp" | "kr" | "sc" | "tc" | "devanagari" | "bengali";

export interface LocaleInfo {
  code: string;
  name: string;
  dir: Dir;
  font?: FontGroup;
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "zh-Hans", name: "简体中文", dir: "ltr", font: "sc" },
  { code: "zh-Hant", name: "繁體中文", dir: "ltr", font: "tc" },
  { code: "hi", name: "हिन्दी", dir: "ltr", font: "devanagari" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl", font: "arabic" },
  { code: "bn", name: "বাংলা", dir: "ltr", font: "bengali" },
  { code: "pt-BR", name: "Português (Brasil)", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
  { code: "ur", name: "اردو", dir: "rtl", font: "arabic" },
  { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr", font: "jp" },
  { code: "tr", name: "Türkçe", dir: "ltr" },
  { code: "ko", name: "한국어", dir: "ltr", font: "kr" },
  { code: "vi", name: "Tiếng Việt", dir: "ltr" },
  { code: "it", name: "Italiano", dir: "ltr" },
  { code: "pl", name: "Polski", dir: "ltr" },
  { code: "fa", name: "فارسی", dir: "rtl", font: "arabic" },
];

export const DEFAULT_LOCALE = "en";

export const localeInfo = (code: string): LocaleInfo => LOCALES.find((l) => l.code === code) ?? LOCALES[0];

export const isSupportedLocale = (code: unknown): code is string => typeof code === "string" && LOCALES.some((l) => l.code === code);

/** Maps a BCP-47 tag such as "de-AT" or "zh-TW" to one of the supported codes, else "en". */
export function detectLocale(tag: string | undefined | null): string {
  if (!tag) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase().replace(/_/g, "-");
  const exact = LOCALES.find((l) => l.code.toLowerCase() === lower);
  if (exact) return exact.code;
  const [lang, ...rest] = lower.split("-");
  if (lang === "zh") return rest.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo") ? "zh-Hant" : "zh-Hans";
  if (lang === "pt") return "pt-BR";
  return LOCALES.find((l) => l.code.toLowerCase() === lang)?.code ?? DEFAULT_LOCALE;
}

export const osLocale = () => detectLocale(typeof navigator === "undefined" ? undefined : navigator.language);
