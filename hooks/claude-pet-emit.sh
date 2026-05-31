#!/usr/bin/env bash
# claude-pet-emit.sh — Claude Code hook bridge.
#
# Installed into ~/.claude/settings.json for events:
#   SessionStart, PreToolUse, PostToolUse, Stop, StopFailure, Notification, SessionEnd
#
# Reads the JSON hook payload on stdin, augments it with the parent
# terminal TTY/app (best-effort), and appends one JSON line to
# ~/.claude-pet/events.jsonl. Exits 0 so it never blocks Claude Code.

set -u
EVENT_NAME="${1:-unknown}"
OUT_DIR="${CLAUDE_PET_HOME:-$HOME/.claude-pet}"
OUT_FILE="$OUT_DIR/events.jsonl"
mkdir -p "$OUT_DIR" 2>/dev/null || true

# Read stdin payload (Claude Code hooks pass JSON on stdin).
PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && PAYLOAD="{}"

# Walk up the process tree from this script's parent to find the controlling
# tty and the terminal emulator app. macOS: ps -o tty=,comm= -p <pid>.
TTY=""
TERM_APP=""
PARENT_PID="${PPID:-}"
PID="$PARENT_PID"
for _ in 1 2 3 4 5 6 7 8; do
  [ -z "$PID" ] && break
  LINE=$(ps -o tty=,comm=,ppid= -p "$PID" 2>/dev/null | awk '{$1=$1;print}')
  [ -z "$LINE" ] && break
  THIS_TTY=$(echo "$LINE" | awk '{print $1}')
  COMM=$(echo "$LINE" | awk '{print $2}')
  NEXT=$(echo "$LINE" | awk '{print $3}')
  if [ -z "$TTY" ] && [ "$THIS_TTY" != "?" ] && [ "$THIS_TTY" != "??" ]; then
    TTY="/dev/$THIS_TTY"
  fi
  case "$COMM" in
    *Terminal*) TERM_APP="Terminal"; break ;;
    *iTerm*)    TERM_APP="iTerm2"; break ;;
    *WezTerm*|*wezterm*) TERM_APP="WezTerm"; break ;;
    *Ghostty*|*ghostty*) TERM_APP="Ghostty"; break ;;
    *Alacritty*|*alacritty*) TERM_APP="Alacritty"; break ;;
    *kitty*) TERM_APP="kitty"; break ;;
    *Hyper*) TERM_APP="Hyper"; break ;;
  esac
  PID="$NEXT"
  [ "$PID" = "1" ] && break
done

# macOS BSD `date` doesn't honor %3N (emits the literal "3N"), so go through
# python3 which is part of the macOS Xcode CLT and the standard Linux base.
TS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || date +%s000)

# Compose the emitted event. Use python3 for safe JSON merging — present on macOS.
EMIT=$(EVENT="$EVENT_NAME" TS="$TS" TTY="$TTY" TERM_APP="$TERM_APP" PPID_VAL="$PARENT_PID" \
python3 - "$PAYLOAD" <<'PY'
import json, os, sys
try:
    payload = json.loads(sys.argv[1]) if sys.argv[1] else {}
except Exception:
    payload = {}
out = {
    "ts": int(os.environ["TS"]),
    "event": os.environ["EVENT"],
    "session_id": payload.get("session_id"),
    "cwd": payload.get("cwd"),
    "transcript_path": payload.get("transcript_path"),
    "tool_name": payload.get("tool_name"),
    "notification_type": payload.get("notification_type"),
    "error_type": payload.get("error_type"),
    "message": payload.get("message"),
    "terminal": {
        "app": os.environ.get("TERM_APP") or None,
        "tty": os.environ.get("TTY") or None,
        "pid": int(os.environ["PPID_VAL"]) if os.environ.get("PPID_VAL") else None,
    },
}
sys.stdout.write(json.dumps({k: v for k, v in out.items() if v is not None}))
PY
)

# Rotate the log if it has grown large, so it never balloons unbounded. Keep
# the most recent lines. Best-effort; ignore any failure. ~512KB threshold.
MAX_BYTES=524288
KEEP_LINES=500
if [ -f "$OUT_FILE" ]; then
  SIZE=$(wc -c < "$OUT_FILE" 2>/dev/null | tr -d ' ')
  if [ -n "$SIZE" ] && [ "$SIZE" -gt "$MAX_BYTES" ]; then
    TMP="$OUT_FILE.tmp.$$"
    if tail -n "$KEEP_LINES" "$OUT_FILE" > "$TMP" 2>/dev/null; then
      mv "$TMP" "$OUT_FILE" 2>/dev/null || rm -f "$TMP" 2>/dev/null || true
    else
      rm -f "$TMP" 2>/dev/null || true
    fi
  fi
fi

# Append atomically. Best-effort — never fail the hook.
printf '%s\n' "$EMIT" >> "$OUT_FILE" 2>/dev/null || true
exit 0
