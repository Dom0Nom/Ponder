# Calculator: builder questions

These are questions from the builder for the spec. All 625 verified vectors pass, so no vector is marked as an expected failure (`src/features/calculator/engine/divergences.ts` is empty).

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

## Open

### Q10. Internal arithmetic rounds down

The build truncates each arithmetic result to 13 significant digits. That is the only way GB p.19's `39.43972222221` comes out. Exact values (fractions, π, √) are rounded once when they become decimals, so 2/3 toggles to `0.6666666666667`. Every vector agrees with this. It has not been checked separately on the reference.

### Q11. rand generator

The seeded vectors pass with this generator: s ← 40014·s mod 2147483563, rand = s / 2147483563, where `n→rand` sets s = n. Unseeded rand starts from a fixed seed (12345) after a reset. The reference does not do this: it gives a different sequence on each run (BEHAVIOR §14).

### Q13. Rules fitted to single vectors (please confirm with more probes)

- **Raised minus sign:** `\f{3}{5}^{⁻1}` and `(4^{⁻1})^{⁻1}` read as a separate `⁻` row above the entry. The build splits off the minus of any superscript whose base is a fraction, or a parenthesis group containing a power or fraction. This only affects the text encoding.
- **Fraction-with-radical result:** `sin(45)` / `\t\f{√{2}}{2}` goes to its own row, but `5*cos(\f{π}{4})\t\f{5√{2}}{2}` stays on the same row. The build moves such a result to its own row only when the entry has no fraction.
- **`2√{2}◂▸` and `3.142857142857◂▸`** follow the general cell rule. None of the vectors cover a toggle row exactly at the 14-cell limit.
- **Data editor and stats:** picking a stat result after starting from the data editor pastes it into the edit line. `enter` then stores it, and the stored value becomes `ans` (`stat-oneVarAnsTimes2`). `data` in the CLEAR/FORMULA menu returns to the editor at row 1 (`stat-editorClearAll`).

### Q14. Not covered by vectors; the build's choice

- Error screen: only `clear` (back to the entry) and `2nd`, `mode` act. An errored entry goes into history without a result, and the screen above the entry is cleared (`err-historyAfterError`).
- Function table: `left`/`right` switch the selected column, and the edit line shows `y=` for the y column. In Auto mode, `up` above Start continues to smaller x values.
- Tall parentheses (9 and 13 dots) are drawn at normal height. Only the text encoding was verified for them.
