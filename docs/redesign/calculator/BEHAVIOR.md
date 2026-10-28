# Calculator behavior spec (GED test layout)

Source of truth for the builder of `src/features/calculator/`. Written clean-room: from observing the reference emulator as a black box (keys clicked, LCD pixels read) and from TI's public *TI-30XS MultiView guidebook* (2019 edition, cited as **GB p.N**). No code, artwork or font data from the reference is used or described here.

## Changes (fourth random check, seed 4)

A comparison run (200 random sequences, seed 4) found six real differences (four scroll windows, two error precedences). Each was reproduced with nearby variations: 110 new verified vectors (`*-seed4-*`, 815 in total).

- **Scroll window is computed in dots, every key** (§3.2): the line is shifted by the larger of a content limit (line width + end cell − 96) and a cursor limit. A cursor inside a template slot must start before cell 15; if not, the line shifts so the cursor starts at cell 14. A top-level cursor may sit in cell 15. A line ending in a stacked fraction reserves no end cell. Fractions' half-cell offset lets the left edge fall mid-cell.
- **Partly scrolled templates** (§2.2): cell 0 under `◂` is never written; a template cut on the left keeps its wrapper and lists only the visible characters; a row whose visible glyphs are all in one superscript is written flat.
- **A `)` inside a template slot closes that slot early** (§21): when it is the template's last slot, the template's operation runs there (its error is reported); evaluation goes on left to right, and the slot's own end is then an unmatched `)` → SYNTAX only when reached.
- **An empty slot is a SYNTAX error only when evaluation reaches it** (§21): errors to its left, including in an x-root index or a numerator, win.
- **On an error screen every key except `clear` is ignored** (§21), including digits, operators, arrows and `enter`. Answers QUESTIONS Q14.
- **Conversions typed into an empty exponent or radicand go inside it** (§9): `9 pow 2nd x10n` → `9^{▸n/d◂▸Un/d}`, then `enter` → SYNTAX.
- **x-root index after a power and a number** (§9): `square recip 4 0 4 2nd pow` takes only `404` as the index: `(ans^{2})^{⁻1}\r{404}{}`.
- **Open** (QUESTIONS Q18): why fraction-ending lines reserve no end cell, exact slot-cursor threshold, and lines with a fraction before other content.

## Changes (third random check)

Three more random runs (seeds 1-3, 600 sequences) and targeted probes. 60 new verified vectors (705 in total). Real differences found:

- **π results** (§7.4): an integer coefficient of π stays exact up to 10 digits (`9999999999π`); 11 digits go decimal. `\f{1}{n}π` stays `\f{π}{n}` up to n = 1000.
- **Fraction results keep denominators up to 1000** (§8): `\f{1}{1000}` stays a fraction, `\f{1}{1001}` is `0.000999001`.
- **Toggle finds no radical in a decimal** (§7.5): `10^{.5}` → toggle → `3.16227766`, not `√{10}`.
- **x-root index** (§9): `2nd`,`pow` takes the whole operand before the cursor as the index (number, `(…)`, function call, power, `%`, implied product, fraction), `ans` on an empty line, and an empty index after an operator.
- **Delete in templates** (§5): deleting the last character of a √, x-root, e^, 10^ or power slot removes the template, as does `delete` in any empty slot. Fractions need one more `delete` once a slot is empty. `e^{}` goes with its `e`; `10^{}` leaves `10`.
- **Parentheses from `x²`/`x⁻¹` then `pow` are real** (§9): `clear` in the exponent leaves `(8^{2})`.
- **`clear` deletes from the cursor to the end** (§5). Inside a template it starts at that template.
- **`2nd`,`frac` not after a number** opens a mixed number with an empty whole-part slot (§8).
- **After an error, `clear` puts the cursor on the token where evaluation stopped**, in overwrite mode (§21).
- **Layout** (§3.1, §3.2): a stacked fraction takes its wider part + 1 cells. A fraction in a superscript keeps the normal fraction size. Parentheses next to a fraction are tall. An empty slot holding the cursor is one cell, and the end-of-line cursor cell is still reserved after it.
- **Open** (QUESTIONS Q16): the 13th digit of eˣ, and the scroll offset for lines that contain fractions or radicals.

## Changes (second differential check)

Second comparison run (all 645 vectors, 200 random sequences, seed 1). Vectors all match except the history cut below; these random sequences showed real differences (read from the reference screen; the encoded text in the report is unreliable for empty templates because the LCD reader can't read placeholder dots):

- **Empty template slots are drawn as dotted placeholder boxes**, not left blank (§3.1, §4). Every empty slot shows a box of dots in the glyph cell grid at the slot's size: a fraction with nothing in it shows two stacked placeholder boxes with the fraction bar between them (`0 lparen 2nd frac 9 recip 0` ends `0(9⁻¹0` then a gap cell and an empty stacked fraction); an empty ×10ⁿ / eˣ / power exponent shows one small raised placeholder box (`5 4 mul x10n` → `54**10` with a raised placeholder; `. 7 2nd ln pow` → `.7e` with a raised placeholder); an empty denominator under a filled numerator shows a placeholder box under the bar (`lparen sub frac 2 var div 5 0 2nd frac 5`; `pi sub frac sto mul div 0 2nd pow 0`). Placeholders stay lit while the cursor blinks; the blinking cursor is drawn over the slot it sits in. The text encoding is unchanged (`\f{}{}`, `^{}`).
- **Horizontal scroll window keeps whole tokens visible from the left edge after `◂`** (§3.2): after scrolling left, the first visible cell after `◂` is the earliest cell that lets the cursor cell stay on screen, and a multi-cell token like `sin⁻¹(` is shown from its last visible cells (`2nd sin 5 mul recip sub 4 3 sub rparen 1 delete var 0` shows `◂n⁻¹(5*⁻¹-43-)x0`, i.e. the `n` of `sin⁻¹` stays visible); when the window starts exactly at a token boundary nothing extra is kept (`mul 7 tan 9 6 sin lparen 2nd x10n pow 1` shows `◂96sin((▸n/d◂▸Un/d¹`, with no `(` before `96`). A trailing `▸` appears at the right edge whenever content continues to the right of the window (`6 5 sto add lparen tan div recip 5 neg rparen 2nd table 2nd frac 6` shows `◂n(÷⁻¹5⁻)▸F◂▸d6` and then `▸`, because the empty fraction after `6` is off screen).
- **Correction (third check): an empty template does NOT pre-empt evaluation errors.** Errors still come in evaluation order (first failing operation from the left), with one refinement: **a function's whole argument is parsed before the function is applied, so a syntax error inside the argument wins over the function's own error** (§21). `log 8 var 2nd rparen 6 frac enter` is `log(8x▸%6…`: the `▸%6` inside the argument is a syntax error, so SYNTAX, not the DOMAIN of `log(0)`. Counter-examples that must stay evaluation errors: `2 div 0 sub 1 5 2nd table 2nd log 4 frac 3 2nd square enter` → DIVIDE BY 0 (the `2÷0` comes first, the empty denominator later); `recip pow 2nd cos pow enter` with ans = 0 → the first entry's `ans⁻¹` fails first → DOMAIN.
- **`pow` with the cursor in an empty exponent nests a new empty exponent** (it is not ignored): `5 . 7 5 9 pow pow 6 enter` builds `5.759^{^{6}}` → SYNTAX (empty base of the inner power); `. 7 2nd ln pow` shows `.7e^{^{}}`, drawn as a raised placeholder with a second, higher placeholder.
- **With the cursor inside a superscript deeper than the screen can show at the baseline, the window still shows the superscript's content** (§3.2), never an empty line: `2nd lparen square ln . . pow 8 2nd tan 0 2nd neg 2nd log lparen` shows the raised content `8tan⁻¹(0ans10(` with `◂` at the left of the baseline row.
- **`toggle` inside a superscript/negation entry keeps the whole entry** (§7.5): `8 2nd square pow 2nd neg toggle 3 add 3 7 3 tan 2 7` shows the long entry scrolled with `◂` at the left (`…◂▸3+373tan(27` visible), never an empty line with only `◂▸`.
- **A square root scrolled partly off screen keeps its overline** (§3.2, §4): when the `√` sign is scrolled out to the left, the radical's horizontal bar is still drawn over every visible cell of its content, ending where the radical's content ends; the visible part of the hook stays at the left edge after `◂`. Example: `8 2nd square pow 2nd neg toggle 3 add 3 7 3 tan 2 7` shows a bar across the whole row above `…s◂▸3+373tan(27`.
- **History-row cut keeps the token that crosses the 16th cell whole** (§3.2): `left square pow 3 add 2 5 2 mul tan 9 div 5 left enter` shows `(ans²)³⁺²⁵²×tan(` and then `▸` (the `tan(` token is shown complete; the vector `hist-cutSuperscript` should read `(ans^{2})^{3+252*tan(}▸`).
- **Glyph:** the multiplication sign on the LCD is a small `×`-shaped glyph in the normal font, not an asterisk; the text encoding stays `*`.

## Changes (differential check)

The running build was compared with the running reference: all vectors plus 200 random key sequences. New rules found there, each backed by new verified vectors (645 in total):

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
- **Pressed key**: the reference fills a pressed key red.

## 0. Status

All 815 vectors (578 from the first draft, 47 probes from the verification pass, 20 from the differential check, 60 from the third random check, 110 from the seed 4 check) in `vectors.json` were run on the reference (each one from a page reload plus a device reset) and read back pixel by pixel. Vectors whose result differed from the first draft were captured at least twice more and kept only where the runs agreed (three were flaky in the first run and fixed by the re-runs). Tags:
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

**Rows scrolled horizontally** (§3.2):
- Cell 0 under `◂` is never written, even when raised or numerator pixels of the hidden glyph stay visible. A glyph whose box starts left of dot 7 (partly hidden after a mid-cell shift) is not written either.
- A template cut off on the left keeps its wrapper and lists only its visible characters: `◂√{2345678901234}`, `◂\f{3456789012345}{}`, `◂\r{0}{3log(9^{▸n/d◂▸Un/d}}` (index `450`, only `0` visible), `◂^{(9067tan⁻¹(8.5}7`.
- When every visible glyph of the row is inside one superscript (its base scrolled off), the row is written flat: `x10n div 5 cos 9 0 6 7 2nd tan 8 . 5` → `◂(9067tan⁻¹(8.5`.

### 2.3 Scrolled history
The Home screen scrolls by dot rows, so the top row can be cut. A row is written only if its own text cells are fully on screen; a stacked fraction counts as visible only if its numerator is. Pieces of a row that are cut off (for example the superscript of `15^{2}` when only `15` and `225` are visible) are left out: that row is written `15\t225`.

### 2.4 Special screens
- **Error / message screens:** `["", "DIVIDE BY 0", "Error"]`, `["", "MEMORY CLEARED"]`. Text centered on the device; the encoding has no alignment.
- **Mode screen:** four rows exactly as `«DEG» RAD GRAD`, `«NORM» SCI ENG`, `«FLOAT» 0123456789` (with FIX n: `FLOAT 01«2»3456789`), `CLASSIC «MATH»`.
- **Small-font setup screens** (stat setup, ...): six-dot rows; an empty row is `""`. Example: `["1-VAR STATS", "DATA: «L1» L2 L3", "FRQ: «ONE» L1 L2 L3", "", "CALC"]`.
- **Data editor:** one row per visible list row, cells joined by `|` (`L1|L2|L3`), empty cell `""`, empty slot placeholder `------`; then the edit line (`L1(5)=`, `«L2(1)=»46.4` when the list has a formula). The column titles are the indicators `L1 L2 L3`. Example: `["55||", "55||", "55||", "«------»||", "L1(5)="]`.
- **Function table:** header `x|y`, three rows `x|y`, then the edit line: `["x|y", "«15»|315", "18|324", "21|315", "x=15"]`.

## 3. Display layout [ref]

### 3.1 Dot matrix and fonts
- LCD canvas: 96 dots wide. Above the text area is an indicator band drawn in a tiny 3×5 font at half-dot resolution.
- Text area: 4 rows × 8 dots = 32 dot rows (plus 1-2 spare rows).
- **Normal font:** 5×7 glyphs in **monospaced 6×8 cells**, 16 cells per row, starting at dot column 1. Narrow glyphs (`.`, `1`, `'`, `°`, `(`) are drawn inside the same 6-dot cell, so spacing is always by whole cells.
- **Small font:** 5×5 glyphs at a 6-dot pitch. Used for superscripts (raised so their bottom is 2 dots below the top of the normal cell) and for numerator and denominator of stacked fractions. A superscript inside a small-font group is raised a further 2 dots.
- **Menu font:** 4×5 glyphs at a 5-dot pitch, 6-dot rows. Used on the mode screen, the stat setup screens and in the data editor / table grids.
- Stacked fraction: numerator (small font), one blank dot row, a 1-dot bar, one blank row, denominator. The bar sits on the middle row (row 3) of the line's normal cell.
- **Fraction width:** a fraction whose wider part has n cells takes **n+1 cells**. If it starts at cell boundary column s, the bar runs from s+1 to s+6n+3, and both parts are centred with their glyph cells starting at s+3 (a half-cell offset). The next element starts at the next cell boundary. Examples: an empty fraction (n=1) takes 2 cells, with a 9-dot bar and the placeholder at s+3..s+7. `\f{1}{1000}π`: bar at columns 2-28, `π` in cell 5. The result `\f{π}{2}` sits right-aligned with its bar at columns 86-94.
- **Fraction inside a superscript** keeps the normal fraction size (small-font parts, 5×5 placeholders). Its bar sits on the superscript's middle row and the line grows upward. In `2 pow 1 frac 3` the bar is at text row 10, `1` at rows 4-8, `3` at rows 12-16, and the base `2` drops to rows 14-20.
- Placeholders: an empty slot is a dotted outline of 8 dots. In the normal size it is 5×7 with dots on rows 0, 3 and 6; in the small size it is 5×5 with dots on rows 0, 2 and 4.
- Tall parentheses: 9 dots tall around a superscript-height group, and 13 dots tall (text rows 4-16) around or next to a stacked fraction. This includes the `(` of a function name followed by a fraction (`tan(` before `\f{…}{…}`) and a `(` typed right before a fraction.
- `◂` at the left edge replaces the baseline glyph box of cell 0. Any raised (superscript) pixels of that cell stay visible above it.
- Radical: a check stroke starting at the bottom-left and a 1-dot bar over the radicand.
- Inverse video: black box with the glyphs left unlit; normal-font boxes cover the 8-dot cell row (7 rows + the row below), menu-font boxes cover 6 rows.

### 3.2 Home screen layout
- History grows from the top. Each calculation shows the entry left-aligned and the result right-aligned.
- **Same row or next row:** a result shares the entry's row when entry cells + result cells ≤ 14 (at least two empty cells between them); otherwise it goes right-aligned on the next row. Cell counts: one per character; a stacked fraction counts as its wider part + 1 (§3.1; `\f{1}{9999}` + `0.00010001` = 5 + 10 → next row, `\f{2}{3}◂▸` + `0.666666667` = 3 + 11 → same row); a superscript counts its characters; `√{…}` counts 1 + its content; `\r{n}{…}` counts index + 1 + content; `◂▸` is one cell, `▸F◂▸d` four, `▸n/d◂▸Un/d` five. Two exceptions put the result on its own row even when it fits: a result that is a stacked fraction containing a radical (`sin(45)` / `\t\f{√{2}}{2}`), and an entry with a fraction nested in a fraction. This matches all 705 vectors.
- Rows that contain superscripts or fractions are taller; the screen scrolls by dot rows, so the top row may be cut (§2.3).
- An entry that does not fit scrolls horizontally. **The cursor cell at the end counts**: entry plus cursor may use 16 cells, so 15 digits still fit and 16 digits show `◂34567890123456`. The first or last cell then shows the overflow mark: `◂67890123456789` (cursor at the end), `123456789012345▸` (cursor at the start). History rows that are too long are cut at the 16th cell and end with `▸`, also inside a superscript: `sin(30)^{2}+cos(30▸`, `(ans^{2})^{3+252*tan}▸`.
- **An empty slot holding the cursor** counts as one cell, and the end cursor cell is still reserved after it. `12345678901234` `pow` fits: 14 digits, the raised placeholder in cell 14, and cell 15 empty. With 15 digits it scrolls to `◂3456789012345`, then the placeholder, then an empty cell. `2nd tan . pi 5 2nd lparen div recip pow` fits without scrolling: `t a n ⁻¹ ( . π 5 % ÷ ( ⁻1 ) □` takes cells 0-14. The `⁻¹` of `tan⁻¹(` is one cell, and the `⁻1` with no base is two raised cells inside tall parentheses.
- An empty fraction at the end needs 2 cells. When those don't fit, the line ends with `▸` instead.
- **Window offset (seed 4 check).** The window shift O is in dots and is recomputed after every key (not sticky: `#14 pow 4` scrolls by one cell, `right` scrolls back to 0). O = max(content, cursor, 0):
  - *content* = W − 96. W is the line width in dots as laid out (§3.1), where a cursor at the end of a slot or in an empty slot takes one cell inside that slot (under the √ bar; it counts toward a fraction's n), plus one end cell after the line, **except when the line ends with a stacked fraction** (no end cell).
  - *cursor*: a top-level cursor may start at cell 15 (dot 91); beyond that the line shifts so it starts at cell 15. A cursor inside a slot (at its end, in an empty slot, or on a character) may start at most at dot 88; beyond that the line shifts so the cursor starts at cell 14 (dot 85).
  - Examples: `2nd square #1234567890123` fits; `#12345678901234` (14 digits) in the radicand → O = 6 → `◂√{2345678901234}`; `right` → O = 0. `#12345678901234 pow 4` → `◂345678901234^{4}`. `x10n #123456789012` then `left` → `◂10^{123456789012}` (cursor on the last digit at cell 17 → shift 3 cells). `frac #12345678901234` fits (numerator cursor at dot 88); 15 digits → O = 9 dots → `◂\f{3456789012345}{}`. `1 2 3 frac #123456789012345` → `◂\f{123}{3456789012345}`; `left` → O = 0. `#12345678901234 add frac` → numerator placeholder at dot 94 → O = 9 → `◂45678901234+\f{}{}`. `9 2 4 2nd frac 5 cos 6 7 mul x10n div 1` → O = 15 → `◂\f{5cos(67**10^{÷1}}{}`; one more `var` → O = 21 → `◂\f{cos(67**10^{÷1x}}{}` (the `5` sits under `◂`).
  - A shift that is not a multiple of 6 leaves the left edge mid-cell: `◂` covers cell 0, and a glyph partly hidden behind it is drawn cut. On a line with a fraction, `◂` is centred on the bar row.
  - When the cursor moves left out of the window, the left-scroll rule from the second differential check applies (whole tokens kept from the left edge).

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
- **Reset**: `2nd`,`0` shows `«Reset»` / `«1:»No` / `2:Yes`. `2` resets: DEG, NORM, FLOAT, MATH, variables 0, lists empty, K off, Ans 0, history empty. The screen shows `["", "MEMORY CLEARED"]`; `clear` returns to an empty Home screen.
- The reference page itself loads a saved state: RAD mode with `MEMORY CLEARED` on screen. That is why every vector starts with a reset.
- **Vector start state**: page reload, then `2nd`,`0`,`2`, then `clear`, then the vector's mode prefix (`vectors.json` → `modes`), then `keys`. Expected text is read after the last key.

## 5. Entry and editing [ref]

- Typing at the end of the entry appends. With the cursor inside the entry, typing **overwrites** the character under the cursor (`1 2 3 left left 9` → `193`).
- `2nd`,`delete` switches to insert for the following characters (`1 2 3 left left 2nd delete 9` → `1923`); the cursor becomes an underline.
- `delete` deletes the character under the cursor; at the end of the entry it deletes the last character (`1 2 3 delete` → `12`).
- **Deleting in templates:**
  - Deleting the only character left in a power, √, x-root radicand, `e^{}` or `10^{}` slot removes the template too, and the next keys go on the baseline. Examples: `2 pow 6 delete 8` → `28`; `2nd square 4 delete 5` → `5`; `1 2 2nd pow 3 delete 5` → `125`; `2nd ln 3 delete 5` → `5`. The same happens with the cursor on that character (`1 2 2nd pow 3 left delete` → `12`). With more characters in the slot, `delete` removes one as usual.
  - `delete` in an empty slot removes the template. The content of its other slots stays inline: `3 frac delete 4` → `34`, `frac 1 2 down delete` → `12`, `2 2nd frac 1 down delete 7` → `217`, `3 2nd pow delete 4` → `34`, `2 mul 2nd pow 3 right 4 delete 6` → `2*36`.
  - Fractions: deleting the last character of a numerator or denominator leaves the slot empty, so it takes one more `delete` to remove the template (`1 2 frac 3 4 delete delete delete 5` → `125`; `1 2 frac 3 delete 5` → `\f{12}{5}`).
  - `e^{}` is removed whole, `e` included: `2nd ln delete 9` → `9`, `1 var 2nd ln delete 9` → `1x9`, `5 2nd ln delete delete 9` → `9`.
  - `10^{}` leaves `10`: `2 2nd log delete 5` → `2105`. `*10^{}` from `x10n` leaves `*10` (`2 x10n delete 5` → `2*105`).
  - Once the template is gone, the next `delete` removes the character before it: `1 2 2nd pow 3 delete delete 4` → `14`.
- A function token (`sin(`, `log(`, `ans`) is one element for the cursor and for `delete` (`sin(30) 2nd left delete` leaves `30)`, which is a SYNTAX error on `enter`).
- `left`/`right` move one element; `2nd`,`left` / `2nd`,`right` jump to the start/end. `left` at the start stays there.
- `clear` **deletes from the cursor to the end of the entry**. Cases:
  - With the cursor on the baseline: `1 2 3 left left clear 9` → `19`, `1 2 3 left clear` → `12`, `div 0 2 2nd rparen lparen 0 0 left clear` → `ans÷02▸%(0`.
  - With the cursor at the start, or at the end of a non-empty entry, it clears the whole line.
  - With the cursor inside a MathPrint template, the deletion starts at that template, which is removed with its content and everything after it. Examples: `4 pow 5 clear 9` → `49`; `4 pow 5 6 left clear 9` → `49`; `frac 1 2 down 3 4 left clear 9` → `9`; `1 2 pow 3 right 4 5 left left left clear` → `12`; `)(4^{}`, `left`, `9`, `clear` → `)(49`.
  - On an empty entry line it clears the screen (history still reachable with `up`).
  - On an error screen it returns to the entry with the cursor on the error token (§21).
  - In a menu it goes back.
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
- The reference's eˣ is a few units low in the 13th digit (`e^{2}` toggles to `7.389056098929◂▸`, true 7.38905609893065; `e^{3}` → `20.08553692315`). Other functions checked are correctly rounded at 13 digits (`e^{1}`, `ln(2)`, `10^{.5}` → `3.162277660168`, `3cos(332)` → `2.648842778577`). This is a known divergence (QUESTIONS Q10). Ponder rounds correctly, and the 10-digit display is not affected.

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
- π multiples: `2*π` → `2π`, `π*12^{2}` → `144π`, `π+π` and `3π-π` → `2π`, `38^{2}π68` → `98192π`, `2^{10}π` → `1024π`. But `π+1` and `π*1.5` are decimal.
  - The integer coefficient may have up to 10 digits: `1234567π` and `9999999999π` stay. 11 digits go to the normal decimal format: `12345678901π` → `3.878509417*10^{10}`, and `9999999999π+π` → scientific. A result too long for the row goes right-aligned on the next row.
  - A rational coefficient gives `\f{kπ}{d}` while d ≤ 1000: `π*\f{1}{2}` → `\f{π}{2}`, `\f{1}{999}π` → `\f{π}{999}`, `\f{1}{1000}π` → `\f{π}{1000}`. Above that it is decimal: `\f{1}{10000}π` → `0.000314159`.
  - `π^{2}`, `ππ`, `π^{⁻1}` (`0.318309886`) and `√{2}π` are decimal.
- Any decimal point in the input gives a decimal result (`\f{1.2+1.3}{4}` → `0.625`, `sin(30.0)` → `0.5`).
- A negative fraction is written with the sign in front: `⁻\f{3}{4}`.
- In Classic, results are decimal unless the input used `n/d`: `1÷2` → `0.5`, `10^⁻2` → `0.01`, `1⁄8` → `1⁄8`.

### 7.5 Answer toggle `toggle`

- While an entry is being typed, `toggle` inserts a `◂▸` token at the cursor. At the end of a complete expression it makes `enter` show the other result form (`log(37π)◂▸` → `\t2.065351597`); anywhere else it is a SYNTAX error on `enter` (`4◂▸2`). On an empty line it shows `◂▸`, and a following `√{8}` is a SYNTAX error.
- Adds a history row: the previous result followed by `◂▸`, then the other form: `\f{1}{8}◂▸` / `0.125`; `2√{2}◂▸` / `2.828427125`; `2π◂▸` / `6.283185307`; a decimal toggles to its exact form with the 13-digit value shown: `3.142857142857◂▸` / `\f{22}{7}`, `0.7853981633975◂▸` / `\f{π}{4}`.
- Radical forms are not recovered from decimals. A decimal from a power, or one typed in, toggles to the decimal again: `10^{.5}` → `3.162277660168◂▸` / `3.16227766`; `2^{.5}` → `1.414213562373◂▸` / `1.414213562`; a typed `1.414213562` → `1.414213562◂▸` / `1.414213562`. Toggling back a value that was shown as `√{2}` gives `√{2}` again (`2nd square 2 enter toggle toggle`).
- On an empty line, the conversion keys paste the previous **value**: `2nd prb 6` → `0▸DMS`; after `\f{7}{4}`, `2nd x10n` → `\f{7}{4}▸n/d◂▸Un/d`.

## 8. Fractions [ref, GB p.13-14]

- MathPrint: `frac` before a number opens an empty template; a number typed first becomes the numerator; `down` moves to the denominator; `right` leaves the template. Numerator and denominator may contain expressions.
- `2nd`,`frac` after a whole number starts a mixed number: `1\f{1}{2}`.
- Elsewhere (empty line, after an operator), `2nd`,`frac` inserts a whole-part slot (a normal-size placeholder) followed by an empty fraction, with the cursor in the whole part. Keys typed there go on the baseline: `add delete div 2nd frac div 9 4` builds `ans÷÷94` followed by the empty fraction. `right` from a filled whole part enters the numerator.
- Results are improper fractions in lowest terms: `4\f{5}{9}` → `\f{41}{9}`.
- `▸n/d◂▸Un/d` converts both ways: `\f{9}{2}` → `4\f{1}{2}`, `3\f{1}{4}` → `\f{13}{4}`.
- `▸F◂▸d`: `4\f{1}{2}▸F◂▸d` → `4.5`, `0.25▸F◂▸d` → `\f{1}{4}`.
- A fraction result keeps its form while the denominator is ≤ 1000. Above that it is decimal: `\f{1}{1000}` → `\f{1}{1000}`; `\f{1}{1001}` → `0.000999001`; `\f{1}{9999}` → `0.00010001` (next row, §3.2); `\f{1}{999}+\f{1}{998}` → `0.002003005`.
- `sto` inside a template is a SYNTAX error (`1 frac 4 sto var enter` → SYNTAX).
- Classic: `3⁄4+1␣7⁄12` → `7⁄3`, `9⁄2▸n/d◂▸Un/d` → `4␣1⁄2`, `4␣1⁄2▸F◂▸d` → `4.5`.

## 9. Powers, roots, π, logs [ref]

- `pow` opens a superscript in MathPrint (leave with `right`); in Classic it is a `^` operator.
- `square` appends `^{2}` (Classic `²`), `recip` appends `^{⁻1}` (Classic `⁻¹`). Repeating them shows automatic parentheses: `(3^{2})^{2}`, `(4^{⁻1})^{⁻1}`. `pow` after them also wraps the power: `8 square pow 5` → `(8^{2})^{5}`. These parentheses are real entry tokens. `clear` in the exponent leaves them: `8 square pow 5 clear` → `(8^{2})`, then `enter` → `64`, or `3` → `(8^{2})3`; `8 recip pow 5 clear` → `(8^{⁻1})`.
- `2nd`,`square`: MathPrint radical template `√{…}`; Classic `√(`.
- `2nd`,`pow` (MathPrint x-root): the index is the whole operand just before the cursor, and the cursor goes to the radicand.
  - A number, including a decimal: `1.5 2nd pow 8` → `\r{1.5}{8}` = `4`. Only the last operand of a sum is taken: `1+\r{3}{8}` = `3`. A leading negation stays outside: `⁻\r{3}{8}` = `⁻2`.
  - A parenthesized group: `\r{(1+2)}{8}` = `2`.
  - A function call: `\r{sin(30)}{4}` = `16`.
  - A power: `\r{2^{3}}{64}` = `1.681792831`, `\r{3^{2}}{512}` = `2`.
  - A postfix `%`: `\r{47%}{2}` = `4.370079649`.
  - A fraction: `\r{\f{2}{34}}{8}` = `2.251799814*10^{15}`.
  - An implied product: with x = 8, `\r{3x}{64}` = `1.189207115`.
  - `π` or `x` alone.
  - On an empty line the index is `ans`: `27 enter 2nd pow 8 enter` → `\r{ans}{8}` = `1.080059739`.
  - After an operator the index is an empty slot and the cursor goes into it: `2 mul 2nd pow 3` → `2*\r{3}{}` with an empty radicand placeholder; `right` moves to the radicand. Leaving both empty gives SYNTAX (`2*2nd pow 8 enter`).
  - After a power followed by a number, only the number is the index: `square recip 4 0 4 2nd pow` → `(ans^{2})^{⁻1}\r{404}{}` (not the implied product). After a power alone the power is the index: `0 recip 2nd pow` → `\r{0^{⁻1}}{}`.
  - Classic: `3ˣ√64`.
- Conversion keys typed into an empty exponent or radicand go inside it, in the small font for an exponent: `9 pow 2nd x10n` → `9^{▸n/d◂▸Un/d}`, `9 pow 2nd table` → `9^{▸F◂▸d}`, `9 pow 2nd rparen` → `9^{▸%}`, `2nd square 2nd x10n` → `√{▸n/d◂▸Un/d}`. Typing continues inside the slot (`9^{▸n/d◂▸Un/d5}`); `enter` gives SYNTAX.
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

Screen: `["", "<MESSAGE>", "Error"]`.

`clear` returns to the entry with the cursor **on** the token where evaluation stopped, in overwrite mode. The next key replaces that token:

| entry | cursor on | `clear 5 enter` (or `7`) |
|---|---|---|
| `1÷0+2` | `+` | `1÷052` → `0.019230769` |
| `2÷0*3` | `*` | `2÷053` → `0.037735849` |
| `log(0)+1` | `)` | `log(05+1` → `0.77815125` |
| `1+*2` | `*` | `1+52` → `53` |
| `1→` | `→` | `17` → `17` |
| `1→2` | `→` | `172` → `172` |

When the error is found at the end of the entry (`1+`, `2÷0`, `2+1÷0`), the cursor is at the end.

The entry is evaluated from the left and the first error met is shown: `ans^{⁻1}7÷4*+` (Ans 0) → DOMAIN, `2÷0-1+` → DIVIDE BY 0, `log(0)+*` → DOMAIN; `1++2÷0` → SYNTAX because the syntax error comes first.

**Template slots are parenthesised groups** (seed 4 check). Every slot (`√{…}`, `e^{…}`, `10^{…}`, `^{…}`, numerator, denominator, x-root index and radicand) is evaluated like `(…)`. A `)` typed inside a slot closes that group early. If the slot is the template's last operand (radicand, exponent, denominator), the template's operation is applied right there and its error, if any, is reported. Evaluation then goes on left to right at the outer level, and the slot's own end is an unmatched `)`, a SYNTAX error only when evaluation reaches it. So in a numerator the early `)` leads to SYNTAX at the numerator's end, before the division (`\f{1)}{0}` → SYNTAX), unless the numerator itself fails first. An early `)` in an x-root index was not tested.

| keys | entry | result |
|---|---|---|
| `2nd ln 4 6 square rparen tan 3 6 5 recip enter` | `e^{46^{2})tan(365^{⁻1}}` | OVERFLOW (`e^{2116}`) |
| `2nd ln 2 rparen enter` | `e^{2)}` | SYNTAX |
| `2nd log 1 0 0 rparen enter` | `10^{100)}` | OVERFLOW |
| `2 pow 1 0 0 0 rparen enter` | `2^{1000)}` | OVERFLOW |
| `2 pow 2 rparen enter` | `2^{2)}` | SYNTAX |
| `2nd square 4 rparen enter` | `√{4)}` | SYNTAX |
| `2nd square 0 sub 1 rparen enter` | `√{0-1)}` | DOMAIN |
| `2nd square 2 rparen sub 1 div 0 enter` | `√{2)-1÷0}` | DIVIDE BY 0 (evaluation continues after the early close) |
| `2nd square 4 rparen 1 div 0 enter` | `√{4)1÷0}` | DIVIDE BY 0 |
| `2nd log 0 recip rparen enter` | `10^{0^{⁻1})}` | DOMAIN |
| `frac 1 rparen down 0 enter` | `\f{1)}{0}` | SYNTAX |
| `frac 1 down 0 rparen enter` | `\f{1}{0)}` | DIVIDE BY 0 |
| `frac 1 div 0 rparen down 2 enter` | `\f{1÷0)}{2}` | DIVIDE BY 0 |

A `(` typed before the template matches the `)` normally: `lparen 2nd square 0 sub 1 rparen enter` → DOMAIN, `lparen 2 pow 1 0 0 0 rparen enter` → OVERFLOW.

**Empty slots** are a SYNTAX error found only when evaluation reaches them; errors to their left win, including errors in an x-root index or a numerator: `0 recip 2nd pow enter` (`\r{0^{⁻1}}{}`) → DOMAIN, `square recip 4 0 4 2nd pow enter` with Ans 0 → DOMAIN, `lparen 1 div 0 rparen 2nd pow enter` → DIVIDE BY 0, `frac 0 recip enter` → DOMAIN, `frac 2 down 0 recip enter` → DOMAIN, `2 2nd pow 0 recip enter` (`\r{2}{0^{⁻1}}`) → DOMAIN; `2 2nd pow enter` → SYNTAX.

**Error screen keys:** while an error message is shown, every key except `clear` is ignored (digits, operators, `left`, `right`, `enter`): `1 div 0 enter 8 enter` and `1 div 0 enter right 5 enter` stay on DIVIDE BY 0; `square recip 4 0 4 2nd pow enter 8 square div right neg 3 pi enter` stays on the first DOMAIN. After `square recip 4 0 4 2nd pow enter clear` the entry `(ans^{2})^{⁻1}\r{404}{}` returns with the cursor at the end of the `⁻1` exponent (the failing power), indicators `DEG ↑`.

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
5. The 13th digit of eˣ (QUESTIONS Q10). Scroll offsets with fractions and radicals are answered (§3.2); the remaining scroll and error details are in QUESTIONS Q18.
