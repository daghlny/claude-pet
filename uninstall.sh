#!/usr/bin/env bash
# claude-pet uninstaller — permanently stop it: remove hooks + quit the app.
#
#   curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/uninstall.sh | bash
#
# Add --purge to also delete the cloned app and all pets/settings:
#   curl -fsSL …/uninstall.sh | bash -s -- --purge
set -euo pipefail

APP_DIR="${CLAUDE_PET_APP_DIR:-$HOME/.claude-pet/app}"
PET_HOME="${CLAUDE_PET_HOME:-$HOME/.claude-pet}"
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

# 1) Remove the Claude Code hook entries (stops the pet from reacting at all).
if [ -f "$APP_DIR/dist/cli/index.js" ]; then
  echo "▸ removing Claude Code hooks…"
  node "$APP_DIR/dist/cli/index.js" uninstall || true
else
  echo "▸ app build not found at $APP_DIR — skipping hook removal."
  echo "  (If you ran it from another folder, run \`claude-pet uninstall\` there.)"
fi

# 2) Quit the running app.
echo "▸ quitting the app…"
pkill -f "$APP_DIR/node_modules/.bin/electron" 2>/dev/null || true

# 3) Optionally delete everything.
if [ "$PURGE" -eq 1 ]; then
  echo "▸ purging $PET_HOME (app, pets, settings, event log)…"
  rm -rf "$PET_HOME"
fi

echo "✓ Claude Pet is off."
[ "$PURGE" -eq 0 ] && echo "  Files kept in $PET_HOME. Re-run install.sh to turn it back on, or add --purge to remove."
exit 0
