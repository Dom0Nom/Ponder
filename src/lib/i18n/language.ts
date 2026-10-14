import { getLocale } from "./state";

/** English name of a BCP-47 code ("de" -> "German"); falls back to the code itself. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A space's language; `null` follows the app language. */
export const effectiveLanguage = (spaceLanguage?: string | null): string => spaceLanguage || getLocale();

/** The rule added to prompts so generated text is in the learner's language. Prompts themselves stay in English. */
export function languageInstruction(spaceLanguage?: string | null): string {
  return `Answer in ${languageName(effectiveLanguage(spaceLanguage))}.`;
}
