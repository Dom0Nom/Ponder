import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { api } from "../../lib/ipc";
import { generateNoThinking } from "../../lib/steps/check";
import { s } from "../../lib/strings";
import type { Source, Space } from "../../lib/types";
import {
  checkpoints,
  clock,
  feedbackPrompt,
  parseFeedback,
  parseQuestion,
  parseTranscript,
  questionPrompt,
  type WatchFeedback,
  type WatchQuestion,
} from "../../lib/watchAlong/watchAlong";
import { command, embedUrl, listen, readPlayerMessage } from "../../lib/watchAlong/player";

type Phase = "watching" | "asking" | "answering" | "checking" | "feedback" | "done";

const LABEL = "text-label font-semibold text-muted";

/** Plays a YouTube source next to its transcript and pauses every few minutes for a question about what was just said. */
export function WatchAlong({ source, text, space }: { source: Source; text: string; space: Pick<Space, "modelOverride"> | undefined }) {
  const { videoId, segments } = useMemo(() => parseTranscript(text), [text]);
  const cps = useMemo(() => checkpoints(segments), [segments]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("watching");
  const [time, setTime] = useState(0);
  const [connected, setConnected] = useState(false);
  const [question, setQuestion] = useState<WatchQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<WatchFeedback | null>(null);
  const [score, setScore] = useState({ right: 0, asked: 0 });
  const asked = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const live = useRef({ idx, phase });
  live.current = { idx, phase };

  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (i: number) => {
    const cp = cps[i];
    if (!cp) return;
    command(frame.current, "pauseVideo");
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase("asking");
    setQuestion(null);
    setAnswer("");
    setFeedback(null);
    try {
      const llm = await resolveChatModel(space);
      const reply = await generateNoThinking(llm, { prompt: questionPrompt(source.title, cp, asked.current), temperature: 0.4, abortSignal: ac.signal });
      if (ac.signal.aborted) return;
      const q = parseQuestion(reply);
      if (!q) throw new Error(s.watchAlong.unreadable);
      asked.current.push(q.question);
      setQuestion(q);
      setPhase("answering");
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase("watching");
      toastError(e instanceof NoModelError ? s.chat.noModel : s.watchAlong.questionFailed, e, () => void ask(i));
    }
  };

  useEffect(() => {
    if (!videoId) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const info = readPlayerMessage(e.origin, e.data);
      if (!info) return;
      setConnected(true);
      if (info.time != null) setTime(info.time);
      const { idx: i, phase: p } = live.current;
      if (p !== "watching" || !cps[i]) return;
      if ((info.time != null && info.time >= cps[i].at - 0.5) || info.state === 0) void ask(i);
    };
    window.addEventListener("message", onMessage);
    const poke = window.setInterval(() => listen(frame.current), 1000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poke);
    };
  }, [videoId, cps]);

  const check = async () => {
    const cp = cps[idx];
    if (!cp || !question || !answer.trim()) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase("checking");
    try {
      const llm = await resolveChatModel(space);
      const reply = await generateNoThinking(llm, { prompt: feedbackPrompt(cp, question, answer), temperature: 0.2, abortSignal: ac.signal });
      if (ac.signal.aborted) return;
      const fb = parseFeedback(reply);
      if (!fb) throw new Error(s.watchAlong.unreadable);
      setFeedback(fb);
      setScore((x) => ({ right: x.right + Number(fb.correct), asked: x.asked + 1 }));
      setPhase("feedback");
      if (!fb.correct)
        await api
          .mistakesAdd(source.spaceId, [
            { origin: s.watchAlong.origin, question: question.question, given: answer.trim(), correct: question.answer || fb.feedback, explanation: fb.feedback, topic: source.title },
          ])
          .catch((e) => toastError(s.watchAlong.mistakeFailed, e));
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase("answering");
      toastError(e instanceof NoModelError ? s.chat.noModel : s.watchAlong.checkFailed, e, () => void check());
    }
  };

  const next = () => {
    abort.current?.abort();
    const i = idx + 1;
    setIdx(i);
    setQuestion(null);
    setFeedback(null);
    setAnswer("");
    if (i >= cps.length) setPhase("done");
    else {
      setPhase("watching");
      command(frame.current, "playVideo");
    }
  };

  if (!videoId || !cps.length) return <p className="rounded-card border border-border px-3.5 py-3 text-body text-muted">{s.watchAlong.noTranscript}</p>;

  const cp = cps[idx];
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(cp?.from ?? 0)}s`;

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border p-3" aria-label={s.watchAlong.title} data-testid="watch-along">
      <div className="relative aspect-video w-full overflow-hidden rounded-card bg-fill">
        <iframe
          ref={frame}
          src={embedUrl(videoId)}
          title={source.title}
          className="absolute inset-0 size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => listen(frame.current)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-body">
        <p className="flex-1 text-muted" data-testid="watch-status">
          {phase === "done"
            ? s.watchAlong.finished(score.right, score.asked)
            : connected
              ? s.watchAlong.nextPause(clock(time), clock(cp.at), idx + 1, cps.length)
              : s.watchAlong.manual(clock(cp.at), idx + 1, cps.length)}
        </p>
        {phase === "watching" && (
          <Button size="sm" onClick={() => void ask(idx)} data-testid="watch-ask-now">
            {connected ? s.watchAlong.askNow : s.watchAlong.reached(clock(cp.at))}
          </Button>
        )}
        {!connected && (
          <a href={watchUrl} target="_blank" rel="noreferrer" className="flex h-7.5 items-center gap-1.5 rounded-btn px-[9px] font-medium hover:bg-fill">
            <ExternalLink size={14} /> {s.watchAlong.openOnYouTube}
          </a>
        )}
      </div>
      {phase === "asking" && <GeneratingStatus label={s.watchAlong.thinking} className="text-muted" />}
      {question && phase !== "asking" && phase !== "done" && (
        <div className="flex flex-col gap-2.5" data-testid="watch-question">
          <p className={LABEL}>{s.watchAlong.questionAt(clock(cp.at))}</p>
          <p className="text-body font-semibold">{question.question}</p>
          {phase === "feedback" && feedback ? (
            <>
              <p className="text-body" data-testid="watch-feedback" data-correct={feedback.correct}>
                {feedback.correct ? <Check size={14} className="mr-1 inline text-success-text" /> : <X size={14} className="mr-1 inline text-danger-text" />}
                {feedback.feedback}
              </p>
              {!feedback.correct && question.answer && <p className="text-body text-fg-secondary">{s.watchAlong.modelAnswer(question.answer)}</p>}
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={next}>
                  {idx + 1 < cps.length ? s.watchAlong.keepWatching : s.watchAlong.finish}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Textarea
                autoFocus
                rows={3}
                value={answer}
                aria-label={s.watchAlong.answer}
                placeholder={s.watchAlong.answerPlaceholder}
                disabled={phase === "checking"}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void check();
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2">
                {phase === "checking" && <GeneratingStatus label={s.watchAlong.checking} className="mr-auto text-muted" />}
                <Button variant="ghost" size="sm" onClick={next} disabled={phase === "checking"}>
                  {s.watchAlong.skip}
                </Button>
                <Button variant="primary" size="sm" onClick={() => void check()} disabled={phase === "checking" || !answer.trim()}>
                  {s.watchAlong.check}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
