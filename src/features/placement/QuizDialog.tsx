import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { NumberPop } from "../../components/motion/NumberPop";
import { useStayMounted } from "../../components/motion/useStayMounted";
import { useQuiz } from "../../stores/quiz";
import { s } from "../../lib/strings";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { ChoiceOption } from "../../components/ui/choice";
import { Reveal } from "../../components/motion/Reveal";
import { PonderMark } from "../../components/brand/PonderMark";

function PreparingPill({ text, gone }: { text: string; gone?: boolean }) {
  const mounted = useStayMounted(!gone, 250);
  if (!mounted) return null;
  return (
    <div
      role="status"
      inert={!!gone}
      className={cn(
        "t-toast fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-pane border border-border bg-surface px-4 py-2.5 shadow-menu",
        !gone && "is-open",
      )}
    >
      <PonderMark size={20} state="generating" /> {text}
    </div>
  );
}

/** Global quiz runner: one question at a time, answer feedback, then a score screen. */
export function QuizLayer() {
  const current = useQuiz((st) => st.current);
  const preparing = useQuiz((st) => st.preparing);
  const finish = useQuiz((st) => st.finish);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [revealed, setRevealed] = useState(false);
  const last = useRef(preparing ?? "");
  if (preparing) last.current = preparing;

  useEffect(() => {
    setI(0);
    setAnswers(current ? current.questions.map(() => null) : []);
    setRevealed(false);
  }, [current]);

  const pill = <PreparingPill text={last.current} gone={!preparing || !!current} />;
  if (!current) return pill;

  const qs = current.questions;
  const done = i >= qs.length;
  const q = qs[Math.min(i, qs.length - 1)];
  const picked = answers[i] ?? null;
  const correct = answers.filter((a, k) => a === qs[k].answer).length;

  return (
    <>
    {pill}
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
              className="me-auto"
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
            <NumberPop text={String(correct)} popKey={correct} onMount /> / {qs.length}
          </p>
          <p className="mt-3 text-muted">{correct === qs.length ? s.quiz.resultAll : correct >= qs.length / 2 ? s.quiz.resultGood : s.quiz.resultLow}</p>
        </div>
      ) : (
        <div key={i} className="t-page-enter flex flex-col gap-3" data-testid="quiz-question">
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
          {revealed && q.explanation && <Reveal className="rounded-pane bg-fill-subtle px-3 py-2.5 text-fg-secondary">{q.explanation}</Reveal>}
        </div>
      )}
    </Dialog>
    </>
  );
}
