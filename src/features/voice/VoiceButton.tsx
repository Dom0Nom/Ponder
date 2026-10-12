import { AudioLines } from "lucide-react";
import { Tooltip } from "../../components/ui/misc";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import { useSpeechConfig } from "../speech/useSpeech";
import { startVoice, type VoiceDeps } from "./tutor";

/** Starts a spoken conversation. Needs a speech service for the answers and an OpenRouter provider for transcription. */
export function VoiceButton({ deps, disabled, className }: { deps: VoiceDeps; disabled?: boolean; className?: string }) {
  const { data: providers } = useProviders();
  const { ready } = useSpeechConfig();
  if (!ready || !providers?.some((p) => p.type === "openrouter") || typeof MediaRecorder === "undefined") return null;
  return (
    <Tooltip content={s.voice.start} side="top">
      <button aria-label={s.voice.start} data-testid="voice-start" disabled={disabled} onClick={() => startVoice(deps)} className={className}>
        <AudioLines size={15} />
      </button>
    </Tooltip>
  );
}
