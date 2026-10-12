# Calculator: builder questions

These are questions from the builder for the spec. All 645 earlier verified vectors pass (60 more were added by the third random check; see BEHAVIOR "Changes"), so no vector is marked as an expected failure (`src/features/calculator/engine/divergences.ts` is empty).

## Answered by the verification pass (closed)

The verified spec answered all of these. The build now follows it.
- Q1: the `↓` rule. `↓` is lit after a calculation while the entry line is still empty, and while browsing history.
- Q2: tall rows and scrolling by dot rows (§2.3).
- Q3: 10 significant digits in stat menus.
- Q4: four data-editor rows; empty grid rows are omitted.
- Q5: a stray `)` is SYNTAX.
- Q6: `var` cycling.
- Q7: `sto` inside a fraction gives SYNTAX. Variables store the decimal value.
- Q8: the same-row rule (cells ≤ 14, with the two exceptions).
- Q9: FLOAT goes scientific below 1×10⁻⁹.
- Q12: indicators on application screens.
- Q13 (raised minus sign): the vectors were misread. There is no separate `⁻` row; the special case is removed.

## Open

### Q10. Internal arithmetic rounds down

The build truncates each arithmetic result to 13 significant digits. That is the only way GB p.19's `39.43972222221` comes out. Exact values (fractions, π, √) are rounded once when they become decimals, so 2/3 toggles to `0.6666666666667`. Every vector agrees with this.

Checked on the reference with toggle in the third random check (BEHAVIOR §7.1):
- Function values come out correctly rounded at 13 digits, not truncated: `3cos(332)` → `2.648842778577`, `ln(2)`, `10^{.5}` → `3.162277660168`, `e^{1}` → `2.718281828459`.
- eˣ for larger x is a few units low in the 13th digit: `e^{2}` → `7.389056098929` (true …93065), `e^{3}` → `20.08553692315` (true …231877), `e^{3cos(332)}` → `14.13766876221` (true …2468).
- No simple formula reproduces those (10^(x·log e) was tried).

Treat it as a known divergence: it only shows in 13-digit toggle rows, never in the 10-digit display. No vector covers it.

### Q11. rand generator

The seeded vectors pass with this generator: s ← 40014·s mod 2147483563, rand = s / 2147483563, where `n→rand` sets s = n. Unseeded rand starts from a fixed seed (12345) after a reset. The reference does not do this: it gives a different sequence on each run (BEHAVIOR §14).

### Q13. Rules fitted to single vectors (please confirm with more probes)

- **Fraction-with-radical result:** `sin(45)` / `\t\f{√{2}}{2}` goes to its own row, but `5*cos(\f{π}{4})\t\f{5√{2}}{2}` stays on the same row. The build moves such a result to its own row only when the entry has no fraction.
- **`2√{2}◂▸` and `3.142857142857◂▸`** follow the general cell rule. Answered in part: `frac-toggleRowWidth` (`\f{2}{3}◂▸\t0.666666667`) sits exactly at the 14-cell limit once a fraction counts as its wider part + 1 (BEHAVIOR §3.2).
- **Data editor and stats:** picking a stat result after starting from the data editor pastes it into the edit line. `enter` then stores it, and the stored value becomes `ans` (`stat-oneVarAnsTimes2`). `data` in the CLEAR/FORMULA menu returns to the editor at row 1 (`stat-editorClearAll`).

### Q15. Cursor cell when an entry ends in a function token

When the entry scrolls, the cursor normally takes a cell of its own (`edit-scroll16`). `edit-deleteExponentLong` ends in `tan(` and shows 15 content cells after the `◂`, with no room for the cursor, and the left edge cuts into `ans` (`◂s8÷…`). The build drops the cursor cell when the entry ends in a function token or `ans`. Probes with other tokens and with a scroll built up in several steps would confirm whether the reference scrolls per key rather than per screen.

Partly answered by the third random check (BEHAVIOR §3.2):
- An empty template slot that holds the cursor counts as one cell, and the end cursor cell is still reserved after it (`edit-scrollEmptyExp14`, `edit-scrollEmptyExp15`).
- The `⁻¹` of `tan⁻¹(` takes one cell: `2nd tan . pi 5 2nd lparen div recip pow` fits in cells 0-14 without scrolling.

### Q14. Not covered by vectors; the build's choice

- Error screen: only `clear` (back to the entry) and `2nd`, `mode` act. An errored entry goes into history without a result, and the screen above the entry is cleared (`err-historyAfterError`).
- Function table: `left`/`right` switch the selected column, and the edit line shows `y=` for the y column. In Auto mode, `up` above Start continues to smaller x values.
- ~~Tall parentheses are drawn at normal height.~~ Answered by the third random check: the reference draws them tall, 13 dots, next to or around a stacked fraction (BEHAVIOR §3.1).

### Q16. Scroll offset with fractions and radicals (open)

With a stacked fraction or a radical on the line, the reference's scrolled window does not follow the cell rule in §3.2, and its left edge can fall at a half-cell offset. Observed:
- `1 2 3 tan 5 2 frac 2nd sin 5 7` fits without scrolling. With `1 2 3 4` in front, the reference scrolls (the left edge cuts into `3`, then `4tan(`). Ponder doesn't scroll there.
- With `1 2 3 4 5` in front, both scroll, but the reference again shows a partly cut cell after `◂`.
- `4 2nd log div 4 right 6 tan 5 2 frac 2nd sin 5 7` (random-2-126): after `◂` the reference shows part of a cell, then `6` starting at dot column 10 (a half cell). Ponder shows `◂^{÷4}6tan(…`.
- `8 2nd square pow 2nd neg toggle 3 add 3 7 3 tan 2 7` (random-1-138, inside a radical's superscript): the reference content sits one cell further left than Ponder's. The `n` is under `◂` and the last cell is empty.

Probes need the PNGs, since the LCD reader cannot decode half-cell offsets.

### Q17. Fraction in a superscript, nested placeholders (build check)

Observed and written down (BEHAVIOR §3.1), but there is no text vector for the geometry: `2 pow 1 frac 3` draws the fraction at normal fraction size inside the exponent, with the base dropped. To compare when building, run a vector file with that key sequence through `scripts/calc-diff.ts` (`--random 0 --clicks 0`) and look at the PNG it writes.

