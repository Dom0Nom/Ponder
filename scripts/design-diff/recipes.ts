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

/**
 * Component-only comparison, approved by the user for artboards that draw an older space screen
 * (no thread list, 592px chat column, old composer) behind their dialog or panel. The backdrop
 * follows the 2a reference instead and is gated by screen 2 itself. The rectangle is the
 * component's box in the artboard; % is relative to that box.
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
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
  region?: Region;
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
  region?: Region;
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
const STUDIO_BOX = { x: 931, y: 49, w: 341, h: 743 };
const STUDIO_IN_CARD =
  "DECISIONS #2: the app's Studio is the 2a column (328px, outside the chat card); screens 22-26 draw it inside the card at 340px. The recipe re-lays the panel into the design's box; the sidebar and chat around it differ by 2a decisions";
/** Moves the real Studio panel into the 340px slot inside the chat card that screens 22-26 draw. */
const studioInCard = (p: Page) =>
  p.addStyleTag({
    content: `[data-testid=pane-studio]{top:2px!important;right:9px!important;bottom:9px!important;width:341px!important;border-top:0!important;z-index:20}`,
  });
const BACKDROP = "the design draws 9a/10a over a static copy of Home (shifted, no New space button), not the real screen 1";

const OLD_BACKDROP = "old-backdrop artboard: the component box only; the backdrop is gated by screen 2";

export const SCREENS: Record<number, Screen> = {
  1: { title: "Home", native: true, query: "cards=review", setup: home },
  2: {
    title: "Space (chat, Studio main view, focus running)",
    source: "space-v2",
    query: "chat=v2&focus=work&cards=review&sources=many&course=62",
    native: true,
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
    masks: [
      { x: 420, y: 274, w: 640, h: 22, reason: "queue count is fixture data (mock counts rows); space name is a kept feature, DECISIONS #14" },
      { x: 420, y: 636, w: 640, h: 24, reason: "scheduler previews depend on fixture card state" },
    ],
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
    region: { x: 233, y: 48, w: 1040, h: 745, reason: OLD_BACKDROP },
    setup: async (p) => {
      await space(p, { sources: false, studio: false });
      const [start, end] = await p.evaluate(() => {
        const text = (window as unknown as { __mock: { db: () => { texts: Record<string, { text: string }> } } }).__mock.db().texts["src-openstax"].text;
        const paras = text.split("\n\n");
        return [paras[0].length + 2, paras[0].length + 2 + paras[1].length];
      });
      await setUi(p, { viewer: { sourceId: "src-openstax", start, end }, importDialog: { open: true } });
      await settle(p, 600);
      await p.evaluate(async () => {
        const mark = document.querySelector("[data-testid=cite-highlight]");
        const node = mark?.querySelector("span")?.firstChild ?? mark?.firstChild;
        if (!node?.textContent) return;
        const range = document.createRange();
        range.setStart(node, 0);
        let lo = 1;
        for (let e = 1; e < node.textContent.length; e++) {
          range.setEnd(node, e);
          const r = range.getBoundingClientRect();
          if (r.left + r.width / 2 >= 641) { lo = e; break; }
        }
        range.setEnd(node, lo);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        sel.removeAllRanges();
      });
      await settle(p, 200);
    },
  },
  7: {
    title: "Start a focus session",
    region: { x: 395, y: 183, w: 490, h: 434, reason: "the artboard draws an older space screen behind the dialog; the backdrop follows 2a and is gated by screen 2" },
    setup: async (p) => {
      await space(p, { sources: false, studio: false });
      await setUi(p, { focusDialogOpen: true });
      await settle(p, 400);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
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
    region: { x: 339, y: 96, w: 602, h: 488, reason: "the artboard draws an older Home (no New space button) behind the palette" },
    query: "cards=review&capture=off",
    setup: async (p) => {
      await home(p);
      await setUi(p, { paletteOpen: true });
      await settle(p, 400);
    },
  },
  10: {
    title: "Quick capture",
    region: { x: 399, y: 233, w: 482, h: 334, reason: "the artboard draws an older Home (no New space button) behind the capture dialog" },
    query: "cards=review",
    setup: async (p) => {
      await home(p);
      await setUi(p, { captureOpen: true });
      await settle(p, 400);
      await p.getByRole("textbox").first().fill(".");
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
  11: {
    title: "Quiz",
    query: "curriculum=plan",
    setup: async (p) => {
      await space(p);
      await studio(p, "plan", "Learning plan");
      await p.getByTestId("topic-row").filter({ hasText: "Systems of equations" }).first().click();
      await click(p, /start this topic/i, "menuitem");
      await p.getByTestId("quiz-question").waitFor({ timeout: 8000 }).catch(() => undefined);
      await settle(p, 500);
    },
  },
  12: {
    title: "Practice problem",
    query: "curriculum=practice",
    native: true,
    masks: [
      { x: 412, y: 170, w: 456, h: 108, reason: "math is KaTeX, the design draws STIX Two Text; the map keeps KaTeX (03 §2)" },
      { x: 1000, y: 380, w: 90, h: 22, reason: "skill change kept after answering, not drawn; DECISIONS #14" },
      { x: 412, y: 92, w: 140, h: 22, reason: "problem count is fixture data and increments after grading" },
    ],
    setup: async (p) => {
      await nav(p, { name: "practice", spaceId: SPACE, topicKey: "systems" });
      await p.getByText(/Solve the system/).first().waitFor({ timeout: 8000 }).catch(() => undefined);
      const input = p.getByRole("textbox").last();
      await input.fill("x = 6").catch(() => undefined);
      await click(p, /^check$/i).catch(() => undefined);
      await settle(p, 800);
    },
  },
  13: {
    title: "Check my steps",
    masks: outside(STUDIO_BOX, STUDIO_IN_CARD),
    setup: async (p) => {
      await space(p);
      await studio(p, "steps", "Check my steps");
      await studioInCard(p);
    },
  },
  14: {
    title: "Use a photo of your work",
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
    masks: outside(STUDIO_BOX, STUDIO_IN_CARD),
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await studioInCard(p);
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
      await p.getByLabel("Front", { exact: true }).fill("What does substitution need?");
      await p.getByLabel("Back", { exact: true }).fill("One equation with a variable already on its own.");
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
    setup: async (p) => {
      await space(p);
      await studio(p, "flashcards", "Flashcards");
      await p.getByTestId("occlusion-editor-button").click();
      await click(p, /choose image/i).catch(() => undefined);
      await settle(p, 600);
    },
  },
  20: {
    title: "Learning plan",
    query: "curriculum=plan",
    masks: outside(STUDIO_BOX, STUDIO_IN_CARD),
    setup: async (p) => {
      await space(p);
      await studio(p, "plan", "Learning plan");
      await studioInCard(p);
    },
  },
  21: {
    title: "Course",
    masks: outside(STUDIO_BOX, STUDIO_IN_CARD),
    setup: async (p) => {
      await space(p);
      await studio(p, "course", "Course");
      await studioInCard(p);
    },
  },
  22: {
    title: "Journal",
    region: { x: 931, y: 49, w: 341, h: 743, reason: "the artboard draws an older space screen with the Studio inside the chat card (340px); DECISIONS #2 keeps the app's Studio at 328px, so the recipe lays the real panel into the artboard's box" },
    setup: async (p) => {
      await space(p);
      await studio(p, "journal", "Journal");
      await studioInCard(p);
    },
  },
  23: {
    title: "Space settings",
    region: { x: 931, y: 49, w: 341, h: 743, reason: "the artboard draws an older space screen with the Studio inside the chat card (340px); DECISIONS #2 keeps the app's Studio at 328px, so the recipe lays the real panel into the artboard's box" },
    native: true,
    setup: async (p) => {
      await space(p);
      await studio(p, "settings", "Space settings");
      await p.getByRole("switch", { name: /sources only/i }).click();
      await studioInCard(p);
    },
  },
  24: {
    title: "Focus session running",
    region: { x: 931, y: 49, w: 341, h: 743, reason: "the artboard draws an older space screen with the Studio inside the chat card (340px); DECISIONS #2 keeps the app's Studio at 328px, so the recipe lays the real panel into the artboard's box" },
    query: "focus=work",
    native: true,
    setup: async (p) => {
      await space(p);
      await studio(p, "focus", "Focus");
      await studioInCard(p);
    },
  },
  25: {
    title: "Where do I start?",
    region: { x: 931, y: 49, w: 341, h: 743, reason: "the artboard draws an older space screen with the Studio inside the chat card (340px); DECISIONS #2 keeps the app's Studio at 328px, so the recipe lays the real panel into the artboard's box" },
    setup: async (p) => {
      await space(p);
      await studio(p, "microsteps", "Where do I start");
      await studioInCard(p);
    },
  },
  26: {
    title: "Low-energy session",
    region: { x: 931, y: 49, w: 341, h: 743, reason: "the artboard draws an older space screen with the Studio inside the chat card (340px); DECISIONS #2 keeps the app's Studio at 328px, so the recipe lays the real panel into the artboard's box" },
    setup: async (p) => {
      await space(p);
      await studio(p, "lowEnergy", "Low-energy");
      await studioInCard(p);
    },
  },
  27: {
    title: "Sources panel",
    region: { x: 233, y: 48, w: 342, h: 745, reason: OLD_BACKDROP },
    setup: async (p) => {
      await space(p, { sources: true, studio: false });
    },
  },
  28: {
    title: "Watched folders",
    region: { x: 379, y: 230, w: 522, h: 340, reason: OLD_BACKDROP },
    setup: async (p) => {
      await space(p, { sources: false, studio: false });
      await setUi(p, { watchDialogOpen: true });
      await settle(p, 500);
    },
  },
  29: {
    title: "Deep research",
    region: { x: 337, y: 148, w: 606, h: 503, reason: OLD_BACKDROP },
    setup: async (p) => {
      await space(p, { sources: false, studio: false });
      const found = [
        ["Solving systems by substitution – Lumen Learning", "courses.lumenlearning.com", 88],
        ["Elimination method – Math is Fun", "www.mathsisfun.com", 85],
        ["GED Math test guide – GED Testing Service", "ged.com", 92],
        ["Forum thread: substitution tricks", "forum.example.org", 30],
      ].map(([title, host, credibility], i) => ({
        id: `r${i}`, title, url: `https://${host}/page`, engine: "duckduckgo", summary: "", credibility, relevance: 0.9, markdown: "",
      }));
      await setUi(p, { importDialog: { open: true, tab: "research", query: "How substitution and elimination compare for GED problems", found } });
      await p.getByRole("checkbox").last().uncheck();
      await settle(p, 500);
    },
  },
  30: {
    title: "Google Drive",
    region: { x: 299, y: 182, w: 682, h: 436, reason: OLD_BACKDROP },
    query: "drive=1",
    setup: async (p) => {
      await space(p, { sources: false, studio: false });
      await setUi(p, { importDialog: { open: true, tab: "gdrive" } });
      await settle(p, 800);
      await p.getByText("Math formula sheet").first().click().catch(() => undefined);
      await p.getByText("Week 4 notes").first().click().catch(() => undefined);
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
        region: o.region,
        native: !!o.native,
        setup: o.setup,
      });
    }
  }
  return out;
}
