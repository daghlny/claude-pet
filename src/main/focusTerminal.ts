import { execFile } from "child_process";
import type { HookEvent } from "../shared/types";

/**
 * Bring the originating terminal session back to the foreground.
 *
 * We try, in order:
 *   1. AppleScript targeted at the recorded terminal app + tty (best case:
 *      lands on the exact tab/window that ran Claude Code).
 *   2. Plain `activate` of the recorded terminal app (just refocus the app).
 *   3. Open the cwd in Finder (last-resort fallback).
 *
 * Returns the strategy used, for logging.
 */
export async function focusSession(evt: HookEvent | undefined): Promise<string> {
  if (!evt) return "noop";
  const app = evt.terminal?.app;
  const tty = evt.terminal?.tty;
  const cwd = evt.cwd;

  if (app === "Terminal" && tty) {
    const ok = await runOsa(terminalDotAppScript(tty));
    if (ok) return "Terminal:tty";
  }
  if (app === "iTerm2" && tty) {
    const ok = await runOsa(iTermScript(tty));
    if (ok) return "iTerm2:tty";
  }
  if (app) {
    const ok = await runOsa(`tell application "${osaStr(app)}" to activate`);
    if (ok) return `${app}:activate`;
  }
  if (cwd) {
    await runOsa(`tell application "Finder" to open POSIX file "${osaStr(cwd)}"`);
    return "finder:cwd";
  }
  return "noop";
}

/** Escape a value for embedding inside an AppleScript double-quoted string. */
function osaStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function runOsa(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], (err) => resolve(!err));
  });
}

function terminalDotAppScript(tty: string): string {
  // Terminal.app exposes `tty of tab` — we walk windows/tabs and activate
  // the match. AppleScript escaping is minimal because tty is /dev/ttysNNN.
  return `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of t) is "${osaStr(tty)}" then
          set selected of t to true
          set index of w to 1
          return
        end if
      end try
    end repeat
  end repeat
end tell`;
}

function iTermScript(tty: string): string {
  return `
tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          if (tty of s) is "${osaStr(tty)}" then
            select t
            select s
            return
          end if
        end try
      end repeat
    end repeat
  end repeat
end tell`;
}
