#!/usr/bin/env bash
# claude-pet one-shot setup.
#
# Installs dependencies, generates the built-in pets, compiles everything, and
# wires the Claude Code hooks into ~/.claude/settings.json. After this finishes
# you can launch the app with `npm start`.
#
# Usage:
#   ./install.sh            # full setup + hook install
#   ./install.sh --no-hooks # build only, skip editing ~/.claude/settings.json
set -euo pipefail

cd "$(dirname "$0")"

INSTALL_HOOKS=1
for arg in "$@"; do
  case "$arg" in
    --no-hooks) INSTALL_HOOKS=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node is required but was not found. Install Node.js 18+ first." >&2
  exit 1
fi

echo "▸ installing dependencies…"
npm install

echo "▸ generating built-in pets…"
npm run gen:builtins

echo "▸ building…"
npm run build

if [ "$INSTALL_HOOKS" -eq 1 ]; then
  echo "▸ installing Claude Code hooks…"
  node dist/cli/index.js install
else
  echo "▸ skipping hook install (--no-hooks)"
fi

echo
echo "✓ done. Launch the pet with:"
echo "    npm start"
echo
echo "  Import a codex-pets / petdex pack any time with:"
echo "    node dist/cli/index.js import <folder | file.zip | https://…/pet.zip>"
