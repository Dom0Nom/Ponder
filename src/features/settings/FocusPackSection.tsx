import { AmbientSettings } from "./focus/AmbientSettings";
import { BreakMenuSettings } from "./focus/BreakMenuSettings";
import { DistractionSettings } from "./focus/DistractionSettings";
import { CheckInSettings } from "./focus/CheckInSettings";
import { HyperfocusSettings } from "./focus/HyperfocusSettings";
import { ForcedBreaksSettings } from "./focus/ForcedBreaksSettings";
import { MusicSettings } from "./focus/MusicSettings";
import { ReadingSettings } from "./focus/ReadingSettings";
import { SettingsGroup } from "./layout";

export function FocusPackSection() {
  return (
    <SettingsGroup>
      <HyperfocusSettings />
      <ForcedBreaksSettings />
      <BreakMenuSettings />
      <ReadingSettings />
      <MusicSettings />
      <HyperfocusSettings part="minutes" />
      <CheckInSettings />
      <DistractionSettings />
      <AmbientSettings />
    </SettingsGroup>
  );
}
