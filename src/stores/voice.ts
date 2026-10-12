import { create } from "zustand";

export type VoicePhase = "off" | "listening" | "transcribing" | "thinking" | "speaking" | "paused";

interface VoiceState {
  phase: VoicePhase;
  spaceId: string | null;
  /** what the learner said in the last turn */
  heard: string;
  /** microphone level, 0..1 */
  level: number;
}

export const useVoice = create<VoiceState>(() => ({ phase: "off", spaceId: null, heard: "", level: 0 }));
