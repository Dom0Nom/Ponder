import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleQuestion, PencilLine, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { ErrorState } from "../../components/ui/misc";
import { Reveal } from "../../components/motion/Reveal";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { DictateButton } from "../speech/DictateButton";
import { ListenButton } from "../speech/ListenButton";
import { api } from "../../lib/ipc";
import { gatherForTask } from "../../lib/context/task";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { generateNoThinking } from "../../lib/steps/check";
import { feynmanPrompt, MIN_WORDS, parseFeynman, wordCount, type FeynmanTurn } from "../../lib/feynman/feynman";
import { invalidateCards, useSources } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";

const LABEL = "text-label font-semibold text-muted";
const ICON_BTN = "inline-flex size-7 items-center justify-center rounded-item text-muted hover:bg-fill hover:text-fg";

function Section({ title, items, testId, tone }: { title: string; items: string[]; testId: string; tone?: "danger" }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId}>
      <h4 className={LABEL}>{title}</h4>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-body text-fg-secondary">
        {items.map((x, i) => (
          <li key={i} className={tone === "danger" ? "marker:text-danger" : undefined}>
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Clarity({ value, previous }: { value: number; previous?: number }) {
  return (
    <div className="flex items-center gap-2" data-testid="feynman-clarity" data-value={value}>
      <span className={LABEL}>{s.feynman.clarity}</span>
      <span className="flex gap-1" aria-label={s.feynman.clarityOf(value)} role="img">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn("size-2 rounded-full", n <= value ? "bg-primary" : "bg-fill")} />
        ))}
      </span>
      {previous != null && previous !== value && <span className="text-label text-muted">{s.feynman.from(previous)}</span>}
    </div>
  );
}

export function FeynmanPanel({ space, onBack }: { space: Space; onBack: () => void }) {
  const sources = useSources(space.id);
  const abilities = useQuery({ queryKey: ["abilities", space.id], queryFn: () => api.abilitiesList(space.id) });
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [rounds, setRounds] = useState<FeynmanTurn[]>([]);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const suggestions = [
    ...(abilities.data ?? []).slice().sort((a, b) => a.theta - b.theta).map((a) => a.topicTitle),
    ...(sources.data ?? []).filter((x) => x.status === "ready").map((x) => x.title),
  ]
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 4);
  const last = rounds.at(-1);
  const words = wordCount(text);

  const check = async (withAnswer?: string) => {
    if (!topic.trim()) return setError(new Error(s.feynman.needTopic));
    if (words < MIN_WORDS) return setError(new Error(s.feynman.tooShort(MIN_WORDS)));
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setSaved(0);
    setEditing(false);
    try {
      const llm = await resolveChatModel(space);
      const hits = await gatherForTask({ spaceId: space.id, topic, queries: [text.slice(0, 400)], llm, maxTokens: 10_000 })
        .then((m) => m.passages)
        .catch(() => []);
      const prompt = feynmanPrompt({
        topic,
        explanation: text,
        passages: hits.map((h) => ({ source: h.label ? `${h.sourceTitle} · ${h.label}` : h.sourceTitle, text: h.text })),
        history: rounds,
        answer: withAnswer,
      });
      const reply = await generateNoThinking(llm, { prompt, temperature: 0.3, abortSignal: ac.signal });
      if (ac.signal.aborted) return;
      const feedback = parseFeynman(reply);
      if (!feedback) throw new Error(s.feynman.unreadable);
      setRounds((rs) => [...rs, { explanation: text, answer: withAnswer, feedback }]);
      setAnswer("");
      if (feedback.mistakes.length) {
        try {
          await api.mistakesAdd(
            space.id,
            feedback.mistakes.map((m) => ({ origin: s.feynman.origin, question: topic.trim(), given: m.said, correct: m.correct, topic: topic.trim() })),
          );
          invalidateCards(space.id);
          setSaved(feedback.mistakes.length);
        } catch (e) {
          console.error(e);
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof NoModelError ? new Error(s.chat.noModel) : e);
        if (!withAnswer) setEditing(true);
      }
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const restart = () => {
    abort.current?.abort();
    setRounds([]);
    setText("");
    setAnswer("");
    setError(null);
    setBusy(false);
    setEditing(true);
  };

  const footer = editing ? (
    <Button variant="primary" className="flex-1" onClick={() => check()} disabled={busy || !topic.trim() || words < MIN_WORDS} data-testid="feynman-check">
      {rounds.length ? s.feynman.checkAgain : s.feynman.check}
    </Button>
  ) : (
    <>
      <Button variant="secondary" className="flex-1" onClick={() => setEditing(true)} disabled={busy} data-testid="feynman-revise">
        <PencilLine size={14} /> {s.feynman.revise}
      </Button>
      <Button variant="ghost" onClick={restart} title={s.feynman.restart} aria-label={s.feynman.restart}>
        <RotateCcw size={14} />
      </Button>
    </>
  );

  return (
    <StudioSubpanel title={s.feynman.title} onBack={onBack} footer={footer} testId="feynman-panel">
      <p className="text-body text-muted">{s.feynman.intro}</p>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>{s.feynman.topic}</span>
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={s.feynman.topicPlaceholder} disabled={!editing || rounds.length > 0} />
      </label>
      {editing && !rounds.length && suggestions.length > 0 && !topic && (
        <div className="-mt-1.5 flex flex-wrap gap-1.5" data-testid="feynman-suggestions">
          {suggestions.map((t) => (
            <button key={t} type="button" onClick={() => setTopic(t)} className="max-w-full truncate rounded-full bg-fill px-2.5 py-0.5 text-label text-fg-secondary hover:bg-fill-hover">
              {t}
            </button>
          ))}
        </div>
      )}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className={LABEL}>{s.feynman.explanation}</span>
            <DictateButton
              className={ICON_BTN}
              onText={(t) => setText((cur) => [cur.trim(), t].filter(Boolean).join(" "))}
            />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={s.feynman.placeholder}
            aria-label={s.feynman.explanation}
            data-testid="feynman-text"
          />
          <span className="text-label text-muted">{words < MIN_WORDS ? s.feynman.tooShort(MIN_WORDS) : s.feynman.words(words)}</span>
        </div>
      ) : (
        <div className="rounded-pane bg-fill-subtle px-3 py-2 text-body text-fg-secondary" data-testid="feynman-explanation">
          {last?.explanation ?? text}
        </div>
      )}
      {error != null && <ErrorState title={s.feynman.failed} error={error} onRetry={() => check(last && !editing ? answer : undefined)} />}
      {busy && <GeneratingStatus label={s.feynman.checking} />}
      {last && !busy && !editing && (
        <Reveal className="flex flex-col gap-3.5" data-testid="feynman-feedback">
          <Clarity value={last.feedback.clarity} previous={rounds.at(-2)?.feedback.clarity} />
          <p className="text-body text-fg">{last.feedback.verdict}</p>
          <Section title={s.feynman.strengths} items={last.feedback.strengths} testId="feynman-strengths" />
          <Section title={s.feynman.gaps} items={last.feedback.gaps} testId="feynman-gaps" />
          {last.feedback.mistakes.length > 0 && (
            <div data-testid="feynman-mistakes">
              <h4 className={LABEL}>{s.feynman.mistakes}</h4>
              <ul className="mt-1 flex flex-col gap-2">
                {last.feedback.mistakes.map((m, i) => (
                  <li key={i} className="rounded-pane bg-danger-soft px-3 py-2 text-body">
                    <span className="text-danger line-through decoration-danger/60">{m.said}</span>
                    <span className="mt-0.5 block text-fg">{m.correct}</span>
                  </li>
                ))}
              </ul>
              {saved > 0 && <p className="mt-1.5 text-label text-muted">{s.feynman.savedMistakes(saved)}</p>}
            </div>
          )}
          <Section title={s.feynman.jargon} items={last.feedback.jargon} testId="feynman-jargon" />
          {last.feedback.question && (
            <div className="flex flex-col gap-1.5 border-t border-divider pt-3.5" data-testid="feynman-question">
              <div className="flex items-center justify-between">
                <h4 className={cn(LABEL, "flex items-center gap-1.5")}>
                  <MessageCircleQuestion size={13} /> {s.feynman.newcomerAsks}
                </h4>
                <div className="flex items-center">
                  <ListenButton id="feynman-question" text={last.feedback.question} className={ICON_BTN} />
                  <DictateButton className={ICON_BTN} onText={(t) => setAnswer((cur) => [cur.trim(), t].filter(Boolean).join(" "))} />
                </div>
              </div>
              <p className="text-body text-fg">{last.feedback.question}</p>
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder={s.feynman.answerPlaceholder} aria-label={s.feynman.answer} data-testid="feynman-answer" />
              <Button variant="secondary" size="sm" className="self-end" disabled={!answer.trim() || busy} onClick={() => check(answer)} data-testid="feynman-answer-send">
                {s.feynman.sendAnswer}
              </Button>
            </div>
          )}
          {rounds.length > 1 && <p className="text-label text-muted">{s.feynman.rounds(rounds.length)}</p>}
        </Reveal>
      )}
    </StudioSubpanel>
  );
}
