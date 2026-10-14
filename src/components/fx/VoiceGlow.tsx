import { useRef, type ReactNode } from "react";
import { VoiceBeam } from "voice-glow";
import { useIsDark } from "../../app/useTheme";
import { useVoice } from "../../stores/voice";
import { useFxActive } from "./useFxActive";

/** Voice tutor strip: the app's own mic level drives it while listening; speaking uses a fixed level; quiet otherwise. */
export default function VoiceGlow({ children }: { children: ReactNode }) {
  const dark = useIsDark();
  const ref = useRef<HTMLDivElement>(null);
  const phase = useVoice((st) => st.phase);
  const live = useFxActive(ref) && (phase === "listening" || phase === "speaking");
  return (
    <VoiceBeam
      ref={ref}
      type="default"
      colorVariant="mono"
      theme={dark ? "dark" : "light"}
      distortion={0}
      borderRadius={8}
      active={live}
      level={() => (phase === "speaking" ? 0.4 : useVoice.getState().level)}
    >
      {children}
    </VoiceBeam>
  );
}
