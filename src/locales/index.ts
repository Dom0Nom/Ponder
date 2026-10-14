import { apply, type Messages, type Resolve } from "../lib/i18n/message";
import { DEFAULT_LOCALE, isSupportedLocale } from "../lib/i18n/locales";
import { getLocale, setCurrentLocale } from "../lib/i18n/state";
import { loadFonts } from "../lib/i18n/fonts";
import { en } from "./en";

export type Strings = Resolve<typeof en>;

/** The live string table. Leaves are rewritten in place by `setLocale`, so references to groups stay valid. */
export const s = {} as Strings;
apply(en, s, {}, DEFAULT_LOCALE);

const loaders = import.meta.glob<Messages>(["./*.json", "!./en.json"], { import: "default" });
const cache = new Map<string, Messages>();
let seq = 0;

export const loadedLocales = () => [...cache.keys()];

export async function loadMessages(code: string): Promise<Messages> {
  if (code === DEFAULT_LOCALE) return {};
  const hit = cache.get(code);
  if (hit) return hit;
  const load = loaders[`./${code}.json`];
  let messages: Messages = {};
  if (load) {
    try {
      messages = await load();
    } catch {
      messages = {};
    }
  }
  cache.set(code, messages);
  return messages;
}

export async function setLocale(code: string): Promise<string> {
  const target = isSupportedLocale(code) ? code : DEFAULT_LOCALE;
  const mine = ++seq;
  const messages = await loadMessages(target);
  if (mine !== seq) return getLocale();
  apply(en, s, messages, target);
  setCurrentLocale(target);
  void loadFonts(target);
  return target;
}

export { getLocale };
