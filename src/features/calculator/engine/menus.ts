/** Menus as data (BEHAVIOR §20, GB p.4-5). Labels are device legends; actions are interpreted by calc.ts. */

export type MenuAction =
  | { ins: string; ansFirst?: boolean }
  | { dms: true }
  | { reset: boolean }
  | { clearVars: boolean }
  | { recall: string }
  | { stats: 1 | 2 | 3 }
  | { clearList: number }
  | { formula: "edit" | number }
  | { statTok: string };

export interface MenuItem {
  label: string;
  act: MenuAction;
}
export interface MenuTab {
  title: string;
  items: MenuItem[];
}

export type MenuId = "prb" | "angle" | "reset" | "clearvar" | "recall" | "stats" | "data" | "ls" | "statvars";

const ins = (label: string, v = label, ansFirst = false): MenuItem => ({ label, act: { ins: v, ansFirst } });

export const STATIC_MENUS: Partial<Record<MenuId, MenuTab[]>> = {
  prb: [
    { title: "PRB", items: [ins("nPr", " nPr ", true), ins("nCr", " nCr ", true), ins("!", "!", true)] },
    { title: "RAND", items: [ins("rand"), ins("randint(")] },
  ],
  angle: [
    {
      title: "DMS",
      items: [ins("°"), ins("'"), ins('"'), ins("ʳ"), ins("ᵍ"), { label: "▸DMS", act: { dms: true } }],
    },
    { title: "R◂▸P", items: [ins("R▸Pr("), ins("R▸Pθ("), ins("P▸Rx("), ins("P▸Ry(")] },
  ],
  reset: [
    {
      title: "Reset",
      items: [
        { label: "No", act: { reset: false } },
        { label: "Yes", act: { reset: true } },
      ],
    },
  ],
  clearvar: [
    {
      title: "Clear Var",
      items: [
        { label: "Yes", act: { clearVars: true } },
        { label: "No", act: { clearVars: false } },
      ],
    },
  ],
  data: [
    {
      title: "CLEAR",
      items: [
        { label: "Clear L1", act: { clearList: 0 } },
        { label: "Clear L2", act: { clearList: 1 } },
        { label: "Clear L3", act: { clearList: 2 } },
        { label: "Clear ALL", act: { clearList: -1 } },
      ],
    },
    {
      title: "FORMULA",
      items: [
        { label: "Add/Edit Frmla", act: { formula: "edit" } },
        { label: "Clear L1 Frmla", act: { formula: 0 } },
        { label: "Clear L2 Frmla", act: { formula: 1 } },
        { label: "Clear L3 Frmla", act: { formula: 2 } },
        { label: "Clear ALL", act: { formula: -1 } },
      ],
    },
  ],
  ls: [{ title: "Ls", items: [ins("L1"), ins("L2"), ins("L3")] }],
};

export const STAT_ITEMS_1 = ["n", "x̄", "Sx", "σx", "Σx", "Σx²", "minX", "Q1", "Med", "Q3", "maxX"];
export const STAT_ITEMS_2 = [
  "n",
  "x̄",
  "Sx",
  "σx",
  "ȳ",
  "Sy",
  "σy",
  "Σx",
  "Σx²",
  "Σy",
  "Σy²",
  "Σxy",
  "a",
  "b",
  "r",
  "x'",
  "y'",
  "minX",
  "maxX",
  "minY",
  "maxY",
];

/** Item number: 1-9, then A, B, C… */
export const itemNumber = (i: number) => (i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9));

/** Rows of a menu screen: tabs or title, then 3 items with ↑/↓ marks (BEHAVIOR §20). */
export function menuRows(tabs: MenuTab[], tab: number, sel: number, top: number): string[] {
  const head = tabs.length > 1 ? tabs.map((t, i) => (i === tab ? `«${t.title}»` : t.title)).join(" ") : `«${tabs[0].title}»`;
  const items = tabs[tab].items;
  const rows = [head];
  for (let i = top; i < Math.min(top + 3, items.length); i++) {
    const mark = i === top && i > 0 ? "↑" : i === top + 2 && i < items.length - 1 ? "↓" : ":";
    const num = itemNumber(i) + mark;
    rows.push((i === sel ? `«${num}»` : num) + items[i].label);
  }
  return rows;
}
