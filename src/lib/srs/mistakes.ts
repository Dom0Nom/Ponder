import { api } from "../ipc";
import { invalidateCards } from "../queries";
import type { QuizQuestion, TopicRef } from "../types";

/** Every wrong or skipped quiz answer goes to the mistake notebook and comes back as a review card. */
export async function recordQuizMistakes(
  spaceId: string,
  origin: string,
  questions: QuizQuestion[],
  answers: (number | null)[],
  topics: TopicRef[] = [],
): Promise<number> {
  const items = questions
    .map((q, i) => ({ q, a: answers[i] }))
    .filter(({ q, a }) => a !== q.answer)
    .map(({ q, a }) => ({
      origin,
      question: q.question,
      given: a != null && a >= 0 ? q.options[a] : null,
      correct: q.options[q.answer],
      explanation: q.explanation || null,
      topic: topics.find((t) => t.id === q.topicId)?.title ?? null,
      options: q.options,
    }));
  if (!items.length) return 0;
  await api.mistakesAdd(spaceId, items);
  invalidateCards(spaceId);
  return items.length;
}
