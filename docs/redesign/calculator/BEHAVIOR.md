# Calculator behavior spec (GED test layout)

Source of truth for the builder of `src/features/calculator/`. Written clean-room: from observing the reference emulator as a black box (keys clicked, LCD pixels read) and from TI's public *reference calculator guidebook* (2019 edition, cited as **GB p.N**). No code, artwork or font data from the reference is used or described here.

## Changes (differential check)

The running build was compared with the running reference: all vectors plus 200 random key sequences (`scripts/calc-diff.ts`). New rules found there, each backed by new verified vectors (645 in total):

- **Two vectors were misread in the verification pass and are corrected:** `frac-mpReciprocalFraction` is `\f{3}{5}^{⁻1}\t\f{5}{3}` and `pow-recipRecip` is `(4^{⁻1})^{⁻1}\t4`. There is no separate `⁻` row; drop the special case built for it (QUESTIONS Q13 "raised minus sign").
- **Scrolling reserves the cursor cell** (§3.2): 15 digits fit (`123456789012345`), 16 scroll to `◂34567890123456`.
- **A history row too long for the screen is cut at the 16th cell, also inside a superscript** (§3.2): `(ans^{2})^{3+252*tan}▸`.
- **`toggle` inside an entry inserts a `◂▸` token** (§7.5): `4◂▸2` → SYNTAX; `log(37π)◂▸` → `2.065351597`; on an empty line it shows `◂▸`.
- **`delete` that empties a superscript removes the template**; typing continues on the baseline (§5): `2 pow 6 delete 8` → `28`.
- **`clear` with the cursor in a template removes that template only**, not the whole entry (§5): `4 pow 5 clear 9` → `49`.
- **Errors are reported in evaluation order** (§21): the first failing operation from the left wins, even when a syntax error comes later (`ans^{⁻1}7÷4*+` → DOMAIN, `2÷0-1+` → DIVIDE BY 0, `1++2÷0` → SYNTAX).
- An empty superscript template is written `^{}` (like `\f{}{}`).

## Changes (verification pass)

The first version of this file was written without access to the reference. It has now been checked against it, and every vector in `vectors.json` carries the reference's actual screen. File names, the key-name vocabulary (§1) and the general text encoding (§2) are unchanged. What changed:

- **Display text** (§2):
  - Ans is shown in lowercase: `ans` (was `Ans`), e.g. `ans*3`.
  - The fraction/decimal conversion operator is `▸F◂▸d` (lowercase d; was `▸F◂▸D`).
  - Error screens are three rows: `["", "DIVIDE BY 0", "Error"]` (was the message alone).
  - `MEMORY CLEARED` is on the second row: `["", "MEMORY CLEARED"]`.
  - Rows partly scrolled off the top are left out; a row whose own glyphs are fully visible is kept even if its superscript is cut off (§2.3).
  - Text overflowing a row starts with `◂` or ends with `▸` (§3.2).
  - New encodings for screens in the small font (setup screens, mode screen) and for the grid screens (data editor, table) (§2.4).
- **Indicators** (§3.3): the order is by screen position: `2ND HYP FIX K SCI|ENG DEG|GRAD|RAD ↑ ↓`; `L1 L2 L3` come first in the data editor. After a calculation **both `↑` and `↓` are lit**; rules in §3.3.
- **LCD font** (§3.1): monospaced 6-dot cells (not proportional as first guessed). Three fonts: normal 5×7, small 5×5 (superscripts, stacked fractions) and a 4×5 menu font.
- **Division** (§7.4): `÷` gives a **decimal** result in MathPrint (`7÷2` → `3.5`, `1÷3` → `0.333333333`, `π÷2` → `1.570796327`). Only the `n/d` template, negative integer powers, `x⁻¹`, `%` of integers and exact trig values give fractions.
- **Number format** (§7.2): FLOAT shows 10 digits counting the leading zero (`0.333333333`, confirmed). FLOAT switches to scientific below 1×10⁻⁹ and at 1×10¹⁰ and above. FIX 0 shows no decimal point (`3`).
- **Stacked powers** (§9): repeated `x²` / `x⁻¹` are shown with automatic parentheses: `(3^{2})^{2}`, `(4^{⁻1})^{⁻1}`.
- **Errors** (§21): `0` `x⁻¹` gives DOMAIN; `70!` gives OVERFLOW.
- **Editing** (§5): typing inside an entry overwrites; `2nd`,`delete` inserts. `delete` at the end removes the last character. `enter` on an empty line repeats the last entry.
- **Conversions on an empty line** (§7.5, §8): `▸DMS`, `▸F◂▸d`, `▸n/d◂▸Un/d` and `▸%` paste the previous answer's value (`0▸DMS`, `\f{7}{4}▸n/d◂▸Un/d`), not `ans`. `x10n` on an empty line inserts `ans*10^{}`.
- **Statistics** (§16): when stats are run from the data editor, picking a result variable returns to the editor and stores the value in the current cell. The 1-Var title shows the frequency `1` as `«1-Var:L1,1»`. Menu values show 10 significant digits (`a=0.6773251896`).
- **rand** (§14): a reset does not fix the sequence (two runs gave `0.695325634` and `0.881655349`); only a stored seed (`5→rand`) makes it repeatable. Unseeded rand is not in the vectors.
- **Power keys:** `2nd`,`on` / `on` behaved erratically under automation on the reference; those two vectors were removed and power is not specified beyond §4.
- **Reference start state** (§4): the reference page loads in RAD with `MEMORY CLEARED` on screen; a reset brings DEG back.
- **Pressed key** (UI-SPEC §6): the reference fills a pressed key red.

## 0. Status

All 645 vectors (578 from the first draft, 47 probes from the verification pass, 20 from the differential check) in `vectors.json` were run on the reference (each one from a page reload plus a device reset) and read back pixel by pixel. Vectors whose result differed from the first draft were captured at least twice more and kept only where the runs agreed (three were flaky in the first run and fixed by the re-runs). Tags:
- **[ref]**: observed on the reference.
- **[GB]**: from the guidebook; where it disagrees with the reference, the reference wins.

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
| `sub` | − | — (2nd: display contrast down on the device) | row 4, col 5 |
| `var` | x with y z t / a b c | clear var | row 5, col 1 |
| `4` `5` `6` | digits | — | row 5, cols 2-4 |
| `add` | + | — (2nd: display contrast up on the device) | row 5, col 5 |
| `sto` | sto→ | recall | row 6, col 1 |
| `1` `2` `3` | digits | — | row 6, cols 2-4 |
| `toggle` | ◂▸ (answer toggle) | — | row 6, col 5 |
| `on` | on | off | row 7, col 1 |
| `0` | 0 | reset | row 7, col 2 |
| `.` | . | , (comma) | row 7, col 3 |
| `neg` | (−) | ans | row 7, col 4 |
| `enter` | enter | — | row 7, col 5 |

45 physical keys (the arrow pad counts as four).

Notes:
- `2nd` latches for exactly one key press; pressing it twice cancels it. While latched, `2ND` is lit [ref].
- `2nd`,`pi` (hyp) latches HYP for the next trig key; `HYP` is lit [ref]. `2nd`,`pi`,`2nd`,`sin` gives `sinh⁻¹(` [ref].
- Physical keyboard mapping for Ponder (not part of the device): digits, `.`, `+ - * / ^ ( )`, Enter = `enter`, Backspace = `delete`, arrows = arrow pad, Escape = `clear`.

## 2. Display-text encoding (the test hook format)

The builder exposes the current screen as text through a test hook. The differential check reads the reference screen and writes the same encoding, so both sides compare string for string.

`expect` has:
- `lines`: the visible text rows of the LCD below the indicator band, **top to bottom**. Trailing empty rows are omitted. Empty rows above or between text rows are `""` where the screen has a fixed row grid (messages, errors, setup screens).
- `indicators`: the lit items of the indicator band, left to right (§3.3).

### 2.1 Rows
- Left-aligned text, then a TAB (`\t`), then right-aligned text. A row with only a right-aligned result starts with `\t`. A row with only left text has no TAB.
- A result that fills the whole row under its entry is still written with a leading `\t`.
- The cursor is not encoded (it blinks). Inverse-video text is wrapped in `«` `»`.
- One space per empty character cell between words (`8 nPr 3`, `«DMS» R◂▸P`).

### 2.2 Characters

| on screen | text |
|---|---|
| multiplication | `*` |
| division | `÷` |
| subtraction | `-` (U+002D) |
| negation sign and negative results | `⁻` (U+207B) |
| store arrow | `→` |
| answer toggle mark | `◂▸` |
| conversion arrow | `▸` (`▸DMS`, `▸%`, `▸F◂▸d`, `▸n/d◂▸Un/d`) |
| previous answer | `ans` |
| degree / minute / second | `°` `'` `"` |
| radian / gradian marks | `ʳ` `ᵍ` |
| pi, root | `π`, `√` |
| Classic nth root, square, inverse | `ˣ√`, `²`, `⁻¹` |
| Classic power | `^` |
| Classic fraction bar, mixed separator | `⁄` (U+2044), `␣` (U+2423) |
| scientific result | `*10` + exponent: MathPrint `1.2345*10^{4}`, Classic `1.2345*10^4` |
| exponent mark in the recall menu (SCI/ENG) | `ᴇ` (`196ᴇ3`) |
| row overflow marks | `◂` first character, `▸` last character |
| menu more-below / more-above | `↓` `↑` in place of the item's `:` |
| statistics | `x̄` `ȳ` `σ` `Σ` |
| variables, lists | `x y z t a b c`, `L1 L2 L3` |

MathPrint 2-D objects:

| object | text |
|---|---|
| stacked fraction | `\f{num}{den}` |
| mixed number | whole number then fraction: `4\f{1}{2}` |
| superscript | `^{…}` (nested: `2^{3^{2}}`) |
| square root | `√{…}` |
| nth root | `\r{index}{radicand}` |
| exact root / pi results | `2√{2}`, `\f{5√{2}}{2}`, `144π`, `\f{π}{4}` |
| empty template box | nothing: `\f{}{}` |

### 2.3 Scrolled history
The Home screen scrolls by dot rows, so the top row can be cut. A row is written only if its own text cells are fully on screen; a stacked fraction counts as visible only if its numerator is. Pieces of a row that are cut off (for example the superscript of `15^{2}` when only `15` and `225` are visible) are left out: that row is written `15\t225`.

### 2.4 Special screens
- **Error / message screens:** `["", "DIVIDE BY 0", "Error"]`, `["", "MEMORY CLEARED"]`. Text centered on the device; the encoding has no alignment.
- **Mode screen:** four rows exactly as `«DEG» RAD GRAD`, `«NORM» SCI ENG`, `«FLOAT» 0123456789` (with FIX n: `FLOAT 01«2»3456789`), `CLASSIC «MATHPRINT»`.
- **Small-font setup screens** (stat setup, ...): six-dot rows; an empty row is `""`. Example: `["1-VAR STATS", "DATA: «L1» L2 L3", "FRQ: «ONE» L1 L2 L3", "", "CALC"]`.
- **Data editor:** one row per visible list row, cells joined by `|` (`L1|L2|L3`), empty cell `""`, empty slot placeholder `------`; then the edit line (`L1(5)=`, `«L2(1)=»46.4` when the list has a formula). The column titles are the indicators `L1 L2 L3`. Example: `["55||", "55||", "55||", "«------»||", "L1(5)="]`.
- **Function table:** header `x|y`, three rows `x|y`, then the edit line: `["x|y", "«15»|315", "18|324", "21|315", "x=15"]`.

## 3. Display layout [ref]

### 3.1 Dot matrix and fonts
- LCD canvas: 96 dots wide. Above the text area is an indicator band drawn in a tiny 3×5 font at half-dot resolution (UI-SPEC §3).
- Text area: 4 rows × 8 dots = 32 dot rows (plus 1-2 spare rows).
- **Normal font:** 5×7 glyphs in **monospaced 6×8 cells**, 16 cells per row, starting at dot column 1. Narrow glyphs (`.`, `1`, `'`, `°`, `(`) are drawn inside the same 6-dot cell, so spacing is always by whole cells.
- **Small font:** 5×5 glyphs at a 6-dot pitch. Used for superscripts (raised so their bottom is 2 dots below the top of the normal cell) and for numerator and denominator of stacked fractions. A superscript inside a small-font group is raised a further 2 dots.
- **Menu font:** 4×5 glyphs at a 5-dot pitch, 6-dot rows. Used on the mode screen, the stat setup screens and in the data editor / table grids.
- Stacked fraction: numerator (small font), one blank dot row, a 1-dot bar as wide as the wider part plus one dot each side, one blank row, denominator. The bar sits on the middle row (row 3) of the line's normal cell.
- Tall parentheses: around a superscript-height group 9 dots tall; around a stacked fraction 13 dots tall.
- Radical: a check stroke starting at the bottom-left and a 1-dot bar over the radicand.
- Inverse video: black box with the glyphs left unlit; normal-font boxes cover the 8-dot cell row (7 rows + the row below), menu-font boxes cover 6 rows.

### 3.2 Home screen layout
- History grows from the top. Each calculation shows the entry left-aligned and the result right-aligned.
- **Same row or next row:** a result shares the entry's row when entry cells + result cells ≤ 14 (at least two empty cells between them); otherwise it goes right-aligned on the next row. Cell counts: one per character; a stacked fraction counts as its wider part; a superscript counts its characters; `√{…}` counts 1 + its content; `\r{n}{…}` counts index + 1 + content; `◂▸` is one cell, `▸F◂▸d` four, `▸n/d◂▸Un/d` five. Two exceptions put the result on its own row even when it fits: a result that is a stacked fraction containing a radical (`sin(45)` / `\t\f{√{2}}{2}`), and an entry with a fraction nested in a fraction. This matches all 625 vectors.
- Rows that contain superscripts or fractions are taller; the screen scrolls by dot rows, so the top row may be cut (§2.3).
- An entry that does not fit scrolls horizontally. **The cursor cell at the end counts**: entry plus cursor may use 16 cells, so 15 digits still fit and 16 digits show `◂34567890123456`. The first or last cell then shows the overflow mark: `◂67890123456789` (cursor at the end), `123456789012345▸` (cursor at the start). History rows that are too long are cut at the 16th cell and end with `▸`, also inside a superscript: `sin(30)^{2}+cos(30▸`, `(ans^{2})^{3+252*tan}▸`.

### 3.3 Indicator band
Items and their left edge in canvas pixels (canvas 192 px = 96 dots wide):

| item | x | when lit |
|---|---|---|
| `L1` `L2` `L3` (boxed) | 0, 67, 137 | data editor |
| `2ND` | 8 | 2nd latched |
| `HYP` | 26 | hyp latched |
| `FIX` | 39 | FIX 0-9 |
| `K` | 50 | constant on |
| `SCI` / `ENG` | 76 / 96 | notation |
| `DEG` / `GRAD` / `RAD` | 146 / 154 / 159 | angle mode, always on the Home screen and in menus |
| `↑` | 176 | there is history above (or above the highlighted item) |
| `↓` | 182 | after a calculation while the entry line is empty; or when a highlighted history item has items below it |

Observed combinations: fresh screen: none; after `enter`: `↑ ↓`; typing a new entry: `↑`; after `clear` of the screen: `↑`; highlight on the newest result: `↑ ↓`; highlight on the oldest entry: `↓`; right after pasting a history item: `↑`; in menus: no arrows.

### 3.4 Cursor
- Overwrite cursor: a solid block that blinks (alternating with the character under it).
- Insert cursor (`2nd`,`delete`): an underline at the bottom of the cell.
- Inside MathPrint templates the cursor takes the size of the small font.

## 4. Power, reset and start state [ref]

- `on` turns the unit on; `2nd`,`on` turns it off (GB p.1: history, settings and memory are kept). Not verified on the reference (see Changes).
- **Reset**: `2nd`,`0` shows `«Reset»` / `«1:»No` / `2:Yes`. `2` resets: DEG, NORM, FLOAT, MATHPRINT, variables 0, lists empty, K off, Ans 0, history empty. The screen shows `["", "MEMORY CLEARED"]`; `clear` returns to an empty Home screen.
- The reference page itself loads a saved state: RAD mode with `MEMORY CLEARED` on screen. That is why every vector starts with a reset.
- **Vector start state**: page reload, then `2nd`,`0`,`2`, then `clear`, then the vector's mode prefix (`vectors.json` → `modes`), then `keys`. Expected text is read after the last key.

## 5. Entry and editing [ref]

- Typing at the end of the entry appends. With the cursor inside the entry, typing **overwrites** the character under the cursor (`1 2 3 left left 9` → `193`).
- `2nd`,`delete` switches to insert for the following characters (`1 2 3 left left 2nd delete 9` → `1923`); the cursor becomes an underline.
- `delete` deletes the character under the cursor; at the end of the entry it deletes the last character (`1 2 3 delete` → `12`). Deleting the last character of a superscript removes the template, and the next keys go on the baseline (`2 pow 6 delete 8` → `28`).
- A function token (`sin(`, `log(`, `ans`) is one element for the cursor and for `delete` (`sin(30) 2nd left delete` leaves `30)`, which is a SYNTAX error on `enter`).
- `left`/`right` move one element; `2nd`,`left` / `2nd`,`right` jump to the start/end. `left` at the start stays there.
- `clear`: with the cursor in a MathPrint template, removes only that template and its content (`4 pow 5 clear 9` → `49`; `)(4^{}`, `left`, `9`, `clear` → `)(49`); otherwise clears the entry line; on an empty entry line clears the screen (history still reachable with `up`); on an error screen returns to the entry with the cursor at the error; in a menu goes back.
- History: `up` from the empty entry line highlights the last **result**, the next `up` its **entry**, and so on upwards. The highlighted item is shown inverse (`2+2\t«4»`). `enter` pastes it at the cursor. Pasting into a started entry inserts at the cursor (`2*` + pasted `15` → `2*15`).
- **Implicit ans:** a first key that is a binary or postfix operator (`add sub mul div pow square recip sto`, `%`, angle marks, `nPr`, `nCr`, `!`) inserts `ans` first: `ans*3`, `ans→y`, `ans°`, `ans nPr`. `neg` does not.
- `enter` on an empty entry line repeats the last entry (`2+3 enter enter` → two rows `2+3\t5`). On a fresh screen it does nothing.

## 6. Evaluation order (EOS) [GB p.8-9, ref]

From highest to lowest:
1. Expressions in parentheses.
2. Prefix functions that need `)`: sin, cos, tan, inverses, hyperbolics, log, ln, 10ˣ, eˣ (Classic), √( (Classic), the R▸P functions, randint(.
3. Fractions (`n/d`).
4. Postfix functions: x², x⁻¹, !, %, angle marks.
5. Powers `^` and roots `ˣ√`. Classic left to right (`2^3^2` = 64), MathPrint right to left (`2^{3^{2}}` = 512).
6. Negation.
7. nPr, nCr.
8. Multiplication, implied multiplication, division (left to right; `6÷2(1+2)` = 9).
9. Addition, subtraction.
10. Conversions (`▸n/d◂▸Un/d`, `▸F◂▸d`, `▸DMS`).
11. `enter` closes open parentheses.

Examples [ref]: `60+5*⁻12` = 0, `⁻3^{2}` = ⁻9, `⁻3!` = ⁻6, `2*5 nCr 2` = 20, `5 nCr 2+1` = 11, `(2+3*4` = 14.

## 7. Numbers [ref]

### 7.1 Precision
- 13 significant digits inside; toggling a decimal pastes the 13-digit value (`3.142857142857◂▸`, `0.7853981633975◂▸`, `0.6666666666667◂▸`).
- Display rounds half up.

### 7.2 FLOAT and FIX
- FLOAT shows at most 10 digits **counting the leading zero**: |x| ≥ 1 → 10 significant digits (`1.414213562`, `666.6666667`); |x| < 1 → 9 decimals (`0.333333333`, `0.301029996`, `0.000666667`, `0.000000143`). Trailing zeros removed.
- FLOAT switches to scientific when |x| < 1×10⁻⁹ (`0.000000001` stays, `5*10^{⁻10}`) or |x| ≥ 1×10¹⁰ (`9999999999` stays, `12345678901` → `1.23456789*10^{10}`, `9999999999+1` → `1*10^{10}`). The mantissa has up to 10 significant digits, trailing zeros removed.
- FIX n shows exactly n decimals, half up: `1.005` → `1.01`, `3` → `3.00`, `0.004` → `0.00`. FIX 0 shows no point: `2.5` → `3`.
- FIX does not change exact results: `2π` stays `2π` in MathPrint (toggle → `6.28`); Classic `2π` → `6.28`.

### 7.3 SCI and ENG
- SCI: `5` → `5*10^{0}`, `0.5` → `5*10^{⁻1}`, `⁻2500` → `⁻2.5*10^{3}`, `1.0÷3` → `3.333333333*10^{⁻1}`. Exact forms stay (`π` → `π`).
- ENG: exponent a multiple of 3: `1234` → `1.234*10^{3}`, `0.05` → `50*10^{⁻3}`, `999` → `999*10^{0}`.
- Recall menu values use `ᴇ`: `196ᴇ3`, `0ᴇ0` (ENG).

### 7.4 MathPrint exact results
- **Division `÷` gives a decimal:** `7÷2` → `3.5`, `1÷3` → `0.333333333`, `22÷7` → `3.142857143`, `ans÷4` → `2.5`, `π÷2` → `1.570796327`.
- Exact rational results come from: the `n/d` template (`\f{1}{2}+\f{1}{3}` → `\f{5}{6}`, `\f{6}{3}` → `2`), negative integer powers and `x⁻¹` (`10^{⁻2}` → `\f{1}{100}`, `2^{⁻1}` → `\f{1}{2}`), and exact trig values (`sin(30)` → `\f{1}{2}`, `5*cos(60)` → `\f{5}{2}`).
- Roots simplify: `√{8}` → `2√{2}`, `√{2}*√{3}` → `√{6}`; `√{\f{1}{2}}` gives a decimal (`0.707106781`).
- Special angles: `sin(45)` → `\f{√{2}}{2}`, `tan(30)` → `\f{√{3}}{3}`, `tan(60)` → `√{3}`, `sin(⁻30)` → `⁻\f{1}{2}`; RAD `5*cos(\f{π}{4})` → `\f{5√{2}}{2}`, RAD `180°` → `π`.
- π multiples: `2*π` → `2π`, `π*12^{2}` → `144π`, but `π+1` and `π*1.5` are decimal.
- Any decimal point in the input gives a decimal result (`\f{1.2+1.3}{4}` → `0.625`, `sin(30.0)` → `0.5`).
- A negative fraction is written with the sign in front: `⁻\f{3}{4}`.
- In Classic, results are decimal unless the input used `n/d`: `1÷2` → `0.5`, `10^⁻2` → `0.01`, `1⁄8` → `1⁄8`.

### 7.5 Answer toggle `toggle`

- While an entry is being typed, `toggle` inserts a `◂▸` token at the cursor. At the end of a complete expression it makes `enter` show the other result form (`log(37π)◂▸` → `\t2.065351597`); anywhere else it is a SYNTAX error on `enter` (`4◂▸2`). On an empty line it shows `◂▸`, and a following `√{8}` is a SYNTAX error.
- Adds a history row: the previous result followed by `◂▸`, then the other form: `\f{1}{8}◂▸` / `0.125`; `2√{2}◂▸` / `2.828427125`; `2π◂▸` / `6.283185307`; a decimal toggles to its exact form with the 13-digit value shown: `3.142857142857◂▸` / `\f{22}{7}`, `0.7853981633975◂▸` / `\f{π}{4}`.
- On an empty line, the conversion keys paste the previous **value**: `2nd prb 6` → `0▸DMS`; after `\f{7}{4}`, `2nd x10n` → `\f{7}{4}▸n/d◂▸Un/d`.

## 8. Fractions [ref, GB p.13-14]

- MathPrint: `frac` before a number opens an empty template; a number typed first becomes the numerator; `down` moves to the denominator; `right` leaves the template. Numerator and denominator may contain expressions.
- `2nd`,`frac` after a whole number starts a mixed number: `1\f{1}{2}`.
- Results are improper fractions in lowest terms: `4\f{5}{9}` → `\f{41}{9}`.
- `▸n/d◂▸Un/d` converts both ways: `\f{9}{2}` → `4\f{1}{2}`, `3\f{1}{4}` → `\f{13}{4}`.
- `▸F◂▸d`: `4\f{1}{2}▸F◂▸d` → `4.5`, `0.25▸F◂▸d` → `\f{1}{4}`.
- A fraction result with a large denominator falls back to decimal: `\f{1}{999}+\f{1}{998}` → `0.002003005`.
- `sto` inside a template is a SYNTAX error (`1 frac 4 sto var enter` → SYNTAX).
- Classic: `3⁄4+1␣7⁄12` → `7⁄3`, `9⁄2▸n/d◂▸Un/d` → `4␣1⁄2`, `4␣1⁄2▸F◂▸d` → `4.5`.

## 9. Powers, roots, π, logs [ref]

- `pow` opens a superscript in MathPrint (leave with `right`); in Classic it is a `^` operator.
- `square` appends `^{2}` (Classic `²`), `recip` appends `^{⁻1}` (Classic `⁻¹`). Repeating them shows automatic parentheses: `(3^{2})^{2}`, `(4^{⁻1})^{⁻1}`.
- `2nd`,`square`: MathPrint radical template `√{…}`; Classic `√(`.
- `2nd`,`pow`: index from the number before: `\r{3}{64}`; Classic `3ˣ√64`.
- `2nd`,`log` / `2nd`,`ln`: MathPrint `10^{…}` / `e^{…}`; Classic `10^(` / `e^(`.
- `log(`, `ln(`: name with an open parenthesis; enter closes it (`log(1000` → `3`).
- Values: `log(2)` → `0.301029996`, `ln(10)` → `2.302585093`, `e^{1}` → `2.718281828`, `e^{.5}` → `1.648721271`.

## 10. Angles and trigonometry [ref]

- Angle menu `2nd`,`prb`: tabs `«DMS» R◂▸P`; DMS items `1:°` `2:'` `3:"` `4:ʳ` `5:ᵍ` `6:▸DMS`; R◂▸P items `1:R▸Pr(` `2:R▸Pθ(` `3:P▸Rx(` `4:P▸Ry(`. Three items visible; `↓`/`↑` replace the `:`.
- Marks override the mode: RAD `sin(30°)` → `\f{1}{2}`; DEG `2πʳ` → `360`; DEG `100ᵍ` → `90`; GRAD `90°` → `100`; RAD `180°` → `π`.
- `▸DMS`: `1.5▸DMS` → `1°30'0"`; DMS input `30°30'` → `30.5`.
- R▸P: `R▸Pr(3,4)` → `5`, `R▸Pθ(1,1)` → `45`; with FIX 1: `R▸Pr(3,4)` → `5.0`.
- Hyperbolics ignore the angle mode: `sinh(1)` → `1.175201194` in DEG and RAD.
- DOMAIN: `tan(90)`, `tan(270)`, `tan(⁻90)`, RAD `tan(\f{π}{2})`, GRAD `tan(100)`, `sin⁻¹(2)`, `cos⁻¹(⁻2)`.

## 11. ×10ⁿ key [ref]

- `x10n` inserts `*10^{}` (MathPrint, cursor in the exponent) or `*10^` (Classic). On an empty line it starts with `ans`.
- `2*10^{3}` → `2000`; `1.5*10^{⁻2}` → `0.015`; `5*10^{12}` → `5*10^{12}`.
- Keys typed while the exponent is open go into the exponent (`1*10^{⁻99÷10}`).

## 12. Percent [ref]

- `2nd`,`lparen` appends `%`: `2%*150` → `3`; `50%` → `0.5`; `200*15%` → `30`.
- `2nd`,`rparen` appends `▸%`: `\f{1}{5}▸%` → `20%`, `0.25▸%` → `25%`.

## 13. Variables [ref]

- `var` inserts `x`; further presses cycle `x y z t a b c x`.
- `sto` appends `→` (with `ans` when first); `var` picks the variable; `enter` stores: `15→x\t15`.
- `2nd`,`sto`: `«Recall Var»`, `«1:»x=15`, `2:y=0`, `3↓z=0`; scrolling shows `2↑y=0` ... `«4↓»t=0`. Picking pastes the **value**.
- `2nd`,`var`: `«Clear Var»`, `«1:»Yes`, `2:No`.
- `5→rand` seeds the generator.

## 14. Probability [ref]

- `prb`: tabs `«PRB» RAND`; `1:nPr` `2:nCr` `3:!`; RAND: `1:rand` `2:randint(`.
- `8 nPr 3` → `336`, `52 nCr 5` → `2598960` (next row), `4!` → `24`, `13!` → `6227020800`, `14!` → `8.71782912*10^{10}`.
- `rand` without a seed is not repeatable on the reference, even right after a reset. After `5→rand`: `rand` → `0.000093165`, then `randint(3,5)` → `5` (also GB p.30). Ponder needs the device generator only for those two seeded vectors (`prb-seededRand`, `prb-seededRandint`); otherwise list them as a known divergence. Use a value in (0,1) with the FLOAT format for unseeded rand.

## 15. Data editor `data` [ref]

- Three columns L1 L2 L3 with vertical rules, four visible rows, a rule, and the edit line `L1(n)=`. Column titles are the boxed indicators.
- Cells show up to 6 characters (`1.4142`, `18.587`); the edit line shows the full value.
- An empty slot shows `------`; the selected cell is inverse.
- `data` in the editor: `«CLEAR» FORMULA` (`1:Clear L1` … `4:Clear ALL`) and `CLEAR «FORMULA»` (`1:Add/Edit Frmla`, `2:Clear L1 Frmla`, `3↓Clear L2 Frmla` …).
- A formula column computes all rows; the edit line label is inverse: `«L2(1)=»46.4`.

## 16. Statistics `2nd`,`data` [ref]

- `«STATS»`: `1:1-Var Stats`, `2:2-Var Stats`, and `3:StatVars` once stats exist. The last choice stays selected.
- Setup screens (menu font): `1-VAR STATS` / `DATA: «L1» L2 L3` / `FRQ: «ONE» L1 L2 L3` / `` / `CALC`; 2-Var: `xDATA:` / `yDATA:`.
- Results: title `«1-Var:L1,1»` (FRQ ONE shows as `1`), `«2-Var:L1,L2»`; items `n`, `x̄`, `Sx`, `σx`, `Σx`, `Σx²`, `minX`, `Q1`, `Med`, `Q3`, `maxX` (1-Var); 2-Var adds `ȳ Sy σy Σy Σy² Σxy a b r x' y'` and ends with `minY maxY` (21 items, `up` from item 1 wraps to the last).
- Values in the menu: 10 significant digits (`a=0.6773251896`, `r=0.9634117173`); `Sx=Error` for non-integer frequencies.
- Picking an item: from the Home screen it pastes the name into the entry (`x̄\t52.5`). **Started from the data editor, it returns to the editor and stores the value in the current cell** (`52.5` appears in L1).
- `STAT` error screen: no data, or 2-Var with lists of different length.

## 17. Function table `table` [ref]

- `y=` entry, then `Start=0`, `Step=1`, `«Auto»  Ask-x`, `\tOK`.
- Auto table: `x|y` header, three rows, the selected x inverse, edit line `x=15`.
- Ask-x: rows appear as x values are typed.

## 18. Constant K [ref]

- `2nd`,`div`: `K=`; enter stores, `K` indicator lit. Each `enter` appends the operation: `4*2+3\t11`. `2nd`,`div` again turns it off.

## 19. Mode screen [ref]

- Small menu font, four rows, current choice inverse (encoding §2.4). Arrows move; `down` lands on the first choice of the next row; `enter` selects; `clear` or `2nd`,`mode` leaves.

## 20. Menus [ref]

- Title or tabs on the first row (active tab inverse), three items, selected item number inverse, `↓`/`↑` in place of `:` when more items exist. Digits pick directly; `clear` goes back; `2nd`,`mode` goes Home.

## 21. Errors [ref]

Screen: `["", "<MESSAGE>", "Error"]`; `clear` returns to the entry with the cursor at the error.

The entry is evaluated from the left and the first error met is shown: `ans^{⁻1}7÷4*+` (Ans 0) → DOMAIN, `2÷0-1+` → DIVIDE BY 0, `log(0)+*` → DOMAIN; `1++2÷0` → SYNTAX because the syntax error comes first.

| message | observed triggers |
|---|---|
| `DIVIDE BY 0` | `1÷0`, `5÷(2-2)`, `\f{1}{0}` |
| `DOMAIN` | `√{⁻1}`, `log(0)`, `log(⁻5)`, `ln(⁻2)`, `tan(90)`, `sin⁻¹(2)`, `2.5!`, `5.5 nPr 2`, `5 nCr ⁻1`, `0^{0}`, `(⁻8)^{.5}`, `\r{0}{5}`, `\r{2}{⁻16}`, `0^{⁻1}` |
| `OVERFLOW` | `10^{100}`, `69!*100`, `e^{231}`, `9*10^{99}*2`, `70!` |
| `SYNTAX` | `1+`, `ans*` (lone operator), `)`, `,`, `5 nPr`, `sin(`, `1+*2`, deleted function token, `sto` inside a fraction |
| `ARGUMENT` | `randint(3)` |
| `STAT` | stats with no data / unequal lists |

## 22. MathPrint vs Classic [ref]

| | MathPrint (default) | Classic |
|---|---|---|
| fractions | `\f{n}{d}` | `n⁄d` |
| powers | `^{…}`, right to left | `^`, left to right |
| √ | `√{…}` | `√(` |
| nth root | `\r{n}{x}` | `nˣ√x` |
| exact results | fractions, √, π forms | decimal unless `n/d` was used |
| sci results | `*10^{n}` | `*10^n` |

## 23. Remaining open items

1. The precise same-row/next-row rule for MathPrint 2-D entries is only known from the vectors; build to match them.
2. The rand generator itself is unknown (only its outputs after reset and after seed 5).
3. Contrast keys (`2nd`,`sub` / `2nd`,`add`) are not simulated.
4. Screens not covered by vectors (deep menu scrolling, Ask-x table editing) follow the same rules but were not all observed.
