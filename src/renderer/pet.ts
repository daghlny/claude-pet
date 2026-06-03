// Pet renderer. Pure DOM/canvas — no framework. Driven by IPC from main.
// Avoids any module-level `import`/`export` — tsc would emit CJS `exports`
// references that browser <script> tags can't resolve.
//
// The animation engine is a faithful port of the Codex desktop pet's avatar
// engine (reverse-engineered from Codex.app's webview):
//   - codex packs are an 8-col × 9-row atlas with one row per state, in a fixed
//     order (idle, running-right, running-left, waving, jumping, failed,
//     waiting, running, review). We address rows by that vocabulary.
//   - the idle loop uses uneven per-frame timing (a calm breathe + blink) and
//     plays 6× slower than its keyframes.
//   - a transient state plays its strip three times and then settles into the
//     idle loop, rather than looping forever.
//   - hovering the pet plays the "jumping" gesture; dragging it plays
//     "running-right"/"running-left" depending on travel direction.
// Our built-in packs use a smaller 9×8 layout, so they get a compatibility row
// map and a plain continuous loop (their art is drawn as continuous loops).
export {};
const cp = (window as unknown as { claudePet: any }).claudePet;

interface LoadPayload {
  manifest: any;
  spritesheetUrl: string;
  scale: number;
}
interface StatePayload {
  state: string;
  text?: string;
  holdMs: number;
}

type State =
  | "idle"
  | "running"
  | "running-left"
  | "running-right"
  | "waving"
  | "jumping"
  | "waiting"
  | "failed"
  | "review";

// Codex atlas (8 cols × 9 rows) — the row order shipped by codex-pets.net packs
// and by the Codex app itself.
const CODEX_ROW: Record<State, number> = {
  idle: 0,
  "running-right": 1,
  "running-left": 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};

// Our built-in atlas (9 cols × 8 rows) has a smaller row set:
//   idle, waving, running, failed, review, jumping, extra1, extra2
// Map the richer Codex vocabulary onto the rows the built-ins actually have.
const BUILTIN_ROW: Record<State, number> = {
  idle: 0,
  waving: 1,
  running: 2,
  "running-left": 2,
  "running-right": 2,
  failed: 3,
  review: 4,
  waiting: 4,
  jumping: 5,
};

// Legacy/loose state names that might arrive from older mappers.
const ALIAS: Record<string, State> = {
  wave: "waving",
  run: "running",
  jump: "jumping",
};
function asState(s: string): State {
  return (ALIAS[s] ?? s) as State;
}

type Frame = { col: number; row: number; ms: number };
type Seq = { frames: Frame[]; loop: number | null };

const IDLE_SLOWDOWN = 6; // Codex plays the idle loop 6× slower than its keyframes.
// Idle keyframes (codex idle row): uneven timing → a calm breathe + blink.
const IDLE_KEYS: Array<[number, number]> = [
  [0, 280],
  [1, 110],
  [2, 110],
  [3, 140],
  [4, 140],
  [5, 320],
];
// Per-state strip params for the codex layout: [normalMs, lastFrameMs, count].
// Verbatim from the Codex avatar engine.
const CODEX_STRIP: Partial<Record<State, [number, number, number]>> = {
  "running-right": [120, 220, 8],
  "running-left": [120, 220, 8],
  waving: [140, 280, 4],
  jumping: [140, 280, 5],
  failed: [140, 240, 8],
  waiting: [150, 260, 6],
  running: [120, 220, 6],
  review: [150, 280, 6],
};
const BUILTIN_FRAME_MS = 200; // calm uniform cadence for built-in continuous loops.

const canvas = document.getElementById("pet") as HTMLCanvasElement;
// willReadFrequently: the click-through hit-test reads 1px of alpha per
// mousemove (see isOverPet). The sprite is tiny and animates slowly, so a
// CPU-backed canvas is fine and this avoids Chromium's readback warning.
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const bubble = document.getElementById("bubble") as HTMLDivElement;

let sheet: HTMLImageElement | null = null;
let manifest: any = null;
let scale = 0.5;
let bubbleTimeout: ReturnType<typeof setTimeout> | null = null;
let stateTimeout: ReturnType<typeof setTimeout> | null = null;

// Grid is auto-detected from the spritesheet's true pixel size (see onLoad).
// codex packs are 8 cols × 9 rows; our built-ins are 9 cols × 8 rows.
let layout: "codex" | "builtin" = "codex";
let detectedCols = 0;
let detectedRows = 0;
// Per-row count of frames that actually contain pixels (used by the built-in
// layout, which derives its loop length from the art rather than a fixed spec).
let rowFrameCounts: number[] = [];
// Respect the OS "reduce motion" setting: hold a single static frame.
const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reduceMq.matches;

function frameW() { return manifest?.frame?.w ?? 192; }
function frameH() { return manifest?.frame?.h ?? 208; }

function resize() {
  canvas.width = frameW();
  canvas.height = frameH();
  canvas.style.width = `${Math.round(frameW() * scale)}px`;
  canvas.style.height = `${Math.round(frameH() * scale)}px`;
}

// --- Animation engine -------------------------------------------------------

function strip(row: number, count: number, normalMs: number, lastMs: number): Frame[] {
  const out: Frame[] = [];
  const n = Math.max(1, count);
  for (let c = 0; c < n; c++) out.push({ col: c, row, ms: c === n - 1 ? lastMs : normalMs });
  return out;
}

function idleFrames(row: number, slow: boolean): Frame[] {
  return IDLE_KEYS.map(([col, ms]) => ({ col, row, ms: slow ? ms * IDLE_SLOWDOWN : ms }));
}

/** Build the frame sequence for a state, mirroring the Codex engine. */
function compose(state: State): Seq {
  if (layout === "codex") {
    const idleRow = CODEX_ROW.idle;
    const def = CODEX_STRIP[state];
    const row = CODEX_ROW[state];
    // Reduced motion: hold a single static frame (the state's first frame).
    if (reducedMotion) {
      const ms = state === "idle" ? IDLE_KEYS[0][1] : def ? def[0] : 1000;
      return { frames: [{ col: 0, row, ms }], loop: null };
    }
    if (state === "idle") return { frames: idleFrames(idleRow, true), loop: 0 };
    if (!def) return { frames: [{ col: 0, row, ms: 1000 }], loop: null };
    const base = strip(row, def[2], def[0], def[1]);
    // Codex plays a transient state three times, then settles into the calm
    // idle loop (looping from where the appended idle frames begin).
    const seq = [...base, ...base, ...base];
    return { frames: [...seq, ...idleFrames(idleRow, true)], loop: seq.length };
  }
  // Built-in layout: rows are continuous-loop art, so just loop the row. A
  // pack may still pin a per-state frame count / loop duration in its manifest;
  // honor those, otherwise fall back to the scanned width and a calm cadence.
  const row = BUILTIN_ROW[state] ?? 0;
  const explicit = manifest?.frames?.[state];
  const count =
    (typeof explicit === "number" ? explicit : 0) || rowFrameCounts[row] || detectedCols || 6;
  if (reducedMotion) return { frames: [{ col: 0, row, ms: 1000 }], loop: null };
  const total = manifest?.durations?.[state];
  const ms = typeof total === "number" && count > 0 ? total / count : BUILTIN_FRAME_MS;
  return { frames: strip(row, count, ms, ms), loop: 0 };
}

let seq: Seq = { frames: [{ col: 0, row: 0, ms: 1000 }], loop: 0 };
let seqIndex = 0;
let nextAt = 0;
let playing: State | "" = "";

// The effective state is composed from three layers (highest priority first):
//   drag direction  >  hover  >  the event-driven base state.
let baseState: State = "idle";
let hovering = false;
let dragDir: State | null = null;

function effectiveState(): State {
  if (dragDir) return dragDir;
  if (hovering) return "jumping";
  return baseState;
}

/** Re-derive the playing state from the three layers and restart its sequence
 *  if it changed (matches Codex, whose animation effect only re-runs on a state
 *  change — so holding a hover replays the gesture once, not on a loop). */
function applyState() {
  const s = effectiveState();
  if (s === playing) return;
  playing = s;
  seq = compose(s);
  seqIndex = 0;
  nextAt = 0; // draw on the next tick
}

function drawFrame(f: Frame) {
  if (!sheet || !manifest) return;
  let row = f.row;
  if (detectedRows && row >= detectedRows) row = 0; // packs with fewer rows
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    sheet,
    f.col * frameW(),
    row * frameH(),
    frameW(),
    frameH(),
    0,
    0,
    frameW(),
    frameH(),
  );
}

function tick(now: number) {
  if (sheet && manifest && now >= nextAt) {
    const f = seq.frames[Math.min(seqIndex, seq.frames.length - 1)];
    drawFrame(f);
    // The visible frame just changed — re-test clickability under the cursor.
    reevalPassthrough();
    if (seqIndex + 1 < seq.frames.length) {
      nextAt = now + f.ms;
      seqIndex++;
    } else if (seq.loop != null) {
      nextAt = now + f.ms;
      seqIndex = seq.loop;
    } else {
      nextAt = Infinity; // hold the final frame (reduced motion / one-shot)
    }
  }
  requestAnimationFrame(tick);
}

function showBubble(text: string, ms = 4000) {
  bubble.textContent = text;
  bubble.classList.add("show");
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => bubble.classList.remove("show"), ms);
}

reduceMq.addEventListener("change", () => {
  reducedMotion = reduceMq.matches;
  playing = ""; // force a rebuild of the current sequence
  applyState();
});

cp.onLoad((p: LoadPayload) => {
  manifest = p.manifest;
  scale = p.scale;
  // Clear stale sheet/scan from the previous pet so a switch can never draw the
  // old sheet (or animate past the new one) before this image decodes.
  sheet = null;
  rowFrameCounts = [];
  resize();
  const img = new Image();
  img.onload = () => {
    detectedCols = Math.max(1, Math.round(img.naturalWidth / frameW()));
    detectedRows = Math.max(1, Math.round(img.naturalHeight / frameH()));
    // 8×9 → codex layout; anything else (our 9×8 built-ins) → built-in layout.
    layout = detectedCols === 8 && detectedRows >= 9 ? "codex" : "builtin";
    rowFrameCounts = scanRowFrameCounts(img, detectedCols, detectedRows);
    sheet = img;
    playing = ""; // force a rebuild against the new pack's layout
    applyState();
    reevalPassthrough(); // a different pack has a different silhouette
  };
  img.src = p.spritesheetUrl;
});

/** Count the trailing-non-empty frames per row. A frame counts as "used" if it
 *  has any non-transparent pixel; we take the highest used frame index + 1 so a
 *  gap in the middle still animates, but trailing empty cells are dropped. */
function scanRowFrameCounts(img: HTMLImageElement, cols: number, rows: number): number[] {
  const fw = frameW();
  const fh = frameH();
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return [];
  octx.drawImage(img, 0, 0);
  const counts: number[] = [];
  for (let r = 0; r < rows; r++) {
    let lastUsed = -1;
    for (let c = 0; c < cols; c++) {
      const data = octx.getImageData(c * fw, r * fh, fw, fh).data;
      let used = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) { used = true; break; }
      }
      if (used) lastUsed = c;
    }
    counts[r] = lastUsed + 1; // 0 if the whole row is empty
  }
  return counts;
}

cp.onScale((s: number) => { scale = s; resize(); reevalPassthrough(); });

cp.onState((s: StatePayload) => {
  baseState = asState(s.state);
  applyState();
  if (s.text) showBubble(s.text, s.holdMs > 0 ? s.holdMs : 6000);
  if (stateTimeout) clearTimeout(stateTimeout);
  if (s.holdMs > 0) {
    stateTimeout = setTimeout(() => {
      baseState = "idle";
      applyState();
    }, s.holdMs);
  }
});

// Manual drag: holding the pet moves the window; a click without movement
// (below the threshold) triggers the focus-session jump. We can't use
// -webkit-app-region:drag here because the pet must stay clickable.
let dragging = false;
let startSX = 0;
let startSY = 0;
let baseX = 0;
let baseY = 0;
let moved = false;
// Reference point for drag-direction detection. Updated each time travel since
// the last reference crosses the threshold, so the running-left/right facing
// tracks the most recent movement (matches Codex).
let dragRefX = 0;
let dragRefY = 0;
const DRAG_THRESHOLD = 4; // matches Codex's `nn`

// --- Per-pixel click-through ------------------------------------------------
// The window is created ignoring the mouse (main: setIgnoreMouseEvents true,
// forward:true), so forwarded mousemove events still reach us. We flip the
// window back to interactive only while the cursor sits over an opaque sprite
// pixel; transparent margins and the bubble strip therefore pass clicks
// through to whatever is behind the pet. "Ghost mode" forces full pass-through
// regardless of the pixel under the cursor.
//
// PER_PIXEL mirrors main: setIgnoreMouseEvents' `forward` is macOS/Windows
// only, so on other platforms the window stays interactive over its whole
// bounds and `interactive` starts true (matching main, which doesn't enable
// the initial pass-through there). Ghost mode still works everywhere because
// it's an explicit toggle, not dependent on detecting cursor re-entry.
const PER_PIXEL = cp.platform === "darwin" || cp.platform === "win32";
let ghostMode = false;
let interactive = !PER_PIXEL; // mirror of !ignoreMouseEvents, to avoid redundant IPC
// Last cursor position (window coords). The animation loop re-tests it when the
// frame changes so clickability follows the *visible* frame, not whichever
// frame happened to be showing at the last mousemove.
let lastClientX = 0;
let lastClientY = 0;
let haveCursor = false;

function setInteractive(v: boolean) {
  if (v === interactive) return;
  interactive = v;
  cp.setIgnoreMouse(!v);
}

function setHover(v: boolean) {
  if (v === hovering) return;
  hovering = v;
  applyState(); // hover → "jumping" gesture (unless a drag is in progress)
}

function isOverPet(clientX: number, clientY: number): boolean {
  if (ghostMode || !sheet) return false;
  const r = canvas.getBoundingClientRect();
  if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) {
    return false;
  }
  const cx = Math.floor(((clientX - r.left) / r.width) * canvas.width);
  const cy = Math.floor(((clientY - r.top) / r.height) * canvas.height);
  try {
    // Alpha of the currently-drawn frame at the cursor. >8 skips near-empty
    // antialiased edges so the hot zone hugs the visible body.
    return ctx.getImageData(cx, cy, 1, 1).data[3] > 8;
  } catch {
    return true; // if a readback ever fails, stay clickable rather than dead
  }
}

/** Re-derive click-through from the last known cursor position. Called on
 *  mousemove, on each new animation frame, and after resize/state changes so a
 *  stationary cursor over an animating edge can't get stuck un/clickable. */
function reevalPassthrough() {
  if (!PER_PIXEL || dragging || !haveCursor) return;
  setInteractive(isOverPet(lastClientX, lastClientY));
}

cp.onGhost((on: boolean) => {
  ghostMode = on;
  if (on) {
    // Abort any in-flight drag: once the window ignores the mouse, button-up is
    // never delivered, so a live drag would otherwise never end (pet stuck to
    // the cursor). Then drop to full pass-through.
    dragging = false;
    moved = false;
    dragDir = null;
    canvas.classList.remove("dragging");
    setHover(false);
    applyState();
    setInteractive(false);
  } else if (PER_PIXEL) {
    reevalPassthrough(); // back to per-pixel from the current cursor
  } else {
    setInteractive(true); // no per-pixel here → interactive over the bounds
  }
});

canvas.addEventListener("mousedown", async (e) => {
  if (e.button !== 0) return; // only left button drags; right opens the menu
  dragging = true;
  moved = false;
  startSX = e.screenX;
  startSY = e.screenY;
  dragRefX = e.screenX;
  dragRefY = e.screenY;
  dragDir = null; // no travel yet → hover gesture still shows
  canvas.classList.add("dragging"); // scale-down press feedback (matches Codex)
  applyState();
  const pos = await cp.getWinPos();
  baseX = pos[0];
  baseY = pos[1];
  e.preventDefault();
});

// Right-click anywhere on the pet → native context menu (Settings / Quit / …).
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  dragging = false;
  canvas.classList.remove("dragging");
  applyState();
  cp.contextMenu();
});

window.addEventListener("mousemove", (e) => {
  if (dragging) {
    // Direction: when travel since the last reference crosses the threshold on
    // either axis, update the reference and face the pet by the horizontal sign.
    const rx = e.screenX - dragRefX;
    const ry = e.screenY - dragRefY;
    if (Math.abs(rx) >= DRAG_THRESHOLD || Math.abs(ry) >= DRAG_THRESHOLD) {
      moved = true;
      dragRefX = e.screenX;
      dragRefY = e.screenY;
      const dir: State | null =
        rx >= DRAG_THRESHOLD ? "running-right" : rx <= -DRAG_THRESHOLD ? "running-left" : dragDir;
      if (dir !== dragDir) {
        dragDir = dir;
        applyState();
      }
    }
    if (moved) cp.moveWin(baseX + (e.screenX - startSX), baseY + (e.screenY - startSY));
    return;
  }
  // Not dragging: record the cursor and drive hover + click-through from the
  // pixel under it.
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  haveCursor = true;
  const over = isOverPet(e.clientX, e.clientY);
  setHover(over);
  if (PER_PIXEL) setInteractive(over);
});

// Cursor left the window entirely → drop hover and pass-through. (forward:true
// makes mouseleave fire even while the window is ignoring the mouse.) Listen on
// <html>, which fills the window — mouseleave on `document` is unreliable.
document.documentElement.addEventListener("mouseleave", () => {
  haveCursor = false;
  setHover(false);
  if (PER_PIXEL && !dragging) setInteractive(false);
});

window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove("dragging");
  const wasMoved = moved;
  dragDir = null;
  // Re-evaluate hover + pass-through at the release point.
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  haveCursor = true;
  const over = isOverPet(e.clientX, e.clientY);
  setHover(over);
  applyState(); // drag direction cleared → back to hover/base
  if (!wasMoved) cp.click(); // a tap, not a drag → jump to terminal
  if (PER_PIXEL) setInteractive(over);
});

requestAnimationFrame(tick);
