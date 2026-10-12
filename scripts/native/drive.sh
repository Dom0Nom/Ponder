#!/bin/bash
# Native-window driver for the dev app (macOS). Coordinates are window-relative points.
#   drive.sh shot out.png        screenshot of the app window
#   drive.sh click X Y           real mouse click (CGEvent via cliclick)
#   drive.sh type "text"         type text
#   drive.sh key return|esc|...  press a key; "cmd+k" style combos work too
#   drive.sh win                 print id x y w h
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." >/dev/null && pwd)"
BIN="$ROOT/.native-bin"
if [ ! -x "$BIN/winfo" ]; then
  mkdir -p "$BIN"
  swiftc -O "$ROOT/scripts/native/winfo.swift" -o "$BIN/winfo" 2>/dev/null
  swiftc -O "$ROOT/scripts/native/focus.swift" -o "$BIN/focus" 2>/dev/null
fi
OWNER="${NATIVE_OWNER:-ponder|Ponder}"
read -r ID WX WY WW WH < <("$BIN/winfo" "$OWNER")
cmd="$1"; shift || true
case "$cmd" in
  win) echo "$ID $WX $WY $WW $WH" ;;
  shot) screencapture -l "$ID" -o -x "$1" ;;
  click)
    "$BIN/focus" ponder || true
    cliclick "c:$((WX + $1)),$((WY + $2))" ;;
  dclick) "$BIN/focus" ponder || true; cliclick "dc:$((WX + $1)),$((WY + $2))" ;;
  move) cliclick "m:$((WX + $1)),$((WY + $2))" ;;
  scroll) cliclick "m:$((WX + $1)),$((WY + $2))"; osascript -e "tell application \"System Events\" to scroll" 2>/dev/null || true ;;
  type) "$BIN/focus" ponder || true; cliclick -w 20 "t:$1" ;;
  key)
    "$BIN/focus" ponder || true
    combo="$1"
    if [[ "$combo" == *+* ]]; then
      mods="${combo%+*}"; k="${combo##*+}"
      mods="${mods//+/,}"
      if [ ${#k} -eq 1 ]; then cliclick "kd:$mods" "t:$k" "ku:$mods"; else cliclick "kd:$mods" "kp:$k" "ku:$mods"; fi
    else
      cliclick "kp:$combo"
    fi ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
