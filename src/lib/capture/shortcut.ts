/** Global shortcut accelerators in the Tauri format, e.g. `Alt+CommandOrControl+N`. */

export const DEFAULT_SHORTCUT = "Alt+CommandOrControl+N";

type Mod = "Control" | "Alt" | "Shift" | "Command";

const MOD_ALIASES: Record<string, Mod> = {
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  command: "Command",
  cmd: "Command",
  super: "Command",
  commandorcontrol: "Command",
  commandorctrl: "Command",
  cmdorctrl: "Command",
  cmdorcontrol: "Command",
};

const MOD_ORDER: Mod[] = ["Control", "Alt", "Shift", "Command"];
const MOD_SYMBOL: Record<Mod, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" };
const MOD_ACCEL: Record<Mod, string> = { Control: "Control", Alt: "Alt", Shift: "Shift", Command: "CommandOrControl" };

const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Enter|Tab|Backspace|Delete|Arrow(Up|Down|Left|Right)|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote|Minus|Equal|Home|End|PageUp|PageDown)$/;

const KEY_SYMBOL: Record<string, string> = {
  Space: "Space",
  Enter: "↩",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  PageUp: "Page Up",
  PageDown: "Page Down",
};

export interface ParsedShortcut {
  mods: Mod[];
  /** KeyboardEvent.code style, e.g. KeyN, Digit1, Space */
  key: string;
}

function normalizeKey(token: string): string | null {
  if (/^[a-z]$/i.test(token)) return `Key${token.toUpperCase()}`;
  if (/^[0-9]$/.test(token)) return `Digit${token}`;
  const match = [...Object.keys(KEY_SYMBOL), "Home", "End"].find((k) => k.toLowerCase() === token.toLowerCase());
  if (match) return match;
  if (/^key[a-z]$/i.test(token)) return `Key${token.slice(3).toUpperCase()}`;
  if (/^digit[0-9]$/i.test(token)) return `Digit${token.slice(5)}`;
  if (/^f([1-9]|1[0-2])$/i.test(token)) return token.toUpperCase();
  return null;
}

/** Parses an accelerator string; null if it isn't one we can register. */
export function parseShortcut(accel: string): ParsedShortcut | null {
  const tokens = accel.split("+").map((t) => t.trim());
  if (tokens.length < 2 || tokens.some((t) => !t)) return null;
  const mods = new Set<Mod>();
  for (const t of tokens.slice(0, -1)) {
    const m = MOD_ALIASES[t.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const key = normalizeKey(tokens[tokens.length - 1]);
  if (!key) return null;
  return { mods: MOD_ORDER.filter((m) => mods.has(m)), key };
}

/** Error message, or null when the shortcut is usable as a global hotkey. */
export function validateShortcut(accel: string): string | null {
  const p = parseShortcut(accel);
  if (!p) return "That isn't a shortcut the app can use.";
  if (!p.mods.some((m) => m !== "Shift")) return "Add ⌘, ⌥ or ⌃ so the shortcut doesn't get in the way of typing.";
  return null;
}

export function toAccelerator(p: ParsedShortcut): string {
  const key = p.key.startsWith("Key") ? p.key.slice(3) : p.key.startsWith("Digit") ? p.key.slice(5) : p.key;
  return [...MOD_ORDER.filter((m) => p.mods.includes(m)).map((m) => MOD_ACCEL[m]), key].join("+");
}

/** macOS-style label, e.g. ⌥⌘N. */
export function formatShortcut(accel: string): string {
  const p = parseShortcut(accel);
  if (!p) return accel;
  const key = p.key.startsWith("Key")
    ? p.key.slice(3)
    : p.key.startsWith("Digit")
      ? p.key.slice(5)
      : (KEY_SYMBOL[p.key] ?? p.key);
  return p.mods.map((m) => MOD_SYMBOL[m]).join("") + key;
}

export interface KeyLike {
  code: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Accelerator for a key press while recording, or null for modifier-only / unsupported keys. */
export function shortcutFromEvent(e: KeyLike): string | null {
  if (!KEY_CODE.test(e.code)) return null;
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Command");
  if (!mods.length) return null;
  return toAccelerator({ mods, key: e.code });
}

/** Title for a quick note: its first line if it's short enough to be a title, else "Quick note · <date>". */
export function captureTitle(text: string, now = new Date()): string {
  const first = text
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
  if (first && first.length <= 80) return first;
  return `Quick note · ${now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
