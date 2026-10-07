import { useEffect, useState } from "react";
import { useQuiz } from "../../stores/quiz";
import { s } from "../../lib/strings";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { ChoiceOption } from "../../components/ui/choice";
import { PonderMark } from "../../components/brand/PonderMark";

/** Global quiz runner: one question at a time, answer feedback, then a score screen. */
export function QuizLayer() {
  const current = useQuiz((st) => st.current);
  const preparing = useQuiz((st) => st.preparing);
  const finish = useQuiz((st) => st.finish);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setI(0);
    setAnswers(current ? current.questions.map(() => null) : []);
    setRevealed(false);
  }, [current]);

  if (!current) {
    return preparing ? (
      <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-pane border border-border bg-surface px-4 py-2.5 shadow-menu">
        <PonderMark size={20} state="generating" /> {preparing}
      </div>
    ) : null;
  }

  const qs = current.questions;
  const done = i >= qs.length;
  const q = qs[Math.min(i, qs.length - 1)];
  const picked = answers[i] ?? null;
  const correct = answers.filter((a, k) => a === qs[k].answer).length;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish(null)}
      title={current.title}
      className="w-[min(562px,calc(100vw-32px))]"
      footer={
        done ? (
          <Button variant="primary" onClick={() => finish(answers)}>
            {s.common.done}
          </Button>
        ) : revealed ? (
          <Button
            variant="primary"
            onClick={() => {
              setRevealed(false);
              setI(i + 1);
            }}
          >
            {i + 1 < qs.length ? s.quiz.next : s.quiz.seeResult}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                setRevealed(true);
              }}
            >
              {s.quiz.dontKnow}
            </Button>
            <Button variant="primary" disabled={picked == null} onClick={() => setRevealed(true)}>
              {s.quiz.check}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="py-6 text-center" data-testid="quiz-result">
          <p className="text-timer font-semibold tabular-nums">
            {correct} / {qs.length}
          </p>
          <p className="mt-3 text-muted">{s.quiz.resultBody(correct, qs.length)}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="quiz-question">
          <p className="text-label font-semibold text-muted">{s.quiz.progress(i + 1, qs.length)}</p>
          <p className="text-title font-medium">{q.question}</p>
          <div role="radiogroup" aria-label={q.question} className="flex flex-col gap-3">
            {q.options.map((opt, k) => (
              <ChoiceOption
                key={k}
                label={opt}
                selected={picked === k}
                state={revealed && k === q.answer ? "correct" : revealed && picked === k ? "wrong" : "idle"}
                disabled={revealed}
                onClick={() => setAnswers(answers.map((a, n) => (n === i ? k : a)))}
              />
            ))}
          </div>
          {revealed && q.explanation && <p className="rounded-pane bg-fill-subtle px-3 py-2.5 text-fg-secondary">{q.explanation}</p>}
        </div>
      )}
    </Dialog>
  );
}
