import { Pause, Play, Square, Volume2 } from "lucide-react";
import { PonderMark } from "../../components/brand/PonderMark";
import { toastError } from "../../components/ui/toast";
import { pauseSpeaking, resumeSpeaking, speak, stopSpeaking, usePlayer } from "../../lib/tts/player";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { useSpeechConfig } from "./useSpeech";

/** Reads `text` aloud. Renders nothing until a speech service is set up. */
export function ListenButton({ id, text, className, withLabel }: { id: string; text: string | (() => string); className: string; withLabel?: boolean }) {
  const { ready } = useSpeechConfig();
  const active = usePlayer((st) => (st.key === id ? st.status : "idle"));
  if (!ready) return null;
  const start = () =>
    speak(id, typeof text === "function" ? text() : text).catch((e) => toastError(s.speech.failed, e, start));
  const label = active === "idle" ? s.speech.listen : active === "loading" ? s.speech.preparing : s.speech.stop;
  return (
    <span className="inline-flex items-center">
      <button
        aria-label={label}
        data-tip-name={label}
        data-tip-desc={active === "idle" ? s.speech.listenDesc : undefined}
        data-testid="listen"
        data-state={active}
        className={className}
        onClick={() => (active === "idle" ? void start() : stopSpeaking())}
      >
        {active === "loading" ? <PonderMark size={20} state="generating" /> : active === "idle" ? <Volume2 size={14} /> : <Square size={12} />}
        {withLabel && <span>{active === "idle" ? s.speech.listen : s.speech.stop}</span>}
      </button>
      {(active === "playing" || active === "paused") && (
        <button
          aria-label={active === "playing" ? s.speech.pause : s.speech.resume}
          data-tip-name={active === "playing" ? s.speech.pause : s.speech.resume}
          className={cn(className, withLabel && "px-0 size-7 justify-center")}
          onClick={() => (active === "playing" ? pauseSpeaking() : resumeSpeaking())}
        >
          {active === "playing" ? <Pause size={14} /> : <Play size={14} />}
        </button>
      )}
    </span>
  );
}
