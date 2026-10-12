import { useEffect } from "react";
import { Mic, Pause, Square, Volume2, X } from "lucide-react";
import { PonderMark } from "../../components/brand/PonderMark";
import { Tooltip } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import { useVoice, type VoicePhase } from "../../stores/voice";
import { cn } from "../../lib/utils";
import { micPress, stopVoice } from "./tutor";

const BARS = [0.55, 1, 0.75, 0.9, 0.6];

function Indicator({ phase, level }: { phase: VoicePhase; level: number }) {
  if (phase === "transcribing" || phase === "thinking") return <PonderMark size={26} state="generating" />;
  if (phase === "speaking") return <Volume2 size={20} />;
  if (phase === "paused") return <Pause size={20} />;
  const grow = Math.min(1, level * 12);
  return (
    <span aria-hidden className="flex h-6 w-6 items-center justify-center gap-[2px]">
      {BARS.map((b, i) => (
        <span key={i} className="w-[3px] rounded-full bg-fg" style={{ height: `${Math.round(4 + 20 * b * grow)}px` }} />
      ))}
    </span>
  );
}

/** Replaces the composer while a voice conversation runs. Esc ends it. */
export function VoiceBar() {
  const phase = useVoice((st) => st.phase);
  const heard = useVoice((st) => st.heard);
  const level = useVoice((st) => st.level);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      stopVoice();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (phase === "off") return null;

  const status = { listening: s.voice.listening, transcribing: s.voice.transcribing, thinking: s.voice.thinking, speaking: s.voice.speaking, paused: s.voice.paused }[phase];
  const hint = { listening: s.voice.hintListening, speaking: s.voice.hintSpeaking, paused: s.voice.hintPaused, transcribing: "", thinking: "" }[phase];
  const line = (phase === "thinking" || phase === "speaking" || phase === "paused") && heard ? s.voice.youSaid(heard) : hint;
  const mic = { listening: s.voice.micDone, speaking: s.voice.micInterrupt, paused: s.voice.micResume, transcribing: s.voice.micBusy, thinking: s.voice.micBusy }[phase];
  const busy = phase === "transcribing" || phase === "thinking";

  return (
    <div className="flex items-center gap-3 px-3.5 py-3" data-testid="voice-bar" data-phase={phase}>
      <span className="flex size-8 shrink-0 items-center justify-center text-fg">
        <Indicator phase={phase} level={level} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold" role="status" aria-live="polite" data-testid="voice-status">
          {status}
        </p>
        <p className="truncate text-label text-muted" data-testid="voice-line">
          {line}
        </p>
      </div>
      <Tooltip content={mic} side="top">
        <button
          aria-label={mic}
          data-testid="voice-mic"
          disabled={busy}
          onClick={micPress}
          className={cn(
            "flex size-[30px] shrink-0 items-center justify-center rounded-btn disabled:opacity-50",
            phase === "listening" ? "bg-danger-soft text-danger hover:bg-danger-soft-hover" : "bg-primary text-on-primary hover:bg-primary-hover",
          )}
        >
          {phase === "listening" ? <Square size={12} fill="currentColor" /> : <Mic size={15} />}
        </button>
      </Tooltip>
      <Tooltip content={s.voice.end} side="top">
        <button aria-label={s.voice.end} data-testid="voice-stop" onClick={stopVoice} className="flex size-[30px] shrink-0 items-center justify-center rounded-btn text-fg hover:bg-fill">
          <X size={16} />
        </button>
      </Tooltip>
    </div>
  );
}
