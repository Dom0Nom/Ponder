import { api } from "../ipc";
import { gatherForTask } from "../context/task";
import { resolveChatModel } from "../chat/llm";
import { generateQuiz, gradeQuiz } from "../placement/logic";
import { resolveSolver } from "../quality/answerCheck";
import type { Space } from "../types";
import { useQuiz } from "../../stores/quiz";
import { recordQuizMistakes } from "./mistakes";

/** A 5-question quiz drawn from the space's sources; wrong answers land in the mistake notebook. */
export async function quizSpace(space: Space, focus?: string): Promise<{ score: number; mistakes: number } | null> {
  const quiz = useQuiz.getState();
  quiz.setPreparing("Writing questions from your sources…");
  try {
    const llm = await resolveChatModel(space);
    const material = await gatherForTask({ spaceId: space.id, topic: focus?.trim() ?? "", llm, maxTokens: 12_000 });
    if (!material.passages.length) throw new Error("This space has no ready sources to quiz you on.");
    const context = material.passages.map((h) => `(${h.sourceTitle}${h.label ? ` · ${h.label}` : ""}) ${h.text}`).join("\n\n");
    const topic = { id: "space", title: focus?.trim() || space.name, description: "the learner's sources", group: space.name };
    const questions = (await generateQuiz(llm, { topics: [topic], perTopic: 5, context, purpose: "practice quiz on the learner's own sources", solver: await resolveSolver(llm, space) })).slice(0, 5);
    const answers = await quiz.ask(`Quiz: ${topic.title}`, questions);
    if (!answers) return null;
    const { score } = gradeQuiz(questions, answers);
    const assessment = await api.assessmentCreate(space.id, "lesson", null, `Quiz: ${topic.title}`, questions);
    await api.assessmentComplete(assessment.id, answers.map((a) => a ?? -1), score);
    const mistakes = await recordQuizMistakes(space.id, "quiz", questions, answers);
    return { score, mistakes };
  } finally {
    quiz.setPreparing(null);
  }
}
