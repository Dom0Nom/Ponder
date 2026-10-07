export type MarkShaderState = "idle" | "generating";

export const MARK_PRESETS = {
  idle: { speed: 0.2, repetition: 1.5, distortion: 0.03, contour: 0.2, softness: 0.35, shiftRed: 0, shiftBlue: 0, opacity: 0.22, angle: 70 },
  generating: { speed: 0.7, repetition: 2, distortion: 0.05, contour: 0.3, softness: 0.25, shiftRed: 0.05, shiftBlue: 0.05, opacity: 0.6, angle: 70 },
} as const;

export const MARK_FADE_MS = 600;
