import { apply } from "../lib/i18n/message";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { checkLocaleFile, englishMessages, runChecks, type Report } from "../../scripts/i18n";
import { formatDate, formatList, formatPercent, formatRelative } from "../lib/i18n/format";
import { compileMessage, compilePlural, msg, plural } from "../lib/i18n/message";
import { LOCALES, detectLocale, localeInfo } from "../lib/i18n/locales";
import { getLocale } from "../lib/i18n/state";
import { loadedLocales, s, setLocale } from ".";

afterEach(async () => {
  await setLocale("en");
});

describe("message files", () => {
  it("are consistent with en.ts", () => {
    const r = runChecks();
    if (r.warnings.length) console.warn(`i18n: ${r.warnings.join("; ")}`);
    expect(r.errors).toEqual([]);
  });

  it("report coverage for every supported language", () => {
    const r = runChecks();
    for (const l of LOCALES) if (l.code !== "en") expect(r.coverage[l.code]).toBeGreaterThanOrEqual(0);
    expect(r.coverage.de).toBeGreaterThan(0);
  });
});

describe("checkLocaleFile", () => {
  const source = {
    "a.plain": "Hello",
    "a.named": "Hi {0}, week {1, number}",
    "a.count": { one: "{0} file", other: "{0} files" },
  };
  const run = (code: string, messages: Record<string, never> | object) => {
    const report: Report = { errors: [], warnings: [], coverage: {} };
    checkLocaleFile(code, messages as never, source, report);
    return report;
  };

  it("accepts a correct file and counts coverage", () => {
    const r = run("de", { "a.named": "Hallo {0}, Woche {1}" });
    expect(r.errors).toEqual([]);
    expect(r.coverage.de).toBeCloseTo(1 / 3);
    expect(r.warnings[0]).toContain("2 of 3 keys not translated yet");
  });

  it("rejects wrong placeholders and unknown keys", () => {
    expect(run("de", { "a.named": "Hallo {0}" }).errors[0]).toContain("placeholders");
    expect(run("de", { "a.plain": "Hallo {0}" }).errors[0]).toContain("placeholders");
    expect(run("de", { "a.unknown": "x" }).errors[0]).toContain("unknown key");
  });

  it("requires the plural categories of the language", () => {
    expect(run("ru", { "a.count": { one: "{0} файл", other: "{0} файла" } }).errors.join()).toContain("missing plural category 'few'");
    expect(run("ru", { "a.count": { one: "{0}", few: "{0}", many: "{0}", other: "{0}" } }).errors).toEqual([]);
    expect(run("ar", { "a.count": { one: "{0}", other: "{0}" } }).errors.join()).toContain("zero");
    expect(run("de", { "a.count": { one: "{0}", few: "{0}", other: "{0}" } }).errors.join()).toContain("not a plural category");
    expect(run("ja", { "a.count": "{0} ファイル" }).errors).toEqual([]);
    expect(run("de", { "a.count": "{0} Dateien" }).errors.join()).toContain("plural needs");
  });

  it("lets non-other plural forms drop the number", () => {
    expect(run("de", { "a.count": { one: "eine Datei", other: "{0} Dateien" } }).errors).toEqual([]);
  });
});

describe("plural selection", () => {
  const forms = (n: number, f: Record<string, string>, locale: string) => compilePlural({ other: "?", ...f }, 0, locale)(n);
  it("en", () => {
    const f = { one: "one", other: "other" };
    expect([0, 1, 2].map((n) => forms(n, f, "en"))).toEqual(["other", "one", "other"]);
  });
  it("ar", () => {
    const f = { zero: "zero", one: "one", two: "two", few: "few", many: "many", other: "other" };
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102].map((n) => forms(n, f, "ar"))).toEqual(["zero", "one", "two", "few", "few", "many", "many", "other", "other"]);
  });
  it("ru", () => {
    const f = { one: "one", few: "few", many: "many", other: "other" };
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => forms(n, f, "ru"))).toEqual(["one", "few", "many", "many", "one", "few", "many"]);
  });
  it("pl", () => {
    const f = { one: "one", few: "few", many: "many", other: "other" };
    expect([1, 2, 5, 12, 22, 25].map((n) => forms(n, f, "pl"))).toEqual(["one", "few", "many", "many", "few", "many"]);
  });
  it("picks the argument given by the index", () => {
    const fn = compilePlural({ one: "{0}: {1} file", other: "{0}: {1} files" }, 1, "en");
    expect(fn("a", 1)).toBe("a: 1 file");
    expect(fn("a", 3)).toBe("a: 3 files");
  });
  it("falls back to other when a category is missing", () => {
    expect(compilePlural({ other: "x {0}" }, 0, "ru")(2)).toBe("x 2");
  });
});

describe("placeholders", () => {
  it("substitute arguments in any order", () => {
    expect(compileMessage("{1} before {0}", "en")("a", "b")).toBe("b before a");
    expect(compileMessage("{0} and {0}", "en")("x")).toBe("x and x");
  });
  it("format numbers and percents with the locale", () => {
    expect(compileMessage("{0, number}", "en")(1234.5)).toBe("1,234.5");
    expect(compileMessage("{0, number}", "de")(1234.5)).toBe("1.234,5");
    expect(compileMessage("{0, percent}", "en")(0.256)).toBe("26%");
    expect(compileMessage("{0, percent}", "de")(0.5).replace(/\s/g, " ")).toBe("50 %");
    expect(compileMessage("{0, minutes}", "en")(5)).toBe("5 min");
  });
  it("leave other braces alone", () => {
    expect(compileMessage("type {{c1::answer}}", "en")()).toBe("type {{c1::answer}}");
  });
  it("typed templates keep the call signature", () => {
    const m = msg<[n: number, m: number]>("Week {0} of {1}");
    const p = plural<[n: number]>({ one: "{0} source", other: "{0} sources" });
    expect(compileMessage(m.template, "en")(2, 8)).toBe("Week 2 of 8");
    expect(compilePlural(p.forms, p.index, "en")(1)).toBe("1 source");
  });
});

describe("runtime", () => {
  it("starts in English", () => {
    expect(getLocale()).toBe("en");
    expect(s.common.cancel).toBe("Cancel");
    expect(s.studio.planWeek(2, 8)).toBe("Week 2 of 8");
    expect(s.sources.importedMany(1)).toBe("Imported 1 source");
    expect(s.sources.importedMany(3)).toBe("Imported 3 sources");
  });

  it("loads a language lazily and rewrites the live object in place", async () => {
    const group = s.shell.groups;
    expect(loadedLocales()).not.toContain("de");
    await setLocale("de");
    expect(loadedLocales()).toContain("de");
    expect(group).toBe(s.shell.groups);
    expect(s.common.cancel).toBe("Abbrechen");
    expect(s.shell.groups.today).toBe("Heute");
    expect(s.common.backTo("Mathe")).toBe("Zurück zu Mathe");
    expect(s.home.sources(1)).toBe("1 Quelle");
    expect(s.home.sources(4)).toBe("4 Quellen");
    expect(s.studio.coursePct(0.5).replace(/\s/g, " ")).toBe("50 % erledigt");
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("falls back to English for keys a language does not have", () => {
    const out: Record<string, unknown> = {};
    apply({ a: "Cancel", b: { c: msg<[n: number]>("Week {0}") } }, out, { a: "Abbrechen" }, "de");
    expect(out.a).toBe("Abbrechen");
    expect((out.b as { c: (n: number) => string }).c(2)).toBe("Week 2");
  });

  it("returns to English without a reload", async () => {
    await setLocale("de");
    await setLocale("en");
    expect(s.common.cancel).toBe("Cancel");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English for unknown codes and languages without a file", async () => {
    expect(await setLocale("xx")).toBe("en");
    expect(s.common.cancel).toBe("Cancel");
  });

  it("sets right-to-left for Arabic, Urdu and Persian", async () => {
    for (const code of ["ar", "ur", "fa"]) {
      await setLocale(code);
      expect(document.documentElement.dir).toBe("rtl");
      expect(document.documentElement.lang).toBe(code);
      expect(localeInfo(code).dir).toBe("rtl");
    }
    await setLocale("ja");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("language detection", () => {
  it("maps system languages to supported codes", () => {
    expect(detectLocale("de-AT")).toBe("de");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("zh-TW")).toBe("zh-Hant");
    expect(detectLocale("zh-Hant-HK")).toBe("zh-Hant");
    expect(detectLocale("zh-CN")).toBe("zh-Hans");
    expect(detectLocale("pt-PT")).toBe("pt-BR");
    expect(detectLocale("pt-BR")).toBe("pt-BR");
    expect(detectLocale("sv")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });
  it("lists 20 languages", () => {
    expect(LOCALES).toHaveLength(20);
  });
});

describe("format helpers", () => {
  it("follow the active locale", async () => {
    const d = new Date(2026, 8, 4, 14, 5);
    expect(formatDate(d, { month: "short", day: "numeric" })).toBe("Sep 4");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(formatRelative(-3, "day", "long")).toBe("3 days ago");
    await setLocale("de");
    expect(formatDate(d, { month: "short", day: "numeric" })).toBe("4. Sept.");
    expect(formatList(["a", "b", "c"])).toBe("a, b und c");
    expect(formatRelative(-3, "day", "long")).toBe("vor 3 Tagen");
  });
});

describe("source of truth", () => {
  it("has flat keys for every string", () => {
    const keys = Object.keys(englishMessages());
    expect(keys).toContain("shell.groups.pinned");
    expect(keys.every((k) => !k.startsWith(".") && !k.endsWith(".") && !k.includes(".."))).toBe(true);
  });
});
