import { BreakMenuSettings } from "./focus/BreakMenuSettings";
import { HyperfocusSettings } from "./focus/HyperfocusSettings";
import { MusicSettings } from "./focus/MusicSettings";
import { ReadingSettings } from "./focus/ReadingSettings";

export function FocusPackSection() {
  return (
    <div className="space-y-6">
      <HyperfocusSettings />
      <BreakMenuSettings />
      <ReadingSettings />
      <MusicSettings />
    </div>
  );
}
