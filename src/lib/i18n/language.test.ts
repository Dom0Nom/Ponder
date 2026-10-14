// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../chat/context";
import { audioAnswerPrompt, outputPrompt } from "../studio/prompts";
import { generateQuiz } from "../placement/logic";
import { essayGradePrompt } from "../exam/essay";
import { examQuestionPrompt } from "../exam/generate";
import { setLocale } from "../../locales";
import { effectiveLanguage, languageInstruction, languageName } from "./language";

afterEach(async () => {
  await setLocale("en");
});

describe("languageInstruction", () => {
  it("names the language in English", () => {
    expect(languageInstruction("de")).toBe("Answer in German.");
    expect(languageInstruction("pt-BR")).toBe("Answer in Brazilian Portuguese.");
    expect(languageInstruction("ja")).toBe("Answer in Japanese.");
    expect(languageName("zh-Hans")).toMatch(/Chinese/);
  });

  it("follows the app language when the space has none", async () => {
    expect(languageInstruction(null)).toBe("Answer in English.");
    expect(languageInstruction(undefined)).toBe("Answer in English.");
    await setLocale("de");
    expect(effectiveLanguage(null)).toBe("de");
    expect(languageInstruction(null)).toBe("Answer in German.");
    expect(languageInstruction("fr")).toBe("Answer in French.");
  });

  it("falls back to the code for unknown tags", () => {
    expect(languageName("zz-invalid-tag-here")).not.toBe("");
  });
});

describe("prompts use the space language", () => {
  const space = (language: string | null) => ({ name: "Biology", strictGrounding: false, language });
  const base = { tutorStyle: "direct" as const, passages: [], focus: null, now: 0, sourceCount: 0 };

  it("chat and voice tutor", () => {
    expect(buildSystemPrompt({ ...base, space: space("es") })).toContain("Answer in Spanish.");
    expect(buildSystemPrompt({ ...base, space: space("es"), voice: true })).toContain("Answer in Spanish.");
  });

  it("studio outputs and the audio hosts", () => {
    const m = { sources: ["Cells"], summaries: [], passages: [{ source: 1, text: "Cells divide." }] };
    expect(outputPrompt("report", m, undefined, "deepDive", "de")).toContain("Answer in German.");
    expect(audioAnswerPrompt(m, "T", [], "Why?", "it")).toContain("Answer in Italian.");
  });

  it("exams give explanations and feedback in the space language", () => {
    const task = { issue: "x", prompt: "p", passages: [{ title: "a", text: "t" }, { title: "b", text: "u" }] };
    expect(essayGradePrompt(task, "my essay", "tr")).toContain("Answer in Turkish.");
    const format = { id: "ged", title: "GED", sections: [] } as never;
    const section = { id: "m", title: "Math", calculator: false } as never;
    const topic = { id: "a", title: "A", description: "d", group: "g" };
    expect(examQuestionPrompt(format, section, [{ topic, n: 1 }], [], "pl")).toContain("Answer in Polish.");
  });

  it("quizzes", async () => {
    let seen = "";
    const llm = {
      model: {
        specificationVersion: "v3",
        provider: "t",
        modelId: "t",
        supportedUrls: {},
        doGenerate: async (o: { prompt: { content: { text?: string }[] }[] }) => {
          seen = JSON.stringify(o.prompt);
          return { content: [{ type: "text", text: "[]" }], finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
        },
      },
      options: () => ({}),
    } as never;
    await generateQuiz(llm, { topics: [{ id: "a", title: "A", description: "d", group: "g" }], perTopic: 1, purpose: "test", language: "ko" }).catch(() => undefined);
    expect(seen).toContain("Answer in Korean.");
  });
});
