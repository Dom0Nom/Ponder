import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useQuiz } from "../../stores/quiz";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/misc";

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
      <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fg px-5 py-3 text-sm text-bg shadow-xl">
        <Spinner className="text-bg" /> {preparing}
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
      description={done ? undefined : current.intro}
      className="w-[min(640px,calc(100vw-32px))]"
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
          <p className="text-4xl font-semibold tabular-nums">
            {correct} / {qs.length}
          </p>
          <p className="mt-2 text-sm text-muted">{s.quiz.resultBody(correct, qs.length)}</p>
        </div>
      ) : (
        <div className="pb-2" data-testid="quiz-question">
          <p className="mb-1 text-xs font-medium text-muted">{s.quiz.progress(i + 1, qs.length)}</p>
          <p className="text-[0.9375rem] font-medium leading-relaxed">{q.question}</p>
          <div role="radiogroup" aria-label={q.question} className="mt-4 space-y-2">
            {q.options.map((opt, k) => {
              const isAnswer = revealed && k === q.answer;
              const isWrongPick = revealed && picked === k && k !== q.answer;
              return (
                <button
                  key={k}
                  role="radio"
                  aria-checked={picked === k}
                  disabled={revealed}
                  onClick={() => setAnswers(answers.map((a, n) => (n === i ? k : a)))}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors",
                    picked === k && !revealed ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                    isAnswer && "border-success bg-success/10",
                    isWrongPick && "border-danger bg-danger-soft",
                  )}
                >
                  <span className="flex-1">{opt}</span>
                  {isAnswer && <Check size={16} className="text-success" />}
                  {isWrongPick && <X size={16} className="text-danger" />}
                </button>
              );
            })}
          </div>
          {revealed && q.explanation && <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{q.explanation}</p>}
        </div>
      )}
    </Dialog>
  );
}
