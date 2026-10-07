import { api } from "../../lib/ipc";
import { plainAnswer } from "../../lib/chat/plainAnswer";
import { INLINE_TOTAL, inlineTopic, makeInlineProblem } from "../../lib/practice/inline";
import { queryClient, qk } from "../../lib/queries";
import type { Message, Space } from "../../lib/types";

/** Writes the first problem for a "Quiz me" card under an answer and stores the card as a chat message. */
export async function startInlinePractice(opts: { space: Space; threadTitle: string; answer: Message; question: string }): Promise<void> {
  const { space, answer } = opts;
  const topic = inlineTopic(opts.threadTitle, opts.question);
  const context = [...(answer.citations ?? []).map((c) => c.text ?? c.snippet), plainAnswer(answer.content)].join("\n\n");
  const item = await makeInlineProblem({ spaceId: space.id, space, topic, context });
  await api.addMessage({
    threadId: answer.threadId,
    role: "practice",
    content: "",
    meta: {
      practice: { answerId: answer.id, topicKey: topic.key, topicTitle: topic.title, items: [item], index: 0, results: [], total: INLINE_TOTAL },
    },
  });
  queryClient.invalidateQueries({ queryKey: qk.messages(answer.threadId) });
}
