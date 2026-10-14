import { generateText } from "ai";
import { ChevronLeft, ChevronRight, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PonderMark } from "../../components/brand/PonderMark";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { resolveChatModel } from "../../lib/chat/llm";
import { s } from "../../lib/strings";
import { gatherMaterial } from "../../lib/studio/generate";
import { parseAudioAnswer, type AudioData, type AudioLine } from "../../lib/studio/kinds";
import { audioAnswerPrompt } from "../../lib/studio/prompts";
import { pauseSpeaking, resumeSpeaking, speakSegments, stopSpeaking, usePlayer } from "../../lib/tts/player";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useSpeechConfig } from "../speech/useSpeech";

interface Aside {
  /** Index of the line the question interrupted. */
  at: number;
  question: string;
  lines: AudioLine[];
}

const segs = (lines: AudioLine[]) => lines.map((l) => ({ text: l.text, voice: l.host }));

export function AudioView({ id, title, data, space }: { id: string; title: string; data: AudioData; space: Space | undefined }) {
  const { ready } = useSpeechConfig();
  const navigate = useUi((st) => st.navigate);
  const key = `audio-${id}`;
  const askKey = `${key}-answer`;
  const player = usePlayer();
  const mine = player.key === key;
  const answering = player.key === askKey;
  const status = mine ? player.status : "idle";
  const line = mine ? player.segment : -1;
  const [cursor, setCursor] = useState(0);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [asides, setAsides] = useState<Aside[]>([]);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const asking = useRef<AbortController | null>(null);

  useEffect(() => {
    if (mine) setCursor(player.segment);
  }, [mine, player.segment]);
  useEffect(
    () => () => {
      asking.current?.abort();
      stopSpeaking();
    },
    [],
  );
  useEffect(() => {
    if (line >= 0) lineRefs.current[line]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [line]);

  const playFrom = (i: number) => {
    setCursor(i);
    speakSegments(key, segs(data.lines), i).catch((e) => toastError(s.outputs.audio.playFailed, e, () => playFrom(i)));
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || !space) return;
    const at = cursor;
    stopSpeaking();
    asking.current?.abort();
    const ac = new AbortController();
    asking.current = ac;
    setThinking(true);
    try {
      const llm = await resolveChatModel(space);
      const material = await gatherMaterial(space.id, q, llm);
      const prompt = audioAnswerPrompt(material, title, data.lines.slice(Math.max(0, at - 3), at + 1), q, space.language);
      const r = await generateText({ model: llm.model, prompt, abortSignal: ac.signal, ...llm.options({ thinking: false }) });
      if (ac.signal.aborted) return;
      const lines = parseAudioAnswer(r.text);
      if (!lines) throw new Error(s.outputs.unreadable);
      setAsides((a) => [...a, { at, question: q, lines }]);
      setQuestion("");
      setThinking(false);
      if (ready) {
        const finished = await speakSegments(askKey, segs(lines));
        if (finished && !ac.signal.aborted) playFrom(at);
      }
    } catch (e) {
      if (!ac.signal.aborted) toastError(s.outputs.audio.askFailed, e);
    } finally {
      if (!ac.signal.aborted) setThinking(false);
    }
  };

  const total = data.lines.length;
  return (
    <div className="flex flex-col gap-4" data-testid="audio-overview">
      {ready ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-border px-3 py-2.5 print:hidden" data-testid="audio-controls">
          <Button variant="ghost-muted" size="icon-sm" aria-label={s.outputs.audio.previous} disabled={cursor === 0} onClick={() => playFrom(Math.max(0, cursor - 1))}>
            <ChevronLeft size={15} />
          </Button>
          {status === "idle" ? (
            <Button size="sm" onClick={() => playFrom(cursor)} disabled={answering || thinking} data-testid="audio-play">
              <Play size={13} />
              {s.outputs.audio.play}
            </Button>
          ) : status === "loading" ? (
            <Button size="sm" variant="secondary" onClick={stopSpeaking} data-testid="audio-play">
              <PonderMark size={18} state="generating" />
              {s.outputs.audio.preparing}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={status === "playing" ? pauseSpeaking : resumeSpeaking} data-testid="audio-play">
              {status === "playing" ? <Pause size={13} /> : <Play size={13} />}
              {status === "playing" ? s.outputs.audio.pause : s.outputs.audio.resume}
            </Button>
          )}
          <Button variant="ghost-muted" size="icon-sm" aria-label={s.outputs.audio.next} disabled={cursor >= total - 1} onClick={() => playFrom(Math.min(total - 1, cursor + 1))}>
            <ChevronRight size={15} />
          </Button>
          {(status !== "idle" || answering) && (
            <Button variant="ghost-muted" size="icon-sm" aria-label={s.outputs.audio.stop} onClick={stopSpeaking}>
              <Square size={12} />
            </Button>
          )}
          <span className="ms-auto text-label tabular-nums text-muted" data-testid="audio-position">
            {s.outputs.audio.lineOf(cursor + 1, total)}
          </span>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-body text-fg-secondary print:hidden">
          {s.outputs.audio.needVoice}
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: "settings", section: "voice" })}>
            {s.outputs.audio.openVoice}
          </Button>
        </p>
      )}
      <form
        className="flex items-center gap-2 print:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <Input aria-label={s.outputs.audio.ask} placeholder={s.outputs.audio.askPlaceholder} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={thinking || !space} />
        <Button type="submit" size="sm" variant="secondary" disabled={!question.trim() || thinking || !space}>
          {thinking ? <PonderMark size={18} state="generating" /> : null}
          {s.outputs.audio.askSend}
        </Button>
      </form>
      {thinking && <p className="text-body text-muted" aria-live="polite">{s.outputs.audio.answering}</p>}
      <ol className="flex flex-col gap-1" data-testid="audio-transcript">
        {data.lines.map((l, i) => (
          <li key={i} ref={(el) => void (lineRefs.current[i] = el)} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => (ready ? playFrom(i) : setCursor(i))}
              aria-current={line === i ? "true" : undefined}
              className={cn(
                "flex gap-3 rounded-item px-2 py-1.5 text-start text-body leading-[1.55] hover:bg-fill-subtle",
                line === i && "bg-fill",
              )}
            >
              <span className={cn("w-14 shrink-0 text-label font-semibold", l.host === 0 ? "text-fg" : "text-fg-secondary")}>{s.outputs.audio.hosts[l.host]}</span>
              <span className="min-w-0 flex-1">{l.text}</span>
            </button>
            {asides
              .filter((a) => a.at === i)
              .map((a, j) => (
                <div key={j} className="ms-[68px] flex flex-col gap-1 rounded-card border border-border px-3 py-2 text-body" data-testid="audio-aside">
                  <span>
                    <span className="me-2 text-label font-semibold text-muted">{s.outputs.audio.you}</span>
                    {a.question}
                  </span>
                  {a.lines.map((al, k) => (
                    <span key={k}>
                      <span className="me-2 text-label font-semibold text-muted">{s.outputs.audio.hosts[al.host]}</span>
                      {al.text}
                    </span>
                  ))}
                </div>
              ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
