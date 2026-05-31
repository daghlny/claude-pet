export type PetState =
  | "idle"
  | "wave"
  | "run"
  | "failed"
  | "review"
  | "jump"
  | "extra1"
  | "extra2";

export const PET_STATE_ROWS: PetState[] = [
  "idle",
  "wave",
  "run",
  "failed",
  "review",
  "jump",
  "extra1",
  "extra2",
];

export const FRAME_W = 192;
export const FRAME_H = 208;
export const GRID_COLS = 9;
export const GRID_ROWS = 8;

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
