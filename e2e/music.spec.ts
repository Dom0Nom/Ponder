import { test, expect } from "./fixtures";

type MockWindow = Window & { __mock: { db: () => { musicCalls: string[]; settings: Record<string, unknown> } } };

test("settings: enable focus music, validate the playlist link and test it", async ({ app }) => {
  await app.getByRole("button", { name: "Settings" }).click();
  const section = app.getByTestId("music-settings");
  await expect(section).toBeVisible();
  await expect(section.getByLabel("Playlist link")).toHaveCount(0);

  await section.getByRole("switch", { name: "Play music while I focus" }).click();
  const field = section.getByLabel("Playlist link");
  await expect(field).toBeVisible();
  await expect(section.getByText(/asks once for permission/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Test" })).toBeDisabled();

  await field.fill("https://example.com/nope");
  await expect(section.getByRole("alert")).toHaveText("That isn't a Spotify link.");
  await expect(section.getByRole("button", { name: "Test" })).toBeDisabled();

  await field.fill("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc");
  await expect(section.getByRole("alert")).toHaveCount(0);
  await field.blur();
  await section.getByRole("button", { name: "Test" }).click();
  await expect(app.getByText("Playing the playlist in Spotify")).toBeVisible();

  const { calls, music } = await app.evaluate(() => {
    const db = (window as unknown as MockWindow).__mock.db();
    return { calls: db.musicCalls, music: db.settings["focus.music"] };
  });
  expect(calls).toEqual(["play spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"]);
  expect(music).toEqual({
    enabled: true,
    playlist: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc",
  });
});
