#!/usr/bin/env bash
# claude-pet uninstaller — fallback for when the `claude-pet` command isn't on
# your PATH. If it is, just run:  claude-pet uninstall
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

# Remove hooks + stop the app via the CLI (linked command, else local build).
if command -v claude-pet >/dev/null 2>&1; then
  claude-pet uninstall || true
elif [ -f "$APP_DIR/dist/cli/index.js" ]; then
  node "$APP_DIR/dist/cli/index.js" uninstall || true
else
  echo "▸ no claude-pet build found — only purge (if requested) will run."
fi

# Drop the global command symlink if we created one.
npm rm -g claude-pet >/dev/null 2>&1 || true

if [ "$PURGE" -eq 1 ]; then
  echo "▸ purging $PET_HOME (app, pets, settings, event log)…"
  rm -rf "$PET_HOME"
fi

echo "✓ Claude Pet is off."
[ "$PURGE" -eq 0 ] && echo "  Files kept in $PET_HOME. Re-run install.sh to turn it back on, or add --purge to remove."
exit 0
