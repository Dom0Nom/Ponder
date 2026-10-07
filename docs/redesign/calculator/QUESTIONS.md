# Calculator: builder questions

Questions from the builder for the next spec pass. Each entry says what the spec leaves open or where vectors conflict, what the build does meanwhile, and which vectors are marked as expected failures (`src/features/calculator/engine/divergences.ts`).

## Q1. `↓` indicator rule

**Conflict.** No single rule satisfies every vector:
- `trig-asinhByEdit`, `const-kSquare`, `const-kOff` expect `↑ ↓` on screens where nothing is scrolled off and nothing is being pasted.
- `ans-upPasteEvaluate`, `var-varCycleY` and `const-kApplyTwice` expect only `↑` in the same kinds of situations.
- The guidebook images are not consistent either. GB p.3 shows the same `12345` SCI result with `↑ ↓` in Classic and only `↑` in MathPrint. GB p.21 shows `↑ ↓` after `5*cos(60)` but only `↑` after `tan(45)` on the same kind of screen.

**Build.** `↑` is lit whenever history exists. `↓` is lit while browsing history, while an entry pasted from history is still being edited, or when the entry line is empty and earlier rows have scrolled off the top.

**Expected failures:** `trig-asinhByEdit`, `const-kSquare`, `const-kOff`.

## Q2. How many tall MathPrint rows fit

**Conflict.** `trig-radAtan1Toggle` (GB p.21, high) needs the `tan⁻¹(1)` row to scroll off when the `π/4` fraction row is added, so a stacked fraction is about two text rows tall. `frac-mpToggleBack` (low) and `trig-radFiveCosToggle` (low) expect three or four rows with fractions to stay visible at once. GB p.21 shows only the last two rows for `trig-radFiveCosToggle`.

**Build.** The text area is 34 dot rows. A plain row is 8, a row with a superscript is 11, a √ row is 10, and a stacked fraction is 17. Rows are filled from the bottom.

**Expected failures:** `frac-mpToggleBack`, `trig-radFiveCosToggle`.

## Q3. Trailing zeros in stat values

**Conflict.** GB p.28 shows `D:a=0.677325190`, which keeps a trailing zero after rounding. `stat-oneToFiveResults` and `stat-oneToFiveScroll` (medium) expect `Sx=1.58113883`, which strips it, even though √2.5 = 1.5811388300… is also rounded.

**Build.** As in GB: a value that is exact at 10 digits is shown stripped (`52.5`). A value that has to be rounded keeps all of its digits, and it is cut to 11 characters (`⁻18.6663732`).

**Expected failures:** `stat-oneToFiveResults`, `stat-oneToFiveScroll`.

## Q4. Data editor rows

**Conflict.** GB p.32 and p.28 show four list rows plus the edit line (`1/2`, `3/4`, `1`, `------`, then `L1(5)=`), and `stat-dataEditorAfterEntry` agrees. `stat-formulaResult` (low) shows only three list rows.

**Build.** Four list rows, per GB.

**Expected failure:** `stat-formulaResult`. Its cell values (`46.4`, `30.2`, `39.2`) do match.

## Q5. Stray `)` after deleting a function token

**Conflict.** `edit-deleteFunctionToken` (low) expects `30)` to evaluate to `30`. GB p.38 lists a misplaced parenthesis as `SYNTAX`, and `err-syntaxLoneParen` expects `SYNTAX` for `)` alone.

**Build.** A `)` without a matching `(` is `SYNTAX`.

**Expected failure:** `edit-deleteFunctionToken`.

## Q6. `var` cycling right after `enter`

**Conflict.** `var-varTimesVar` (low) expects `4 sto var enter var var enter` to show `x` = `4`. `var-cycle2` (high) and `var-useYThenDivide` say that `var var` gives `y`.

**Build.** Two `var` presses in a row give `y`, whatever came before.

**Expected failure:** `var-varTimesVar`.

## Q7. Do variables keep fractions?

**Conflict.** GB p.11 stores `Ans→y` with Ans = 225, then evaluates `y`, then `Ans÷4`, and shows `56.25`, a decimal. Meanwhile `ans-implicitAnsDiv` shows `10 enter`, `÷4` as `5/2`. Both hold only if a value read back from a variable is a decimal. `var-recallFraction` (low) expects the recall menu to show `x=1/4`.

**Build.** Variables store the decimal value. Ans keeps the exact form. Lists keep a fraction only when it was entered with the fraction key (GB p.32: "except fractional elements").

**Expected failure:** `var-recallFraction`.

## Q8. Same-row rule for results (needs confirmation, all vectors pass)

The pixel rule could not be fitted: `e^{.5}` + `1.648721271` wraps (GB p.23), while the wider `√{2}◂▸` + `1.414213562` stays on one row (GB p.7). A cell count fits every vector:
- entry cells + result cells ≤ 14 puts the result on the same row;
- a superscript counts one extra cell (its caret) in the entry, but not in the result;
- a stacked fraction counts as its wider part;
- `√` counts one cell, `◂▸` counts one cell.

Please confirm this with longer entries and results.

## Q9. FLOAT switch to scientific for small numbers (open item 1)

**Build.** A value with |x| < 1 is shown with 9 decimals when that is exact, or when |x| ≥ 1×10⁻⁵ (this keeps GB p.30's `0.000093165`). Anything smaller and inexact goes to scientific (`1.234*10^{⁻7}`). The 10⁻⁵ threshold is a guess.

## Q10. Internal arithmetic rounds down

GB p.19 pastes `39.43972222221` for `12°31'45"+26°54'38"`. This only comes out if each step is truncated to 13 digits, not rounded. The build truncates every arithmetic result to 13 significant digits. Exact values (fractions, π, √) are rounded once when they turn into decimals (`0.6666666666667` when 2/3 is toggled). Please confirm with `2÷3`, then `◂▸`, then `◂▸`.

## Q11. rand generator

`5→rand` followed by `rand` gives `0.000093165` (GB p.30), and the next `randint(3,5)` gives `5`. Both match a multiplicative generator: s ← 40014·s mod 2147483563, rand = s / 2147483563, seeded with s = 5. The seed after a reset is unknown; the build uses 12345.

## Q12. Indicators on application screens

GB p.34 shows the function-table entry screen and the table with `↑` and no `DEG`, while the vectors expect `DEG`. GB p.28 shows the data editor with `↑` and no `DEG`. **Build:** follows the vectors (angle indicator shown, no arrows).

## Q13. Not covered by the spec; the build's choice

- Error screen: only `clear` (back to the entry, cursor at the end) and `2nd`, `mode` (quit) do anything. Other keys are ignored.
- `MEMORY CLEARED`: `clear` dismisses it. Any other key dismisses it and then acts.
- Data editor: `clear` empties the edit line. `delete` removes the selected element.
- Function table, Auto: `up` above Start keeps going to smaller x values. `clear` returns to the setup screen.
- ENG/SCI results that are non-integer fractions are shown as decimals; π and √ forms stay exact (`fmt-sciPi`).
- Overflow inside the data editor or table shows the error screen and then returns to that screen.
