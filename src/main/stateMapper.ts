import type { HookEvent, StateAdvice } from "../shared/types";

/**
 * Translate a Claude Code hook event into a pet animation + speech bubble.
 *
 * Mapping rationale (matches petdex semantics):
 *   - run    → Claude is mid-tool-call (working)
 *   - review → MCP/permission prompt waiting on the user
 *   - wave   → turn finished cleanly, awaiting next prompt
 *   - failed → StopFailure or hard error
 *   - jump   → SessionStart greeting
 *   - idle   → fallback / SessionEnd
 */
export function mapEventToAdvice(e: HookEvent): StateAdvice | null {
  switch (e.event) {
    case "SessionStart":
      return { state: "jump", text: "Claude is ready.", holdMs: 2500 };
    case "PreToolUse":
      return {
        state: "run",
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
        return { state: "review", text: "Needs your permission.", holdMs: 0 };
      }
      if (t === "idle_prompt") {
        return { state: "wave", text: "Waiting on you.", holdMs: 0 };
      }
      return { state: "review", text: e.message || "Heads up.", holdMs: 4000 };
    }
    case "Stop":
      return { state: "wave", text: "Done — your turn.", holdMs: 0 };
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
