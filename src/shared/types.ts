// Animation-state vocabulary. These names match the Codex desktop pet exactly
// (its atlas defines one row per state), so codex-pets.net packs animate the
// same way under claude-pet as they do in the Codex app. The renderer owns the
// transient states (running-left/right while dragging, jumping while hovered);
// the main process only ever pushes the event-driven base states.
export type PetState =
  | "idle"
  | "running" // active work (not foot-running) — Claude is mid tool-call
  | "running-left" // drag-left locomotion (renderer-driven)
  | "running-right" // drag-right locomotion (renderer-driven)
  | "waving" // greeting / first awake
  | "jumping" // hover gesture (renderer-driven)
  | "waiting" // blocked on the user (permission / idle prompt)
  | "failed" // error
  | "review"; // finished a turn / has output to read

// Codex atlas row order (8 cols × 9 rows). The renderer maps a PetState to one
// of these rows for codex-format packs; our built-ins use a smaller layout and
// have their own mapping (see renderer).
export const PET_STATE_ROWS: PetState[] = [
  "idle", // 0
  "running-right", // 1
  "running-left", // 2
  "waving", // 3
  "jumping", // 4
  "failed", // 5
  "waiting", // 6
  "running", // 7
  "review", // 8
];

export const FRAME_W = 192;
export const FRAME_H = 208;
// Codex packs (the default source) are 8 columns × 9 rows. Built-ins are 9×8;
// the renderer auto-detects the real grid from the spritesheet either way.
export const GRID_COLS = 8;
export const GRID_ROWS = 9;

/** petdex-compatible manifest. Extra fields are tolerated. */
export interface PetManifest {
  name: string;
  slug: string;
  kind?: string;
  tags?: string[];
  vibes?: string[];
  spritesheet?: string; // optional override; defaults to spritesheet.webp/png
  frame?: { w: number; h: number };
  grid?: { cols: number; rows: number };
  /** Optional per-state frame counts (defaults to 6). */
  frames?: Partial<Record<PetState, number>>;
  /** Optional per-state loop duration ms (defaults to 1100). */
  durations?: Partial<Record<PetState, number>>;
}

/** A single hook event written to events.jsonl by the shell hook. */
export interface HookEvent {
  ts: number;
  event:
    | "SessionStart"
    | "PreToolUse"
    | "PostToolUse"
    | "Stop"
    | "StopFailure"
    | "Notification"
    | "SessionEnd";
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
  notification_type?: string;
  error_type?: string;
  message?: string;
  /** macOS-specific: parent terminal info captured by the hook script. */
  terminal?: {
    app?: string; // "Terminal", "iTerm2", "WezTerm", "Ghostty", "Alacritty", ...
    tty?: string; // e.g. /dev/ttys003
    pid?: number; // parent shell pid
  };
}

/** Mapping from event → pet animation + speech bubble text. */
export interface StateAdvice {
  state: PetState;
  text?: string;
  /** ms to hold this state before reverting to idle. 0 = sticky. */
  holdMs: number;
}
