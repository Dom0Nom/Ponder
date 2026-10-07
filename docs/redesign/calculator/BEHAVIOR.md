# Calculator behavior spec (GED test layout)

Source of truth for the builder of `src/features/calculator/`. Written clean-room: from TI's public *reference calculator guidebook* (2019 edition, cited as **GB p.N** with the printed page number) and from screenshots of the reference emulator. No code, artwork or font data from the reference is used or described here.

## 0. Status and confidence

**Read this first.** The reference emulator could not be run headless in this pass:
- The local copy (`~/ai-learning-app-redesign/reference/ti30xs-site/index.html`) loads its scripts through Cloudflare Rocket Loader (`/cdn-cgi/scripts/…/rocket-loader.min.js`), which is not in the folder. Without it no script runs and the page stays blank.
- Fetching that loader, or opening the live page in Playwright, was refused by this session's permission policy. The user has to allow one of those before the black-box observation can happen (see `~/ai-learning-app-redesign/reference-tools/README.md`).

What that means for this file:
- Everything tagged **[GB]** comes from the guidebook text or its printed screen images, which show real device screens. Treat it as reliable.
- Everything tagged **[obs]** was measured from the one existing reference screenshot (`~/.playwright-mcp/ti30-reference.png`, 400×560, device at 1:1 CSS scale).
- Everything tagged **[dev]** is device behavior known from the reference calculator family but not yet confirmed on the reference. It is the best current statement and must be confirmed.
- **[open]** items are unknown and listed in §23. The differential check fixes them by observation and updates this file.

`vectors.json` follows the same split: every vector has `source` and `confidence`. None of them has been checked against the reference yet (`verified: false` on all). The first job of the differential run is to verify them and correct `expect` where the reference differs.

## 1. Key-name vocabulary

One name per physical key. A 2nd function is written as two key presses, `"2nd"` then the key (for example `["2nd","log"]` is 10ˣ). Names are ASCII so they are easy to type in tests.

| name | key face | 2nd function (`"2nd"` + name) | row/col |
|---|---|---|---|
| `2nd` | 2nd | (cancels a pending 2nd) | top A, col 1 |
| `mode` | mode | quit | top A, col 2 |
| `delete` | delete | insert | top A, col 3 |
| `up` | ▲ on the arrow pad | in history: jump to oldest; in lists: top of list; in a fraction denominator: history paste | arrow pad |
| `down` | ▼ | in lists: bottom of list | arrow pad |
| `left` | ◀ | move cursor to start of entry | arrow pad |
| `right` | ▶ | move cursor to end of entry | arrow pad |
| `log` | log | 10ˣ | top B, col 1 |
| `prb` | prb | angle | top B, col 2 |
| `data` | data | stat | top B, col 3 |
| `ln` | ln | eˣ | row 1, col 1 |
| `frac` | n/d (stacked "n over d") | U n/d (mixed number) | row 1, col 2 |
| `x10n` | ×10ⁿ | n/d◂▸U n/d | row 1, col 3 |
| `table` | table | f◂▸d | row 1, col 4 |
| `clear` | clear | — | row 1, col 5 |
| `pi` | π | hyp | row 2, col 1 |
| `sin` | sin | sin⁻¹ | row 2, col 2 |
| `cos` | cos | cos⁻¹ | row 2, col 3 |
| `tan` | tan | tan⁻¹ | row 2, col 4 |
| `div` | ÷ | K (constant) | row 2, col 5 |
| `pow` | ^ | ˣ√ (nth root) | row 3, col 1 |
| `recip` | x⁻¹ | — | row 3, col 2 |
| `lparen` | ( | % | row 3, col 3 |
| `rparen` | ) | ▸% | row 3, col 4 |
| `mul` | × | — | row 3, col 5 |
| `square` | x² | √ | row 4, col 1 |
| `7` `8` `9` | digits | — | row 4, cols 2-4 |
| `sub` | − | — | row 4, col 5 |
| `var` | x with y z t / a b c | clear var | row 5, col 1 |
| `4` `5` `6` | digits | — | row 5, cols 2-4 |
| `add` | + | — | row 5, col 5 |
| `sto` | sto→ | recall | row 6, col 1 |
| `1` `2` `3` | digits | — | row 6, cols 2-4 |
| `toggle` | ◂▸ (answer toggle) | — | row 6, col 5 |
| `on` | on | off | row 7, col 1 |
| `0` | 0 | reset | row 7, col 2 |
| `.` | . | , (comma) | row 7, col 3 |
| `neg` | (−) | ans | row 7, col 4 |
| `enter` | enter | — | row 7, col 5 |

45 physical keys (the arrow pad counts as four). The layout and legends are [obs]; the functions are [GB] (GB p.2 "2nd Functions", p.4-5 menu chart, p.9 "Clearing and Correcting").

Notes:
- `2nd` latches for exactly one key press. Pressing `2nd` twice cancels it (GB p.2). While latched, the `2ND` indicator shows [GB].
- `2nd`+`pi` (hyp) latches HYP for the next trig key; `HYP` indicator shows (GB p.22). `2nd`,`pi`,`2nd`,`sin` gives sinh⁻¹ (GB p.23).
- Physical keyboard mapping for Ponder (not part of the device): digits, `.`, `+ - * / ^ ( )`, Enter = `enter`, Backspace = `delete`, arrows = arrow pad, Escape = `clear`.

## 2. Display-text encoding (the test hook format)

The builder exposes the current screen as text through a test hook. The differential check reads the reference screen and writes the same encoding, so both sides compare string for string.

`expect` has:
- `lines`: the visible text rows of the LCD below the indicator row, **top to bottom**. Trailing empty rows are omitted (so after one calculation on a cleared screen, `lines` has one element). An empty row in the middle is `""`. At most 4 elements in Classic; MathPrint rows that hold stacked objects are taller, so fewer rows fit (see §3).
- `indicators`: the indicator-row items that are lit, in left-to-right screen order (§3.3).

Within a row:
- Left-aligned text, then a TAB (`\t`), then right-aligned text. A row with only a right-aligned result starts with `\t`. A row with only left text has no TAB.
- The cursor is **not** encoded (it blinks; screenshots would be flaky). Where cursor position matters, a vector checks it indirectly by typing a character after moving the cursor.
- Inverse-video (highlighted) text is wrapped in `«` and `»`, for example `«1:»nPr`.

Characters (exact code points the hook must output):

| on screen | text | note |
|---|---|---|
| multiplication (entry and history) | `*` | the device draws a star, not × [GB p.7-9] |
| division | `÷` | |
| subtraction | `-` (U+002D) | long minus |
| negation sign (from `neg`, and in negative results) | `⁻` (U+207B) | short raised minus, a different glyph from subtraction [GB p.9] |
| store arrow | `→` | `15→x` [GB p.10] |
| answer-toggle mark | `◂▸` | appended to a toggled entry, one character cell wide [GB p.3, p.7] |
| conversion arrow | `▸` | `▸DMS`, `▸%`, `▸F◂▸D`, `▸n/d◂▸Un/d` |
| degree / minute / second | `°` `'` `"` | ASCII apostrophe and double quote |
| radian / gradian marks | `ʳ` `ᵍ` | small raised r and g [GB p.18-19] |
| pi | `π` | |
| square root | `√` | |
| nth root (Classic) | `ˣ√` | written `3ˣ√64` in Classic [GB p.4] |
| x², x⁻¹ (Classic) | `²`, `⁻¹` | |
| power (Classic) | `^` | `2^5` |
| Classic fraction bar | `⁄` (U+2044) | `3⁄4` [GB p.13] |
| Classic mixed-number separator | `␣` (U+2423) | `4␣5⁄9` [GB p.4] |
| scientific "times ten" in results | `*10` + exponent | MathPrint `1.2345*10^{4}`, Classic `1.2345*10^4` [GB p.3] |
| exponent mark in restricted screens (data editor, table, recall menu) | `ᴇ` (U+1D07) | `196ᴇ3` [GB p.11] |
| horizontal overflow marks at row edges | `◂` (start) and `▸` (end) | `12°31'45"+26°54▸` [GB p.19] |
| menu "more below/above" in item numbers | `↓` `↑` | `3↓z=0`, `2↑Clear L2` [GB p.10, p.25] |
| x-bar, y-bar, sigma | `x̄` `ȳ` `σ` `Σ` | |
| variables | `x y z t a b c` | |
| list names | `L1 L2 L3` | |

MathPrint 2-D objects use a small markup (only in MathPrint):

| object | text | example |
|---|---|---|
| stacked fraction | `\f{num}{den}` | `\f{3}{4}` |
| mixed number | whole number directly followed by a stacked fraction | `4\f{5}{9}` |
| superscript (powers, x², x⁻¹, 10ˣ, eˣ exponents, ×10ⁿ exponents) | `^{…}` | `2^{5}`, `15^{2}`, `2^{⁻1}`, `10^{2}`, `e^{.5}` |
| square root | `√{…}` | `√{3^{2}+4^{2}}` |
| nth root | `\r{index}{radicand}` | `\r{3}{64}` |
| exact root result | coefficient then `√{…}` | `2√{2}`, `\f{5√{2}}{2}` |
| exact pi result | coefficient then `π` | `2π`, `144π`, `\f{π}{4}` |

Nested markup nests: `\f{⁻5+√{5^{2}-4(1)(6)}}{2(1)}` [GB p.14].

Grid screens:
- Data editor: each visible list row is `L1cell|L2cell|L3cell` (empty cell = empty string, first free slot = `------`), then the edit line (`L1(5)=`, or `♦L2=…` while editing a formula). The column titles `L1 L2 L3` are reported as indicators.
- Function table: a header row `x|y`, three rows `x|y`, then the bottom line (`x=15`).
- The selected cell is wrapped in `«…»` like other inverse text.

Error and message screens: the message text as one row (`DIVIDE BY 0`, `MEMORY CLEARED`).

## 3. Display layout

### 3.1 Geometry [GB p.1, obs]
- Text area: **4 rows × 16 character cells** in Classic (GB p.1: "a maximum of four lines with a maximum of 16 characters per line").
- Dot matrix 96 dots wide (16 nominal cells × 6 dots). Full-width glyphs are drawn in a 5×7 dot box inside a 6×8 cell (1 dot gap right and below); punctuation is narrower (§3.2). Text rows are 8 dots tall; MathPrint superscripts use a smaller font raised above the baseline; a stacked fraction takes about two rows. The indicator row above is a separate row in a tiny font (see UI-SPEC).
- Some full-screen messages (`MEMORY CLEARED` after reset) use a larger font, about 1.3× the normal cell height [obs, one screenshot].

### 3.2 Home screen layout [GB p.1, p.6-12]
- History grows from the **top**. After a clear, the first entry is on row 1. Each finished calculation shows the entry left-aligned and the result right-aligned.
- **The font is proportional.** GB screens show narrow glyphs for `.`, `'`, `°`, `"` and probably `1` (e.g. `1°30'0"` is visibly narrower than `1.5▸DMS`, GB p.18; `0.7853981633975◂▸` fits on one 96-dot row, GB p.21). "16 characters per line" is the nominal count for full-width glyphs. Glyph advance widths must be measured on the reference (open item 14).
- Result placement: the result shares the entry's row when both fit on the 96-dot row with a gap of about two full cells; otherwise the result goes right-aligned on the next row. Counting full-width cells, `entry + result ≤ 14` matches most GB screens: `25 nCr 3` / `2300` on one row but `52 nCr 5` with `2598960` on the next (GB p.30); `150*y` + `31.11*10⁶` on one row but `210*y` + `43.554*10⁶` wrapped (GB p.12). Exceptions such as `e^{.5}` with `1.648721271` wrapping (GB p.23) and `√(3²+7²)` with `√58` wrapping (GB p.22) show the real rule is pixel-based and also depends on row height. Vectors near the boundary are marked `low`. [GB, rule inferred]
- Glyph counts of compound tokens: `◂▸` is one cell; `▸n/d◂▸Un/d` is drawn as five cells (▸, a small n-over-d glyph, ◂▸, U, n-over-d); `▸F◂▸D` is four cells; ` nPr ` and ` nCr ` include a space on each side (GB p.30).
- When the screen is full, older rows scroll off the top. Pressing `up` scrolls back through history.
- An entry longer than 16 cells scrolls horizontally inside its row; the visible part shows `◂`/`▸` at the cut edge (GB p.1 indicator table, p.19).
- MathPrint objects (fractions, exponents, roots) make a row taller (a stacked fraction is about two text rows high), so fewer history rows fit (GB p.14: the quadratic formula entry plus its result fill the screen).

### 3.3 Indicator row [GB p.1-2]
Items that can be lit (encode with exactly these strings, in this left-to-right order):

`2ND`, `HYP`, `K`, `SCI` or `ENG`, `FIX`, `DEG` or `RAD` or `GRAD`, `↑`, `↓`, and the hourglass `BUSY` while computing.

- `DEG`/`RAD`/`GRAD` always shows the angle mode on the Home screen [GB images]. (The menus in GB show it too.)
- `↑` shows when there is history above what you see / you can scroll up; `↓` when there is something below (you are scrolled into history). GB images show `↑` after the first calculation. [GB, exact rule open]
- In the data editor the indicator row shows the list column labels `L1 L2 L3` instead of most indicators (GB p.25, p.32).
- The 1:1 reference screenshot shows `RAD` drawn small at about 82% of the LCD width (see UI-SPEC for positions).

### 3.4 Cursor [GB p.6, dev]
- A solid block the size of a cell, blinking, at the insertion point (`3+3█` in GB p.6).
- In insert mode (`2nd`,`delete`) the cursor changes shape (underline) [dev, confirm].
- In MathPrint templates the cursor is smaller when inside a superscript/fraction part [dev].

## 4. Power, reset and start state

- `on` turns the unit on; `2nd`,`on` turns it off. Off keeps history, settings and memory (GB p.1). APD after about 5 minutes; not needed in Ponder.
- **Reset**: `2nd`,`0` opens the menu `«Reset»` / `«1:»No` / `2:Yes` (GB p.5). `2` (or `down`,`enter`) resets: default modes, clears variables, pending operations, history, stat data, K and Ans (GB p.9-10). The screen shows `MEMORY CLEARED` in large letters [obs]; any key returns to an empty Home screen [dev].
- Defaults after reset (GB p.2): `DEG`, `NORM`, `FLOAT`, `MATHPRINT`.
- **Vector start state**: every vector in `vectors.json` starts from: reset (`2nd`,`0`,`2`), then `clear`. That is an empty Home screen, default modes, all variables 0, Ans 0, no history, empty lists. A vector's `mode` names a setup prefix (defined in `vectors.json` → `modes`) that runs after the reset and before `keys`. Expected text is read **after the last key** of `keys`.

## 5. Entry and editing [GB p.6, p.9]

- Typing inserts at the cursor. When the cursor is in the middle of an entry, typing **overwrites** the character under the cursor; `2nd`,`delete` (insert) switches to inserting for the next characters [dev, confirm with vectors `edit-*`].
- `delete` deletes the character at the cursor; at the end of the entry it deletes the character before the cursor [dev].
- `left`/`right` move the cursor one element (a whole token like `sin(` or `Ans` counts as one element) [dev]. `2nd`,`left` / `2nd`,`right` jump to the start/end (GB p.6).
- `clear`:
  - on an entry with text: clears the entry line;
  - on an empty entry line: clears the whole screen (history stays reachable with `up`) [GB p.9];
  - on an error: removes the error and returns to the entry with the cursor at the error (GB p.37);
  - in a menu or application: goes back one screen (GB p.4, p.9).
- `up`/`down` on the Home screen move through history entries and results. `enter` on a highlighted history item pastes it at the cursor (GB p.6: `up`×4 `enter` pastes `3+3`).
- Implicit Ans: if the first key of a new entry is a binary operator (`add`, `sub`, `mul`, `div`, `pow`, `square`, `recip`, `sto`, `2nd`+`%`), `Ans` is inserted in front (GB p.7: `mul`,`3`,`enter` shows `Ans*3`). `neg` does not insert Ans [GB p.36: `neg`,`5`,`enter` with K].
- `enter` with an empty entry repeats the last entry [dev, confirm].
- Max entry length: [open].

## 6. Evaluation order (EOS) [GB p.8-9]

From highest to lowest:
1. Expressions in parentheses.
2. Prefix functions that need `)`: sin, cos, tan, their inverses and hyperbolics, log, ln, 10ˣ, eˣ (in Classic), √( and the R▸P functions, randint(.
3. Fractions (`n/d`).
4. Postfix functions: x², x⁻¹, !, %, angle marks ° ' " ʳ ᵍ.
5. Powers `^` and nth roots `ˣ√`. **Classic evaluates `^` left to right** (`2^3^2` = 64); **MathPrint right to left** (`2^{3^{2}}` = 512). x² and x⁻¹ are left to right in both (`3²²` = 81).
6. Negation `(−)`.
7. nPr, nCr.
8. Multiplication, implied multiplication, division (left to right).
9. Addition, subtraction.
10. Conversions: `▸n/d◂▸Un/d`, `▸F◂▸D`, `▸DMS`.
11. `enter` closes all open parentheses and evaluates.

Consequences:
- Negation is below powers: `neg`,`2`,`square` = ⁻4 [dev, follows from order]; `⁻2^{2}` = ⁻4.
- Implied multiplication has the same priority as `*`: `4(2+3)` = 20 (GB p.9). `2π`, `3x`, `2√{2}`, `(2)(3)` are implied products.
- Missing `)` at the end is fine (enter closes them).
- `60+5*⁻12` = 0 (GB p.9). `1+⁻8+12` = 5 (GB p.9).

## 7. Numbers: precision, rounding and formats

### 7.1 Precision [GB p.17, p.21]
- Internal: 13 significant digits. π is stored as 3.141592653590 (GB p.17).
- Display: up to 10 significant digits plus sign and decimal point, rounded half away from zero (π shows 3.141592654).
- Evidence of 13-digit internal values: toggling the decimal 0.785398163 pastes `0.7853981633975` (13 digits) into the entry (GB p.21). `12°31'45"+26°54'38"` then ▸DMS pastes `39.43972222221` (13 digits, last digit off by one from rounding of the parts) (GB p.19).
- Range: magnitudes up to 9.999999999×10⁹⁹; beyond that `OVERFLOW`. Results smaller than 1×10⁻⁹⁹ become 0 [dev].

### 7.2 Decimal notation: FLOAT and FIX [GB p.3]
- FLOAT shows up to 10 digits **counting a leading zero**; trailing zeros are removed; no trailing decimal point. So |x| ≥ 1 rounds to 10 significant digits (`1.414213562`, `76.20321058`), and |x| < 1 rounds to 9 decimal places (`0.785398163`, `0.963411717`, `0.000093165`, GB p.21, p.28, p.30). Consequence: 2/3 shows `0.666666667`, log(2) shows `0.301029996`.
- FIX n (n = 0…9) always shows n digits after the point (`2π` → `6.28` with FIX 2, GB p.4). `FIX` indicator on. FIX does not change stored values.
- A leading zero is shown for |x| < 1 (`0.125`, `0.625`).
- Small numbers: `rand` shows `0.000093165` in FLOAT (GB p.30), so FLOAT does not switch to scientific at 0.001. The exact switch rule (when a FLOAT result goes to `*10^{n}`) is [open]; the working rule is: show normal notation if the value can be written with at most 10 significant digits and at most 10 digit positions in total; otherwise show scientific.
- Integers with more than 10 digits show in scientific notation [dev].

### 7.3 Numeric notation: NORM, SCI, ENG [GB p.3, p.11-12]
- SCI: one digit before the point, `*10` and exponent: MathPrint `1.2345*10^{4}`, Classic `1.2345*10^4` (GB p.3). Mantissa up to 10 digits, trailing zeros removed in FLOAT.
- ENG: mantissa 1 ≤ |m| < 1000, exponent multiple of 3: `196*10^{3}`, `29.4*10^{6}` (GB p.11-12).
- Notation only changes the result display, not the stored value.
- Restricted screens (data editor, table, recall menu) use `ᴇ` instead: `x=196ᴇ3`, `z=0ᴇ0` in ENG (GB p.11).

### 7.4 MathPrint exact results [GB p.3-4, p.7, p.16-17, p.21-22]
In MathPrint mode a result is shown in exact form when the calculator can find one, and the `toggle` key switches to the decimal:
- Rational results from exact input (integers, fractions, integer powers) show as **improper fractions in lowest terms**: `10^{⁻2}` → `\f{1}{100}`, `2^{⁻1}` → `\f{1}{2}`, `5*cos(60)` → `\f{5}{2}` (GB p.16, 17, 21).
- Integer square roots simplify: `√{8}` → `2√{2}`; `√{3^{2}+7^{2}}` → `√{58}`; `5*cos(\f{π}{4})` in RAD → `\f{5√{2}}{2}` (GB p.7, 21-22).
- Rational multiples of π: `2*π` → `2π`, `π*12^{2}` → `144π` (GB p.17).
- Trig of special angles gives exact values: `sin(30)` → `\f{1}{2}` in DEG; `tan(45)` → `1` (GB p.19, 21).
- Any decimal point in the input makes the result decimal: `\f{1.2+1.3}{4}` → `0.625` (GB p.14).
- Results that have no simple exact form are decimal: `ln(5)*2` → `3.218875825`, `tan⁻¹(1)` in RAD → `0.785398163` (GB p.21, 23).
- Size limits for exact forms (largest numerator/denominator/radicand shown) are [open]. Working assumption from the reference calculator family: a fraction result is shown when its denominator is at most 999 (otherwise decimal) [dev].
- In **Classic** mode, results are decimal except when the input used the `frac` key (then fraction `n⁄d`) [dev; GB p.3 shows Classic `1⁄8` → `1⁄8`, and Classic FIX `2π` → `6.28`].

### 7.5 Answer toggle `toggle` [GB p.7, p.17, p.21-22]
- After a result is shown, `toggle` adds a new history item: the previous result as the entry followed by `◂▸`, and the other form as the result.
  - `\f{1}{8}` → entry `\f{1}{8}◂▸`, result `0.125` (GB p.3).
  - `2√{2}` → `2√{2}◂▸`, `2.828427125` (GB p.7).
  - `2π` → `2π◂▸`, `6.283185307` (GB p.17).
  - decimal `0.785398163` → entry shows the full stored value `0.7853981633975◂▸`, result `\f{π}{4}` (GB p.21). So toggle also converts decimals back to exact forms when it can.
- `2nd`,`table` (f◂▸d) is the explicit conversion operator `▸F◂▸D` (§8).

## 8. Fractions [GB p.13-14]

MathPrint:
- `frac` before a number starts an empty stacked template: type the numerator, `down`, the denominator, `right` to leave (GB p.14).
- A number typed before `frac` becomes the numerator; the cursor moves to the denominator.
- Numerator/denominator may contain operators and functions (MathPrint only), e.g. `\f{1.2+1.3}{4}`.
- `2nd`,`frac` (U n/d) after a whole number starts a mixed number: unit, then numerator, `down`, denominator (GB p.14).
- Results: improper fractions in lowest terms by default; `4\f{5}{9}` → `\f{41}{9}` (GB p.4).
- `2nd`,`x10n` appends `▸n/d◂▸Un/d`: `\f{9}{2}▸n/d◂▸Un/d` → `4\f{1}{2}` (GB p.14).
- `2nd`,`table` appends `▸F◂▸D`: `4\f{1}{2}▸F◂▸D` → `4.5` (GB p.14). On a decimal it gives a fraction (`0.25▸F◂▸D` → `\f{1}{4}`) [dev].
- Max nesting: four levels of MathPrint templates (GB p.1).

Classic:
- `frac` between numerator and denominator: `3⁄4`. Mixed: `1␣7⁄12`. Fractions may not contain operators (use `÷`).
- `3⁄4+1␣7⁄12` → `7⁄3` (GB p.13). `9⁄2▸n/d◂▸Un/d` → `4␣1⁄2`. `4␣1⁄2▸F◂▸D` → `4.5` (GB p.14).

## 9. Powers, roots, π, logs, exponentials [GB p.16-17, p.23]

| keys | MathPrint entry | Classic entry | result |
|---|---|---|---|
| `5`,`pow`,`2`,`right`,`add`,`4`,`pow`,`lparen`,`2`,`add`,`1`,`rparen`,`enter` | `5^{2}+4^{(2+1)}` | `5^2+4^(2+1)` | `89` |
| `1`,`0`,`pow`,`neg`,`2`,`enter` | `10^{⁻2}` | `10^⁻2` | `\f{1}{100}` (MathPrint), Classic `0.01` [dev] |
| `2nd`,`square`,`4`,`9`,`enter` | `√{49}` | `√(49)` | `7` |
| `6`,`2nd`,`pow`,`6`,`4`,`enter` | `\r{6}{64}` | `6ˣ√64` | `2` |
| `2`,`recip`,`enter` | `2^{⁻1}` | `2⁻¹` | `\f{1}{2}` / Classic `0.5` [dev] |
| `log`,`1`,`rparen`,`enter` | `log(1)` | `log(1)` | `0` |
| `ln`,`5`,`rparen`,`mul`,`2`,`enter` | `ln(5)*2` | same | `3.218875825` |
| `2nd`,`log`,`log`,`2`,`rparen`,`enter` | `10^{log(2)}` | `10^(log(2))` | `2` |
| `2nd`,`ln`,`.`,`5`,`enter` | `e^{.5}` | `e^(.5)` | `1.648721271` |

- `^` in MathPrint opens a superscript; `right` leaves it. In Classic `^` is a plain operator; an exponent expression needs parentheses (GB p.16).
- `square` appends `²` (Classic) / `^{2}` (MathPrint). `recip` appends `⁻¹` / `^{⁻1}`.
- `2nd`,`square` (√): MathPrint opens a root template, leave with `right`; Classic inserts `√(`.
- `2nd`,`pow` (ˣ√): uses the number typed before as the index; MathPrint `\r{n}{…}`; Classic `nˣ√`.
- `2nd`,`log` (10ˣ) and `2nd`,`ln` (eˣ): MathPrint opens `10^{}` / `e^{}`; Classic inserts `10^(` / `e^(`.
- `log(` and `ln(` insert the function name with an open parenthesis.
- e is 2.718281828459 (GB p.23).

## 10. Angles and trigonometry [GB p.18-23]

- Angle mode (mode screen row 1) sets how plain angles are read and how results of inverse trig are shown: `sin(30)` → `\f{1}{2}` in DEG.
- `2nd`,`prb` (angle) shows two tabs: `«DMS» R◂▸P`. DMS items: `1:°` `2:'` `3:"` `4:ʳ` `5:ᵍ` `6:▸DMS`. R◂▸P items: `1:R▸Pr(` `2:R▸Pθ(` `3:P▸Rx(` `4:P▸Ry(` (GB p.5). Picking an item pastes it at the cursor. The menu shows 3 items at a time with `↓` in the last visible item number.
- Angle marks override the mode for one value: in RAD `sin(30°)` → `\f{1}{2}`; in DEG `2πʳ` → `360`; in DEG `sin(\f{π}{6}ʳ)` → `\f{1}{2}` (GB p.18-20).
- `▸DMS` converts a decimal angle to degrees-minutes-seconds: `1.5▸DMS` → `1°30'0"` (GB p.18). Seconds are rounded to whole numbers on display [GB p.19 shows `39°26'23"`].
- DMS entry: `12°31'45"+26°54'38"` → `39.44` with FIX 2 (GB p.19).
- R▸P: `P▸Rx(5,30)` → `4.3`, `P▸Ry(5,30)` → `2.5`, `R▸Pr(3,4)` → `5.0`, `R▸Pθ(3,4)` → `53.1` with FIX 1, DEG (GB p.20). The comma is `2nd`,`.`.
- `tan⁻¹(1)` → `45` in DEG; in RAD `0.785398163` (toggle → `\f{π}{4}`) (GB p.21).
- Hyperbolics: `2nd`,`pi` sets HYP; next `sin`/`cos`/`tan` (or their 2nd inverses) gives sinh( etc. Angle mode does not apply. `sinh(5)+2` → `76.20321058`; `sinh⁻¹(5)+2` → `4.312438341` (GB p.23).
- GRAD: 100ᵍ = 90°. `sin(100)` in GRAD → `1` [dev].
- DOMAIN errors: `tan(90)` in DEG and equivalents; `sin⁻¹`/`cos⁻¹` of |x|>1 (GB p.37).

## 11. ×10ⁿ key [GB p.3, p.15-16]

- `x10n` inserts the scientific-entry template: MathPrint shows `*10^{}` with the cursor in the exponent (`2*10^{3}`); Classic shows `*10^` [dev; GB p.16 shows `(2*10^{3})÷(4*10^{5})`].
- It is a shortcut for entering numbers; the result uses the current notation mode: in NORM, `(2*10^{3})÷(4*10^{5})` → `\f{1}{200}` in MathPrint [dev], in SCI → `5*10^{⁻3}` (GB p.16).
- Inside a fraction, use parentheses or the template for correct order (GB p.15).

## 12. Percent [GB p.14-15]

- `2nd`,`lparen` (%) appends `%` = divide by 100: `2%*150` → `3`; `3%*5000` → `150`; `Ans+2.3%*7300` → `317.9`.
- `2nd`,`rparen` (▸%) appends `▸%` (convert to percent): `\f{1}{5}▸%` → `20%`.

## 13. Variables, store, recall, clear [GB p.10-12]

- Seven variables `x y z t a b c`, initially 0 after reset.
- `var` inserts `x`. Pressing `var` again right away replaces it with the next name: x → y → z → t → a → b → c → x [GB p.10].
- `sto` appends `→` (with implicit Ans if the entry is empty: `Ans→y`, GB p.11). Then `var` (once or more) picks the variable; `enter` stores and shows the value as the result: `15→x` / `15`.
- A variable in an expression uses its value: after `15→x`, `x^{2}`… GB p.11 shows `15^{2}` because the example pastes from history; `y`,`enter` → `225`.
- `2nd`,`sto` (recall) shows `«Recall Var»` with `«1:»x=15`, `2:y=0`, `3↓z=0` (values in the current notation, `ᴇ` form in SCI/ENG). Choosing an item pastes the **value** (not the name) into the entry: `150*196000` (GB p.12).
- `2nd`,`var` (clear var) shows `«Clear Var»`, `«1:»Yes`, `2:No`; `1` clears all seven (GB p.10).
- `sto`→`rand` (from prb RAND menu) seeds the random generator: `5→rand` → `5` (GB p.30).

## 14. Probability `prb` [GB p.29-31]

- `prb` shows tabs `«PRB» RAND`. PRB: `1:nPr` `2:nCr` `3:!`. RAND: `1:rand` `2:randint(`. `right` switches tabs. A number key picks the item.
- nPr / nCr are infix and shown with spaces: `8 nPr 3` → `336`; `52 nCr 5` → `2598960` (result on next row); `25 nCr 3` → `2300`.
- `!` is postfix: `4!` → `24`. Valid 0…69 integers; else DOMAIN.
- `rand` returns a value in (0,1), shown with the normal FLOAT rule. After the seed `5→rand`, the first `rand` is `0.000093165` on the device (GB p.30). **Determinism**: storing a seed makes the sequence repeatable (GB p.29); whether reset also sets a fixed seed is [open]. Ponder must reproduce the device generator only if the differential check shows the reference matches the guidebook sequence. If it does not, the two seeded vectors (`prb-seededRand`, `prb-seededRandint`) are replaced by format-only checks. Unseeded `rand` is not in the vectors.
- `randint(3,5)` returns an integer 3…5 (GB p.30 shows 5).

## 15. Data editor and list formulas `data` [GB p.32-33]

- `data` opens the list editor: three columns `L1 L2 L3`, column labels in the indicator row, three data rows visible, and an edit line at the bottom like `L1(1)=`.
- Type a value and press `down` or `enter` to store it and move down. `left`/`right` change columns. `2nd`,`up`/`down` jump to top/bottom. Each list holds up to 42 items. Empty slots show `------`.
- Numbers are shown in up to 6 characters in the column; full value on the edit line [dev].
- `data` again inside the editor shows tabs `«CLEAR» FORMULA`. CLEAR: `1:Clear L1` `2:Clear L2` `3:Clear L3` `4:Clear ALL`. FORMULA: `1:Add/Edit Frmla` `2:Clear L1 Frmla` `3:Clear L2 Frmla` `4:Clear L3 Frmla` `5:Clear ALL`.
- Add/Edit Frmla on a column shows the edit line `♦L2=` [GB shows a diamond-like mark before the list name; encode as `♦`]. Inside, `data` shows `Ls` menu `1:L1 2:L2 3:L3` to paste a list name. `enter` computes the column; formula columns show their label highlighted (GB p.32-33).
- `9÷5*L1+32` with L1 = {8, ⁻1, 4} gives L2 = {46.4, 30.2, 39.2} (GB p.33).

## 16. Statistics `2nd`,`data` (stat) [GB p.23-29]

- Menu `«STATS»`: `1:1-Var Stats`, `2:2-Var Stats`, and `3:StatVars` once stats have been calculated.
- 1-Var setup screen: `1-VAR STATS` / `DATA: L1 L2 L3` / `FRQ: ONE L1 L2 L3` / `CALC` (current choices highlighted). `down`,`down` then `enter` on CALC, or move to CALC.
- 2-Var setup: `2-VAR STATS` / `xDATA: L1 L2 L3` / `yDATA: L1 L2 L3` / `CALC`.
- Result screen: title in inverse (`«1-Var:L1,One»`, `«2-Var:L1,L2»`) and a scrolling list of `n:name=value`.
  - 1-Var items: `1:n` `2:x̄` `3:Sx` `4:σx` `5:Σx` `6:Σx²` `7:minX` `8:Q1` `9:Med` `A:Q3` `B:maxX` [dev, order from reference calculator family; GB p.24 lists the set].
  - 2-Var items: `1:n` `2:x̄` `3:Sx` `4:σx` `5:ȳ` `6:Sy` `7:σy` `8:Σx` `9:Σx²` `A:Σy` `B:Σy²` `C:Σxy` `D:a` `E:b` `F:r` `G:x'` `H:y'` `I:minX` `J:maxX` `K:minY` `L:maxY` [GB p.28 confirms C…I; rest dev].
- Picking an item pastes the stat variable into the Home entry (`x̄` → `52.5`, GB p.25). `x'` and `y'` take an argument: `x'(45)` → `15`, `y'(55)` → `18.58651222`.
- Non-integer frequencies are allowed; `Sx=Error` is shown for them (GB p.24, p.27).
- Example values: L1 = {45,55,55,55}: n=4, x̄=52.5, Sx=5. 2-Var L1={33,49,65,79}, L2={5.3,14.45,20.21,38.45}: n=4, x̄=56.5, Sx=19.89137166, Σxy=5234.15, a=0.6773251896 (shown `0.677325190` in the menu), b=⁻18.66637321, r=0.963411717.
- Errors: `STAT` with no data or unequal lists; `DIVIDE BY 0` for n=1 (GB p.37).

## 17. Function table `table` [GB p.33-35]

- `table` shows `y=` and an entry for f(x) (use `var` for x). One level of fractions allowed.
- `enter` goes to setup: `Start=0`, `Step=1`, `«Auto» Ask-x`, `OK` (right-aligned). Edit with digits and `clear`, move with `down`, choose Auto/Ask-x with `left`/`right`+`enter`, then `enter` on OK.
- Auto: table screen with header `x` and `y` columns, three rows, the selected x highlighted, bottom line `x=15` (GB p.34).
- Ask-x: empty table; type x values, `enter`, y appears (GB p.35).
- Step 0 is not allowed [GB p.34]. Invalid function: `INVALID FUNCTION` (GB p.38).

## 18. Constant `2nd`,`div` (K) [GB p.35-36]

- Opens `K=` and an entry (up to 44 characters). `enter` saves it; `K` indicator on.
- While K is on, each `enter` appends the stored operation to the current entry (or Ans if empty): `4`,`enter` → `4*2+3` / `11`.
- `2nd`,`div` again turns K off (`K` indicator off). Reset clears K.

## 19. Mode screen `mode` [GB p.2-3]

Four rows; current choice in each row is highlighted, the cursor blinks on one choice:
```
«DEG» RAD GRAD
«NORM» SCI ENG
«FLOAT» 0123456789
CLASSIC «MATHPRINT»
```
- Arrows move; `enter` selects the choice under the cursor. `clear` or `2nd`,`mode` (quit) returns Home.
- Choosing a digit in row 3 sets FIX n; `FIX` indicator on. Choosing SCI/ENG lights `SCI`/`ENG`.
- Mode changes apply to new results; history keeps what it showed [dev].

## 20. Menus in general [GB p.4]

- Menu keys: `prb`, `2nd`+`prb`, `data` (in editor), `2nd`+`data`, `2nd`+`0`, `2nd`+`sto`, `2nd`+`var`.
- First row: the title or the tabs; the active tab is inverse. Items below; the selected item number is inverse.
- `down`/`up` move, `left`/`right` switch tabs, a digit/letter picks directly, `enter` picks the selected one, `clear` goes back without choosing, `2nd`,`mode` (quit) goes Home.
- Only 3 items fit under the title; a `↓` replaces the `:` of the last visible item when more follow, `↑` replaces the `:` of the first when items are above.

## 21. Errors [GB p.37-38]

On an error the calculator shows the error screen; `clear` returns to the entry with the cursor at the error. Message texts (exact strings, encoded in `lines` as shown on screen; the exact screen layout is [open], the working assumption is the message text alone on the first row, large font like `MEMORY CLEARED`):

| message | trigger |
|---|---|
| `ARGUMENT` | wrong number of arguments (e.g. `randint(3)`) |
| `DIVIDE BY 0` | division by zero; in stats when n = 1 |
| `DOMAIN` | argument out of range: ˣ√ with x = 0, or y < 0 and x not odd integer; `^` with 0^0 or negative base and non-integer exponent; √ of negative; log/ln of x ≤ 0; tan(90°) and equivalents; sin⁻¹/cos⁻¹ of |x| > 1; nPr/nCr with non-integers or negatives; x! outside 0…69 integers |
| `EQUATION LENGTH ERROR` | entry over the digit limit (80 in stat, 47 in constant) |
| `FRQ DOMAIN` | frequency < 0 or > 99 in 1-Var |
| `OVERFLOW` | result or entry beyond ±9.999999999×10⁹⁹ |
| `STAT` | stats with no data, or 2-Var with unequal lists |
| `DIM MISMATCH` | formula with lists of different length |
| `FORMULA` | formula without a list name or referencing its own list |
| `SYNTAX` | misplaced operator/function/parenthesis/comma; more than 23 pending operations or 8 pending values |
| `INVALID FUNCTION` | bad function in the table |
| `MEMORY LIMIT` | more than 23 pending operations; or over 4 nesting levels with K |
| `LOW BATTERY` | not simulated in Ponder |

## 22. MathPrint vs Classic summary [GB p.2-4]

| | MathPrint (default) | Classic |
|---|---|---|
| fractions | stacked `\f{n}{d}`, may contain expressions | `n⁄d`, numbers only |
| powers | superscript, right-to-left | `^`, left-to-right |
| √ | radical with bar | `√(` |
| nth root | `\r{n}{x}` | `nˣ√x` |
| exact results | fractions, √, π forms | decimal (fractions only from `frac` input) |
| sci results | `*10^{n}` | `*10^n` |

## 23. Open items (must be observed on the reference)

1. Exact switch rule FLOAT → scientific for large and small results.
2. Size limits for exact fraction / radical / π results in MathPrint.
3. Classic mode: is `1÷2` shown as `0.5` and `10^⁻2` as `0.01`?
4. Error screen layout (font size, rows, any second line).
5. `↑`/`↓` indicator exact rule; whether `DEG` always shows.
6. Overwrite vs insert when typing in the middle of an entry; delete at end of entry.
7. `enter` on an empty entry.
8. Maximum entry length.
9. rand sequence after reset (seed).
10. Whether `MEMORY CLEARED` needs a key press to dismiss, and which keys.
11. Data editor column formatting (width, rounding) and stat item order beyond GB.
12. The initial state of the reference page (screenshot shows `MEMORY CLEARED` with `RAD`, which contradicts reset → DEG; maybe the saved state file differs).
13. Whether the reference persists state between page loads (localStorage).
14. Glyph advance widths of the proportional font, and the exact same-row/next-row rule for results.
15. Mode screen: where the cursor lands when moving down a row (first choice or current choice). The `classic` setup prefix assumes the first choice.
16. Stat menus keep a trailing zero after rounding to fit (`a=0.677325190`, GB p.28) while the Home screen strips trailing zeros; confirm.
