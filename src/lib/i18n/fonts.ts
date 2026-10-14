import { localeInfo, type FontGroup } from "./locales";

const importers: Record<FontGroup, (() => Promise<unknown>)[]> = {
  arabic: [
    () => import("@fontsource/ibm-plex-sans-arabic/arabic-400.css"),
    () => import("@fontsource/ibm-plex-sans-arabic/arabic-500.css"),
    () => import("@fontsource/ibm-plex-sans-arabic/arabic-600.css"),
    () => import("@fontsource/ibm-plex-sans-arabic/arabic-700.css"),
  ],
  devanagari: [
    () => import("@fontsource/ibm-plex-sans-devanagari/devanagari-400.css"),
    () => import("@fontsource/ibm-plex-sans-devanagari/devanagari-500.css"),
    () => import("@fontsource/ibm-plex-sans-devanagari/devanagari-600.css"),
    () => import("@fontsource/ibm-plex-sans-devanagari/devanagari-700.css"),
  ],
  bengali: [
    () => import("@fontsource/noto-sans-bengali/bengali-400.css"),
    () => import("@fontsource/noto-sans-bengali/bengali-500.css"),
    () => import("@fontsource/noto-sans-bengali/bengali-600.css"),
    () => import("@fontsource/noto-sans-bengali/bengali-700.css"),
  ],
  jp: [() => import("@fontsource/ibm-plex-sans-jp/japanese-400.css"), () => import("@fontsource/ibm-plex-sans-jp/japanese-600.css")],
  kr: [() => import("@fontsource/ibm-plex-sans-kr/korean-400.css"), () => import("@fontsource/ibm-plex-sans-kr/korean-600.css")],
  sc: [() => import("@fontsource/noto-sans-sc/chinese-simplified-400.css"), () => import("@fontsource/noto-sans-sc/chinese-simplified-600.css")],
  tc: [() => import("@fontsource/noto-sans-tc/chinese-traditional-400.css"), () => import("@fontsource/noto-sans-tc/chinese-traditional-600.css")],
};

const loaded = new Set<FontGroup>();

/** Loads the bundled fallback font for the language's script. Latin, Greek and Cyrillic come from IBM Plex Sans. */
export async function loadFonts(code: string): Promise<void> {
  const group = localeInfo(code).font;
  if (!group || loaded.has(group)) return;
  loaded.add(group);
  try {
    await Promise.all(importers[group].map((load) => load()));
  } catch {
    loaded.delete(group);
  }
}
