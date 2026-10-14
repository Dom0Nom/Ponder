import { api } from "../ipc";
import { queryClient, qk } from "../queries";
import { resolveChatModel } from "../chat/llm";
import { storedControls } from "../chat/controls";
import { runTurn } from "../chat/runner";
import type { Course, Lesson, Space, SpaceCurriculum, TopicRef } from "../types";
import { useQuiz } from "../../stores/quiz";
import { useUi } from "../../stores/ui";
import { useFocusStore } from "../../features/focus/focusStore";
import { generateQuiz, gradeQuiz, pickPlacementTopics, type TopicResult } from "./logic";
import { resolveSolver } from "../quality/answerCheck";
import { curriculumById } from "./curricula";
import { recordQuizMistakes } from "../srs/mistakes";
import { s } from "../strings";

const lang = (c: SpaceCurriculum) => curriculumById(c.curriculumId)?.language ?? "en";

async function threadFor(spaceId: string, title: string): Promise<string> {
  const ui = useUi.getState();
  const threads = await api.listThreads(spaceId);
  const active = threads.find((t) => t.id === ui.activeThread[spaceId]);
  if (active) return active.id;
  const t = await api.createThread(spaceId, title);
  ui.setActiveThread(spaceId, t.id);
  queryClient.invalidateQueries({ queryKey: qk.threads(spaceId) });
  return t.id;
}

function invalidate(spaceId: string) {
  for (const k of [qk.levels(spaceId), qk.assessments(spaceId), qk.journal(spaceId), qk.courses(spaceId), qk.memory]) {
    queryClient.invalidateQueries({ queryKey: k });
  }
}

export function summarizeLevels(results: TopicResult[], topics: TopicRef[]): { strong: string[]; weak: string[] } {
  const title = (id: string) => topics.find((t) => t.id === id)?.title ?? id;
  return {
    strong: results.filter((r) => r.level === "strong").map((r) => title(r.topicId)),
    weak: results.filter((r) => r.level === "weak").map((r) => title(r.topicId)),
  };
}

/** Diagnostic test across the curriculum; stores a level per tested topic. Returns null if cancelled. */
export async function runPlacement(space: Space, curriculum: SpaceCurriculum): Promise<TopicResult[] | null> {
  const quiz = useQuiz.getState();
  quiz.setPreparing(s.failures.writingYourPlacementQuestions);
  try {
    const llm = await resolveChatModel(space);
    const topics = pickPlacementTopics(curriculum.topics, 8);
    const questions = await generateQuiz(llm, {
      topics,
      perTopic: 2,
      solver: await resolveSolver(llm, space),
      language: lang(curriculum),
      purpose: `placement test for "${curriculum.title}" to estimate what the learner already knows; mix easy and medium questions`,
    });
    const assessment = await api.assessmentCreate(space.id, "placement", null, `Placement: ${curriculum.title}`, questions);
    const answers = await quiz.ask(
      `Placement check: ${curriculum.title}`,
      questions,
      "Answer what you can and skip what you don't know. This sets your starting point; there's no pass or fail.",
    );
    if (!answers) return null;
    const { score, byTopic } = gradeQuiz(questions, answers);
    await api.assessmentComplete(assessment.id, answers.map((a) => a ?? -1), score);
    await recordQuizMistakes(space.id, "placement", questions, answers, curriculum.topics);
    for (const r of byTopic) await api.topicLevelSet(space.id, r.topicId, r.level, `${r.correct}/${r.total} in placement`);
    const { strong, weak } = summarizeLevels(byTopic, curriculum.topics);
    const lines = [
      `Score: ${Math.round(score * 100)}%`,
      strong.length ? `Strong: ${strong.join(", ")}` : "",
      weak.length ? `Needs work: ${weak.join(", ")}` : "",
    ].filter(Boolean);
    await api.addJournal(space.id, "placement", `Placement check · ${curriculum.title}`, lines.join("\n"));
    if (weak.length || strong.length) {
      const fact = `${curriculum.title} placement: ${[strong.length ? `strong in ${strong.join(", ")}` : "", weak.length ? `needs work on ${weak.join(", ")}` : ""].filter(Boolean).join("; ")}`;
      await api.addMemory(fact.slice(0, 480), "tutor", space.id).catch(() => {});
    }
    invalidate(space.id);
    return byTopic;
  } finally {
    quiz.setPreparing(null);
  }
}

/**
 * Three-question prerequisite check before a topic. If the learner misses most of it, the chat
 * teaches the prerequisites first; otherwise it starts the topic.
 */
export async function startTopic(space: Space, curriculum: SpaceCurriculum, topic: TopicRef): Promise<void> {
  const quiz = useQuiz.getState();
  const prereqs = (topic.prereqs ?? []).map((id) => curriculum.topics.find((t) => t.id === id)).filter((t): t is TopicRef => !!t);
  const checkTopics = prereqs.length ? prereqs.slice(0, 3) : [{ ...topic, title: `Foundations needed for ${topic.title}` }];
  quiz.setPreparing(s.failures.writingAQuickPrerequisiteCheck);
  let teachFirst: string[] = [];
  try {
    const llm = await resolveChatModel(space);
    const questions = (
      await generateQuiz(llm, {
        topics: checkTopics,
        perTopic: Math.ceil(3 / checkTopics.length),
        solver: await resolveSolver(llm, space),
        language: lang(curriculum),
        purpose: `quick check of the prerequisites for "${topic.title}" (${topic.description}); test only what the learner must already know before starting it`,
      })
    ).slice(0, 3);
    const assessment = await api.assessmentCreate(space.id, "prereq", topic.id, `Before: ${topic.title}`, questions);
    const answers = await quiz.ask(`Before you start: ${topic.title}`, questions, "Three quick questions on what this topic builds on.");
    if (!answers) return;
    const { score, byTopic } = gradeQuiz(questions, answers);
    await api.assessmentComplete(assessment.id, answers.map((a) => a ?? -1), score);
    await recordQuizMistakes(space.id, "prerequisite check", questions, answers, curriculum.topics);
    for (const r of byTopic) if (prereqs.some((p) => p.id === r.topicId)) await api.topicLevelSet(space.id, r.topicId, r.level, `${r.correct}/${r.total} in prerequisite check`);
    const missed = questions.filter((q, i) => answers[i] !== q.answer);
    if (score < 2 / 3) teachFirst = missed.map((q) => q.question);
  } finally {
    quiz.setPreparing(null);
  }
  const threadId = await threadFor(space.id, topic.title);
  const prereqNames = prereqs.map((p) => p.title).join(", ") || "the basics it needs";
  const userText = teachFirst.length
    ? `I want to learn "${topic.title}", but I missed these prerequisite questions:\n${teachFirst.map((q) => `- ${q}`).join("\n")}\nTeach me the prerequisites first (${prereqNames}), then check I've got them before we move on.`
    : `I'm ready to start "${topic.title}" (${topic.description}). Teach it to me step by step, starting from the core idea.`;
  invalidate(space.id);
  const llm = await resolveChatModel(space);
  await runTurn({ space, threadId, llm, tutorStyle: space.tutorStyle, controls: storedControls(llm), focus: useFocusStore.getState().state, userText });
}

export async function studyLesson(space: Space, course: Course, lesson: Lesson): Promise<void> {
  const ui = useUi.getState();
  ui.openViewer({ sourceId: course.sourceId, start: lesson.startOffset, end: lesson.endOffset });
  if (lesson.status === "todo") await api.lessonSetStatus(lesson.id, "doing");
  const { text } = await api.getSourceText(course.sourceId);
  const chapter = text.slice(lesson.startOffset, lesson.endOffset);
  const threadId = await threadFor(space.id, course.title);
  invalidate(space.id);
  const llm = await resolveChatModel(space);
  await runTurn({
    space,
    threadId,
    llm,
    tutorStyle: space.tutorStyle,
    controls: storedControls(llm),
    focus: useFocusStore.getState().state,
    userText: `Let's study "${lesson.title}" from "${course.title}". Give me an overview of the chapter, then teach it section by section.`,
    query: lesson.title,
    systemExtra: `The learner is working through this chapter of "${course.title}". Teach from it and cite the passages when they're provided:\n"""\n${chapter.slice(0, 12000)}\n"""`,
  });
}

/** Three questions on the chapter; ≥ 2 right marks the lesson done. */
export async function checkLesson(space: Space, course: Course, lesson: Lesson): Promise<number | null> {
  const quiz = useQuiz.getState();
  quiz.setPreparing(s.failures.writingQuestionsOnThisChapter);
  try {
    const llm = await resolveChatModel(space);
    const { text } = await api.getSourceText(course.sourceId);
    const chapter = text.slice(lesson.startOffset, lesson.endOffset);
    const topic: TopicRef = { id: lesson.id, title: lesson.title, description: `chapter of ${course.title}`, group: course.title };
    const questions = (await generateQuiz(llm, { topics: [topic], perTopic: 3, context: chapter, purpose: "check understanding of this chapter", language: space.language, solver: await resolveSolver(llm, space) })).slice(0, 3);
    const assessment = await api.assessmentCreate(space.id, "lesson", null, `Lesson: ${lesson.title}`, questions);
    const answers = await quiz.ask(`Check: ${lesson.title}`, questions);
    if (!answers) return null;
    const { score } = gradeQuiz(questions, answers);
    await api.assessmentComplete(assessment.id, answers.map((a) => a ?? -1), score);
    await recordQuizMistakes(space.id, `lesson: ${lesson.title}`, questions, answers);
    await api.lessonSetStatus(lesson.id, score >= 2 / 3 ? "done" : "doing", score);
    invalidate(space.id);
    return score;
  } finally {
    quiz.setPreparing(null);
  }
}
