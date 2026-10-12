import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PonderMark } from "../../components/brand/PonderMark";
import { Tooltip } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useProviders, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import { AUDIO_FORMATS, speechSettings, transcribe } from "../../lib/tts/speech";
import { cn } from "../../lib/utils";

type Format = (typeof AUDIO_FORMATS)[number];

const formatOf = (mime: string): Format => (mime.includes("mp4") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

/** Records from the microphone and hands the transcript to `onText`. Shown only with an OpenRouter provider. */
export function DictateButton({ onText, className }: { onText: (text: string) => void; className?: string }) {
  const { data: providers } = useProviders();
  const { data: settings } = useSettings();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const rec = useRef<MediaRecorder | null>(null);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);
  if (!providers?.some((p) => p.type === "openrouter") || typeof MediaRecorder === "undefined") return null;

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toastError(s.speech.dictate.noMic, e);
      return;
    }
    const r = new MediaRecorder(stream);
    const parts: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && parts.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      const blob = new Blob(parts, { type: r.mimeType });
      if (!blob.size) return setState("idle");
      setState("transcribing");
      try {
        const text = await transcribe(speechSettings(settings), new Uint8Array(await blob.arrayBuffer()), formatOf(r.mimeType), undefined, providers);
        if (text) onText(text);
      } catch (e) {
        toastError(s.speech.dictate.failed, e);
      } finally {
        setState("idle");
      }
    };
    rec.current = r;
    r.start();
    setState("recording");
  };

  const label = state === "recording" ? s.speech.dictate.stop : state === "transcribing" ? s.speech.dictate.transcribing : s.speech.dictate.start;
  return (
    <Tooltip content={label} side="top">
      <button
        aria-label={label}
        data-testid="dictate"
        data-state={state}
        disabled={state === "transcribing"}
        onClick={() => (state === "recording" ? rec.current?.stop() : void start())}
        className={cn(className, state === "recording" && "bg-danger-soft text-danger hover:bg-danger-soft-hover")}
      >
        {state === "transcribing" ? <PonderMark size={18} state="generating" /> : state === "recording" ? <Square size={12} fill="currentColor" /> : <Mic size={15} />}
      </button>
    </Tooltip>
  );
}
