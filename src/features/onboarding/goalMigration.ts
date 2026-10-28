import { api } from "../../lib/ipc";

const PREFIX = "onboardingGoal.";

export interface StoredGoal {
  kind?: "exam" | "skill";
  goal?: string;
  date?: string;
}

export async function saveSkillGoal(spaceId: string, title: string) {
  const t = title.trim();
  if (t) await api.goalSave(spaceId, "skill", t, { nodes: [] });
}

/** Turns the old per-space onboarding goal settings into goals, then deletes them. */
export async function migrateOnboardingGoals() {
  const settings = await api.getSettings();
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(PREFIX)) continue;
    const spaceId = key.slice(PREFIX.length);
    const g = (value ?? {}) as StoredGoal;
    try {
      if (g.kind === "skill" && g.goal?.trim()) {
        const existing = await api.goalGet(spaceId);
        if (!existing) await saveSkillGoal(spaceId, g.goal);
      }
      await api.setSetting(key, null);
    } catch {
      // keep the setting so the next launch retries
    }
  }
}
