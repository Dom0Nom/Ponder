import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  goalGet: vi.fn(),
  goalSave: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ api }));

import { migrateOnboardingGoals, saveSkillGoal } from "./goalMigration";

beforeEach(() => {
  vi.resetAllMocks();
  api.goalGet.mockResolvedValue(null);
});

describe("onboarding goal migration", () => {
  it("saves a skill goal with an empty graph", async () => {
    await saveSkillGoal("s1", "  Learn piano ");
    expect(api.goalSave).toHaveBeenCalledWith("s1", "skill", "Learn piano", { nodes: [] });
  });

  it("converts a stored skill goal and deletes the setting", async () => {
    api.getSettings.mockResolvedValue({ "onboardingGoal.s1": { kind: "skill", goal: "Learn piano", date: "" }, other: 1 });
    await migrateOnboardingGoals();
    expect(api.goalSave).toHaveBeenCalledWith("s1", "skill", "Learn piano", { nodes: [] });
    expect(api.setSetting).toHaveBeenCalledWith("onboardingGoal.s1", null);
    expect(api.setSetting).toHaveBeenCalledTimes(1);
  });

  it("drops exam and empty entries without saving a goal", async () => {
    api.getSettings.mockResolvedValue({
      "onboardingGoal.a": { kind: "exam", goal: "GED", date: "2027-01-01" },
      "onboardingGoal.b": { kind: "skill", goal: " ", date: "" },
    });
    await migrateOnboardingGoals();
    expect(api.goalSave).not.toHaveBeenCalled();
    expect(api.setSetting).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite an existing goal", async () => {
    api.getSettings.mockResolvedValue({ "onboardingGoal.s1": { kind: "skill", goal: "x" } });
    api.goalGet.mockResolvedValue({ title: "Existing" });
    await migrateOnboardingGoals();
    expect(api.goalSave).not.toHaveBeenCalled();
    expect(api.setSetting).toHaveBeenCalledWith("onboardingGoal.s1", null);
  });

  it("keeps the setting when saving fails", async () => {
    api.getSettings.mockResolvedValue({ "onboardingGoal.s1": { kind: "skill", goal: "x" } });
    api.goalSave.mockRejectedValue(new Error("boom"));
    await migrateOnboardingGoals();
    expect(api.setSetting).not.toHaveBeenCalled();
  });
});
