import type { HookEvent, StateAdvice } from "../shared/types";

/**
 * Translate a Claude Code hook event into a pet animation + speech bubble.
 *
 * State names and their meanings mirror the Codex desktop pet exactly, so a
 * codex-pets.net pack reacts the same way under claude-pet as in Codex:
 *   - waving  → greeting / first awake (Codex "first-awake")
 *   - running → Claude is mid tool-call, actively working (Codex "isLoading")
 *   - waiting → blocked on the user: permission or idle prompt (Codex "warning")
 *   - failed  → StopFailure or hard error (Codex "danger")
 *   - review  → turn finished, output ready to read (Codex "success")
 *   - idle    → fallback / SessionEnd (Codex "info")
 *
 * Note: "jumping" is reserved for the hover gesture and "running-left/right"
 * for drag locomotion — both are driven by the renderer, never emitted here.
 */
export function mapEventToAdvice(e: HookEvent): StateAdvice | null {
  switch (e.event) {
    case "SessionStart":
      return { state: "waving", text: "Claude is ready.", holdMs: 2500 };
    case "PreToolUse":
      return {
        state: "running",
        text: e.tool_name ? `Running ${e.tool_name}…` : "Working…",
        holdMs: 0, // sticky until PostToolUse / Stop
      };
    case "PostToolUse":
      // Don't change state on every PostToolUse — the next PreToolUse or Stop
      // will handle the transition. Return null to leave state as-is.
      return null;
    case "Notification": {
      const t = e.notification_type;
      if (t === "permission_prompt") {
        return { state: "waiting", text: "Needs your permission.", holdMs: 0 };
      }
      if (t === "idle_prompt") {
        return { state: "waiting", text: "Waiting on you.", holdMs: 0 };
      }
      return { state: "review", text: e.message || "Heads up.", holdMs: 4000 };
    }
    case "Stop":
      return { state: "review", text: "Done — your turn.", holdMs: 0 };
    case "StopFailure":
      return {
        state: "failed",
        text: e.error_type ? `Error: ${e.error_type}` : "Something failed.",
        holdMs: 0,
      };
    case "SessionEnd":
      return { state: "idle", text: "Session ended.", holdMs: 3000 };
  }
  return null;
}
