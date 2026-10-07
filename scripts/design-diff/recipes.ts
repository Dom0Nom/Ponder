/**
 * One recipe per artboard id (1a/1b … 38a/38b). `a` is light, `b` is dark; both share a screen entry
 * unless `overrides` says otherwise. When you restyle a screen, update its entry here, drop
 * `pending`, and add `masks` only for a documented decision.
 *
 * `query` is appended to `?fixture=design` (see src/test/designFixture.ts for the options).
 * `setup` runs on a freshly loaded page (frozen clock, seeded mock data, theme pref "system",
 * `prefers-color-scheme` set from the id's light/dark suffix).
 */
import type { Page } from "@playwright/test";

export interface Mask {
  /** CSS px in the 1280x800 frame */
  x: number;
  y: number;
  w: number;
  h: number;
  /** names the decision that allows this mask (DECISIONS #8, #13, 05-brand.md, 06-calculator.md, removed placeholder data) */
  reason: string;
}

export interface Recipe {
  id: string;
  n: number;
  title: string;
  query: string;
  /** artboard file: App Screens, or Space Screen v2 for screen 2 */
  source: "app-screens" | "space-v2";
  /** UI for this state doesn't exist yet or the recipe can't reach it; failure doesn't fail the run */
  pending?: string;
  masks: Mask[];
  /** screens that `--native` can compare against the real window */
  native: boolean;
  setup: (p: Page) => Promise<void>;
}

type Win = Window & {
  __ui: { getState: () => Record<string, unknown> & { navigate: (r: unknown) => void }; setState: (s: Record<string, unknown>) => void };
  __mock: { db: () => { settings: Record<string, unknown> } };
};

export const SPACE = "sp-ged";
export const THREAD = "th-systems";

const settle = (p: Page, ms = 250) => p.waitForTimeout(ms);

export const setUi = (p: Page, patch: Record<string, unknown>) => p.evaluate((x) => (window as unknown as Win).__ui.setState(x), patch);
export const nav = (p: Page, route: Record<string, unknown>) => p.evaluate((r) => (window as unknown as Win).__ui.getState().navigate(r), route);
const hasUiKey = (p: Page, k: string) => p.evaluate((key) => key in (window as unknown as Win).__ui.getState(), k);

/** Go to the GED Math space with the Systems of equations thread open. */
export async function space(p: Page, panes = { sources: false, studio: true }) {
  await setUi(p, {
    activeThread: { [SPACE]: THREAD },
    studioOpen: panes.studio,
    sourcesOpen: { [SPACE]: panes.sources },
    modelControls: { "prov-anthropic:Sonnet 5.5": { reasoning: "high" } },
  });
  await nav(p, { name: "space", spaceId: SPACE });
  await p.getByText("How do I know when to use substitution").first().waitFor({ timeout: 8000 }).catch(() => undefined);
  await settle(p);
}

/**
 * Open a Studio sub-view. Uses `studioView` in the UI store when the app has it, otherwise clicks `fallbackText`
 * in the current Studio pane.
 */
export async function studio(p: Page, view: string | null, fallbackText?: string) {
  if (await hasUiKey(p, "studioView")) await setUi(p, { studioView: view });
  else if (fallbackText) await p.getByText(fallbackText, { exact: false }).first().click().catch(() => undefined);
  await settle(p, 400);
}

export const click = async (p: Page, text: string | RegExp, role: "button" | "tab" | "link" | "menuitem" | null = "button") => {
  const loc = role ? p.getByRole(role, { name: text }) : p.getByText(text);
  await loc.first().click();
  await settle(p, 300);
};

interface Screen {
  title: string;
  query?: string;
  source?: Recipe["source"];
  pending?: string;
  masks?: Mask[];
  native?: boolean;
  setup: (p: Page) => Promise<void>;
  /** per-theme replacement for fields above */
  overrides?: { a?: Partial<Screen>; b?: Partial<Screen> };
}

const home = (p: Page) => nav(p, { name: "home" });

/** Masks covering everything in the 1280x800 frame except `box`. */
const outside = (box: { x: number; y: number; w: number; h: number }, reason: string): Mask[] => [
  { x: 0, y: 0, w: 1280, h: box.y, reason },
  { x: 0, y: box.y, w: box.x, h: 800 - box.y, reason },
  { x: box.x + box.w, y: box.y, w: 1280 - box.x - box.w, h: 800 - box.y, reason },
  { x: box.x, y: box.y + box.h, w: box.w, h: 800 - box.y - box.h, reason },
];
const BACKDROP = "the design draws 9a/10a over a static copy of Home (shifted, no New space button), not the real screen 1";

export const SCREENS: Record<number, Screen> = {
  1: { title: "Home", native: true, query: "cards=review", setup: home },
  2: {
    title: "Space (chat, Studio main view, focus running)",
    source: "space-v2",
    query: "chat=v2&focus=work",
    native: true,
    masks: [
      { x: 952, y: 48, w: 328, h: 752, reason: "Studio restyled in 02 §10 step" },
      { x: 1036, y: 6, w: 92, h: 36, reason: "Calculator button arrives with the calculator in the Studio step (02 §10.7)" },
    ],
    setup: async (p) => {
      await space(p);
      await p.evaluate(() => document.querySelector("[data-testid=message-list]")?.scrollTo(0, 0));
      await settle(p);
    },
  },
  3: {
    title: "Review (cards)",
    query: "cards=review",
    native: true,
    setup: async (p) => {
      await nav(p, { name: "review" });
      await p.getByText("When should you solve", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
      for (let i = 0; i < 3; i++) {
        await click(p, /show answer|reveal/i).catch(() => undefined);
        await click(p, /^good/i).catch(() => undefined);
      }
      await click(p, /show answer|reveal/i).catch(() => undefined);
    },
  },
  4: {
    title: "Practice (topic list)",
    query: "curriculum=practice",
    setup: async (p) => {
      await nav(p, { name: "practice", spaceId: SPACE });
      await settle(p, 400);
    },
  },
  5: {
    title: "Settings",
    native: false,
    setup: async (p) => {
      await nav(p, { name: "settings" });
      await settle(p, 400);
    },
  },
  6: {
    title: "Source viewer",
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
      await click(p, /OpenStax Algebra/, null);
      await settle(p, 400);
    },
  },
  7: {
    title: "Start a focus session",
    setup: async (p) => {
      await space(p);
      await setUi(p, { focusDialogOpen: true });
      await settle(p, 400);
    },
  },
  8: {
    title: "Break",
    query: "focus=break",
    setup: async (p) => {
      await space(p);
      await settle(p, 600);
    },
  },
  9: {
    title: "Command palette",
    query: "cards=review",
    masks: [
      ...outside({ x: 339, y: 96, w: 602, h: 504 }, BACKDROP),
      { x: 340, y: 150, w: 600, h: 450, reason: "design lists 2 of the 6 fixture spaces, so the rows below shift (sample data)" },
    ],
    setup: async (p) => {
      await home(p);
      await setUi(p, { paletteOpen: true });
      await settle(p, 400);
    },
  },
  10: {
    title: "Quick capture",
    query: "cards=review",
    masks: [
      ...outside({ x: 399, y: 233, w: 482, h: 334 }, BACKDROP),
      { x: 798, y: 516, w: 66, h: 38, reason: "Save is disabled while the note is empty (real behavior); the design draws it enabled" },
    ],
    setup: async (p) => {
      await home(p);
      await setUi(p, { captureOpen: true });
      await settle(p, 400);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
  11: {
    title: "Quiz",
    pending: "Quiz is launched from the lesson/quiz flow; the pre-quiz dialog (\"Before you start\") needs the new entry point",
    setup: async (p) => {
      await space(p);
      await click(p, /quiz me/i).catch(() => undefined);
      await settle(p, 800);
    },
  },
  12: {
    title: "Practice problem",
    query: "curriculum=practice",
    native: true,
    setup: async (p) => {
      await nav(p, { name: "practice", spaceId: SPACE, topicKey: "systems" });
      await p.getByText(/Solve the system/).first().waitFor({ timeout: 8000 }).catch(() => undefined);
      const input = p.getByRole("textbox").last();
      await input.fill("6").catch(() => undefined);
      await click(p, /^check$/i).catch(() => undefined);
      await settle(p, 800);
    },
  },
  13: {
    title: "Check my steps",
    setup: async (p) => {
      await space(p);
      await studio(p, "steps", "Check my steps");
    },
  },
  14: {
    title: "Use a photo of your work",
    pending: "Photo dialog is opened from the step checker; needs recipe against the restyled step checker",
    setup: async (p) => {
      await space(p);
      await studio(p, "steps", "Check my steps");
      await click(p, /use a photo/i).catch(() => undefined);
      await settle(p, 500);
    },
  },
  15: {
    title: "Flashcards",
    query: "cards=browse",
    native: true,
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
    },
  },
  16: {
    title: "Make flashcards",
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await click(p, /make cards from sources/i).catch(() => undefined);
      await settle(p, 400);
    },
  },
  17: {
    title: "Add a card",
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await click(p, /^add card$/i).catch(() => undefined);
      await settle(p, 400);
    },
  },
  18: {
    title: "Browse cards",
    query: "cards=browse",
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await click(p, /browse cards/i).catch(() => undefined);
      await settle(p, 400);
    },
  },
  19: {
    title: "Image card (occlusion)",
    pending: "Occlusion editor needs an image in the mock (image_store) and the redesigned dialog",
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await click(p, /image card/i).catch(() => undefined);
      await settle(p, 500);
    },
  },
  20: {
    title: "Learning plan",
    query: "curriculum=plan",
    setup: async (p) => {
      await space(p);
      await studio(p, "plan", "Learning plan");
    },
  },
  21: {
    title: "Course",
    setup: async (p) => {
      await space(p);
      await studio(p, "course", "Course");
    },
  },
  22: {
    title: "Journal",
    setup: async (p) => {
      await space(p);
      await studio(p, "journal", "Journal");
    },
  },
  23: {
    title: "Space settings",
    native: true,
    setup: async (p) => {
      await space(p);
      await studio(p, "settings", "Space settings");
    },
  },
  24: {
    title: "Focus session running",
    query: "focus=work",
    native: true,
    setup: async (p) => {
      await space(p);
      await studio(p, "focus", "Focus");
    },
  },
  25: {
    title: "Where do I start?",
    setup: async (p) => {
      await space(p);
      await studio(p, "microsteps", "Where do I start");
    },
  },
  26: {
    title: "Low-energy session",
    query: "focus=work",
    pending: "Low-energy card needs a session started with energy=low; fixture seeds energy normal",
    setup: async (p) => {
      await space(p);
      await studio(p, "lowEnergy", "Low-energy");
    },
  },
  27: {
    title: "Sources panel",
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
    },
  },
  28: {
    title: "Watched folders",
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
      await setUi(p, { watchDialogOpen: true });
      await settle(p, 500);
    },
  },
  29: {
    title: "Deep research",
    pending: "Deep research needs live web search and a model; the found-sources list isn't reachable from the mock",
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
      await setUi(p, { importDialog: { open: true, tab: "research", query: "How substitution and elimination compare for GED problems" } });
      await settle(p, 500);
    },
  },
  30: {
    title: "Google Drive",
    query: "drive=1",
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
      await setUi(p, { importDialog: { open: true, tab: "gdrive" } });
      await settle(p, 800);
      await p.getByText("Math formula sheet").first().click().catch(() => undefined);
      await p.getByText("Practice test answers").first().click().catch(() => undefined);
      await settle(p, 300);
    },
  },
  31: {
    title: "Mistake notebook",
    setup: async (p) => {
      await nav(p, { name: "review", tab: "mistakes" });
      await click(p, /mistake notebook/i, "tab").catch(() => undefined);
      await settle(p, 400);
    },
  },
  32: {
    title: "Add an AI provider",
    masks: [
      { x: 380, y: 500, w: 560, h: 260, reason: "provider tiles the design omits stay reachable, DECISIONS #14" },
    ],
    setup: async (p) => {
      await nav(p, { name: "settings" });
      await click(p, /add provider/i);
      await settle(p, 400);
    },
  },
  33: {
    title: "Local AI servers",
    setup: async (p) => {
      await nav(p, { name: "settings" });
      await click(p, /find on my network/i);
      await settle(p, 900);
    },
  },
  34: {
    title: "Sign in with Grok",
    setup: async (p) => {
      await nav(p, { name: "settings" });
      await click(p, /add provider/i);
      await p.getByRole("button", { name: /^Grok/ }).first().click();
      await click(p, /add provider/i);
      await p.getByText("WDJB-MJHT").waitFor({ timeout: 8000 });
      await settle(p, 600);
    },
  },
  35: {
    title: "Break menu",
    setup: async (p) => {
      await nav(p, { name: "settings" });
      await click(p, /edit break menu/i);
      await settle(p, 400);
    },
  },
  36: {
    title: "No spaces yet",
    query: "spaces=none",
    setup: home,
  },
  37: {
    title: "Nothing due",
    query: "cards=none",
    setup: async (p) => {
      await nav(p, { name: "review" });
      await settle(p, 400);
    },
  },
  38: {
    title: "Empty space",
    query: "chat=none&sources=empty",
    native: true,
    masks: [
      { x: 700, y: 250, w: 110, h: 90, reason: "Ponder mark replaces the chat-icon tile, 05-brand.md" },
      { x: 1036, y: 6, w: 92, h: 36, reason: "Calculator button arrives with the calculator in the Studio step (02 §10.7)" },
    ],
    setup: async (p) => {
      await setUi(p, { studioOpen: false, sourcesOpen: {}, modelControls: { "prov-anthropic:Sonnet 5.5": { reasoning: "high" } } });
      await nav(p, { name: "space", spaceId: SPACE });
      await settle(p, 600);
    },
  },
};

export function buildRecipes(): Recipe[] {
  const out: Recipe[] = [];
  for (const [k, s] of Object.entries(SCREENS)) {
    const n = Number(k);
    for (const theme of ["a", "b"] as const) {
      const o = { ...s, ...(s.overrides?.[theme] ?? {}) };
      out.push({
        id: `${n}${theme}`,
        n,
        title: o.title,
        query: o.query ?? "",
        source: o.source ?? "app-screens",
        pending: o.pending,
        masks: o.masks ?? [],
        native: !!o.native,
        setup: o.setup,
      });
    }
  }
  return out;
}
