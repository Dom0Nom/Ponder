import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUT,
  captureTitle,
  formatShortcut,
  parseShortcut,
  shortcutFromEvent,
  validateShortcut,
} from "./shortcut";

const key = (code: string, mods: Partial<{ meta: boolean; alt: boolean; ctrl: boolean; shift: boolean }> = {}) => ({
  code,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
});

describe("shortcuts", () => {
  it("formats accelerators the macOS way", () => {
    expect(formatShortcut(DEFAULT_SHORTCUT)).toBe("⌥⌘N");
    expect(formatShortcut("Shift+Control+Space")).toBe("⌃⇧Space");
    expect(formatShortcut("Super+Alt+Digit1")).toBe("⌥⌘1");
    expect(formatShortcut("CmdOrCtrl+Shift+ArrowUp")).toBe("⇧⌘↑");
    expect(formatShortcut("garbage")).toBe("garbage");
  });

  it("parses aliases and rejects malformed strings", () => {
    expect(parseShortcut("option+cmd+n")).toEqual({ mods: ["Alt", "Command"], key: "KeyN" });
    expect(parseShortcut("Control+F5")).toEqual({ mods: ["Control"], key: "F5" });
    for (const bad of ["", "N", "Alt+", "+N", "Alt+Bogus", "Hyper+N", "Alt+N+M"]) {
      expect(parseShortcut(bad), bad).toBeNull();
    }
  });

  it("requires a real modifier", () => {
    expect(validateShortcut(DEFAULT_SHORTCUT)).toBeNull();
    expect(validateShortcut("Control+Shift+K")).toBeNull();
    expect(validateShortcut("Shift+K")).toMatch(/⌘, ⌥ or ⌃/);
    expect(validateShortcut("nonsense")).toMatch(/isn't a shortcut/);
  });

  it("records key presses", () => {
    expect(shortcutFromEvent(key("KeyN", { meta: true, alt: true }))).toBe("Alt+CommandOrControl+N");
    expect(shortcutFromEvent(key("Space", { ctrl: true, shift: true }))).toBe("Control+Shift+Space");
    expect(shortcutFromEvent(key("Digit2", { meta: true }))).toBe("CommandOrControl+2");
    // modifier-only presses keep recording
    expect(shortcutFromEvent(key("MetaLeft", { meta: true }))).toBeNull();
    expect(shortcutFromEvent(key("KeyN"))).toBeNull();
    // round trip
    const rec = shortcutFromEvent(key("Comma", { alt: true, shift: true }))!;
    expect(formatShortcut(rec)).toBe("⌥⇧,");
    expect(validateShortcut(rec)).toBeNull();
  });
});

describe("captureTitle", () => {
  const day = new Date(2026, 9, 6);
  it("uses the first non-empty line", () => {
    expect(captureTitle("\n\n# Krebs cycle\nmore", day)).toBe("Krebs cycle");
    expect(captureTitle("  Idea: spaced repetition  ", day)).toBe("Idea: spaced repetition");
  });
  it("falls back to a dated title for long first lines", () => {
    expect(captureTitle("x".repeat(200), day)).toMatch(/^Quick note · .*2026/);
  });
});
