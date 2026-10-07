import { BreakMenuSettings } from "./focus/BreakMenuSettings";
import { CheckInSettings } from "./focus/CheckInSettings";
import { HyperfocusSettings } from "./focus/HyperfocusSettings";
import { MusicSettings } from "./focus/MusicSettings";
import { ReadingSettings } from "./focus/ReadingSettings";
import { SettingsGroup } from "./layout";

export function FocusPackSection() {
  return (
    <SettingsGroup>
      <HyperfocusSettings />
      <BreakMenuSettings />
      <ReadingSettings />
      <MusicSettings />
      <HyperfocusSettings part="minutes" />
      <CheckInSettings />
    </SettingsGroup>
  );
}
