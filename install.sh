#!/usr/bin/env bash
# claude-pet installer — one shot: fetch, build, wire Claude Code hooks, launch.
#
# Run from anywhere (it clones itself):
#   curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/install.sh | bash
#
# Or from inside a checkout:
#   ./install.sh
#
# Options (append after `| bash -s --` when piping):
#   --no-hooks    build only; don't touch ~/.claude/settings.json
#   --no-launch   install but don't start the app
set -euo pipefail

REPO_URL="https://github.com/daghlny/claude-pet.git"
APP_DIR="${CLAUDE_PET_APP_DIR:-$HOME/.claude-pet/app}"

INSTALL_HOOKS=1
LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --no-hooks)  INSTALL_HOOKS=0 ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "✗ Node.js 18+ is required." >&2; exit 1; }

# Locate the source: use this checkout if we're in one, otherwise clone/update.
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$SELF" ] && [ -f "$(dirname "$SELF")/package.json" ]; then
  SRC_DIR="$(cd "$(dirname "$SELF")" && pwd)"
else
  command -v git >/dev/null 2>&1 || { echo "✗ git is required to fetch claude-pet." >&2; exit 1; }
  if [ -d "$APP_DIR/.git" ]; then
    echo "▸ updating existing checkout in $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    echo "▸ cloning into $APP_DIR"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  fi
  SRC_DIR="$APP_DIR"
fi

cd "$SRC_DIR"

echo "▸ installing dependencies…"
npm install

echo "▸ generating built-in pets…"
npm run gen:builtins

echo "▸ building…"
npm run build

if [ "$INSTALL_HOOKS" -eq 1 ]; then
  echo "▸ wiring Claude Code hooks…"
  node dist/cli/index.js install
else
  echo "▸ skipping hook install (--no-hooks)"
fi

if [ "$LAUNCH" -eq 1 ]; then
  echo "▸ launching…"
  # Replace any previous instance started from this dir, then start detached so
  # it survives this shell closing.
  pkill -f "$SRC_DIR/node_modules/.bin/electron" 2>/dev/null || true
  nohup "$SRC_DIR/node_modules/.bin/electron" "$SRC_DIR" >/dev/null 2>&1 &
  disown 2>/dev/null || true
  echo "✓ Claude Pet is running (look for 🐾 in the menu bar)."
else
  echo "✓ installed. Start it with:  npm start   (in $SRC_DIR)"
fi

echo
echo "  Import a pet:    node $SRC_DIR/dist/cli/index.js import <folder | .zip | URL>"
echo "  Turn it off:     curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/uninstall.sh | bash"
