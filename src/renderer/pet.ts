// Pet renderer. Pure DOM/canvas — no framework. Driven by IPC from main.
// Avoids any module-level `import`/`export` — tsc would emit CJS `exports`
// references that browser <script> tags can't resolve.
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

const STATE_ROWS = ["idle", "wave", "run", "failed", "review", "jump", "extra1", "extra2"];

const canvas = document.getElementById("pet") as HTMLCanvasElement;
// willReadFrequently: the click-through hit-test reads 1px of alpha per
// mousemove (see isOverPet). The sprite is tiny and animates slowly, so a
// CPU-backed canvas is fine and this avoids Chromium's readback warning.
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const bubble = document.getElementById("bubble") as HTMLDivElement;

let sheet: HTMLImageElement | null = null;
let manifest: any = null;
let scale = 0.5;
let currentState = "idle";
let frameIdx = 0;
let lastFrameMs = 0;
let stateTimeout: ReturnType<typeof setTimeout> | null = null;
let bubbleTimeout: ReturnType<typeof setTimeout> | null = null;

// Grid is auto-detected from the spritesheet's true pixel size (see onLoad),
// because packs differ: codex packs are 8 cols × 9 rows, our built-ins are
// 9 cols × 8 rows. Hardcoding either one mis-slices frames and makes the
// animation cycle too fast / read across cell boundaries.
let detectedCols = 0;
let detectedRows = 0;
// Per-row count of frames that actually contain pixels. The grid width is an
// upper bound, not the animation length: codex packs are 8 columns wide but
// most rows only use ~6 frames, leaving the trailing cells transparent. If we
// cycled across the full column count the pet would blink out of existence on
// those empty frames (and, at the right edge, slice past the sheet entirely).
// Computed by scanning the sheet in onLoad.
let rowFrameCounts: number[] = [];
const DEFAULT_FRAME_MS = 220; // calm cadence ≈ codex; ~1.8s for an 8-frame loop

function frameW() { return manifest?.frame?.w ?? 192; }
function frameH() { return manifest?.frame?.h ?? 208; }
function frameCount(state: string): number {
  // Explicit per-state override wins.
  const explicit = manifest?.frames?.[state];
  if (typeof explicit === "number") return explicit;
  // Otherwise use the scanned per-row count, falling back to detected cols.
  const row = STATE_ROWS.indexOf(state);
  const scanned = row >= 0 ? rowFrameCounts[row] : 0;
  return scanned || detectedCols || 6;
}
function frameMs(state: string): number {
  const dur = manifest?.durations?.[state];
  if (typeof dur === "number") return dur / frameCount(state);
  return DEFAULT_FRAME_MS;
}

function resize() {
  canvas.width = frameW();
  canvas.height = frameH();
  canvas.style.width = `${Math.round(frameW() * scale)}px`;
  canvas.style.height = `${Math.round(frameH() * scale)}px`;
}

function draw() {
  if (!sheet || !manifest) return;
  let row = STATE_ROWS.indexOf(currentState);
  if (row < 0) return;
  // Don't index past the sheet's real row count (packs with fewer rows).
  if (detectedRows && row >= detectedRows) row = 0;
  // Clamp the frame so a slice can never run off the right edge of the sheet
  // (which would draw nothing and make the pet vanish). frameIdx is also
  // wrapped in tick(), but guard here too since draw() runs on load/switch.
  const count = Math.max(1, frameCount(currentState));
  const idx = frameIdx % count;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    sheet,
    idx * frameW(),
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
  if (sheet && manifest) {
    const interval = frameMs(currentState);
    if (now - lastFrameMs >= interval) {
      frameIdx = (frameIdx + 1) % frameCount(currentState);
      lastFrameMs = now;
      draw();
      // The silhouette just changed — re-test clickability under the cursor.
      reevalPassthrough();
    }
  }
  requestAnimationFrame(tick);
}

function setState(state: string) {
  if (currentState === state) return;
  currentState = state;
  frameIdx = 0;
  lastFrameMs = 0;
  draw();
  reevalPassthrough(); // new state → new silhouette under the cursor
}

function showBubble(text: string, ms = 4000) {
  bubble.textContent = text;
  bubble.classList.add("show");
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = setTimeout(() => bubble.classList.remove("show"), ms);
}

cp.onLoad((p: LoadPayload) => {
  manifest = p.manifest;
  scale = p.scale;
  // Clear stale sheet/scan from the previous pet so a switch can never draw the
  // old sheet (or animate past the new one) in the window before this image
  // decodes.
  sheet = null;
  rowFrameCounts = [];
  frameIdx = 0;
  resize();
  const img = new Image();
  img.onload = () => {
    detectedCols = Math.max(1, Math.round(img.naturalWidth / frameW()));
    detectedRows = Math.max(1, Math.round(img.naturalHeight / frameH()));
    rowFrameCounts = scanRowFrameCounts(img, detectedCols, detectedRows);
    sheet = img;
    frameIdx = 0;
    draw();
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
  setState(s.state);
  if (s.text) showBubble(s.text, s.holdMs > 0 ? s.holdMs : 6000);
  if (stateTimeout) clearTimeout(stateTimeout);
  if (s.holdMs > 0) {
    stateTimeout = setTimeout(() => setState("idle"), s.holdMs);
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
const DRAG_THRESHOLD = 4;

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
  const pos = await cp.getWinPos();
  baseX = pos[0];
  baseY = pos[1];
  e.preventDefault();
});

// Right-click anywhere on the pet → native context menu (Settings / Quit / …).
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  dragging = false;
  cp.contextMenu();
});

window.addEventListener("mousemove", (e) => {
  if (dragging) {
    const dx = e.screenX - startSX;
    const dy = e.screenY - startSY;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    if (moved) cp.moveWin(baseX + dx, baseY + dy);
    return;
  }
  // Not dragging: record the cursor and drive click-through from the pixel
  // under it. (On platforms without per-pixel support we just track position.)
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  haveCursor = true;
  if (PER_PIXEL) setInteractive(isOverPet(e.clientX, e.clientY));
});

// Cursor left the window entirely → back to pass-through. (forward:true makes
// mouseleave fire even while the window is ignoring the mouse.) Listen on
// <html>, which fills the window — mouseleave on `document` is unreliable.
document.documentElement.addEventListener("mouseleave", () => {
  haveCursor = false;
  if (PER_PIXEL && !dragging) setInteractive(false);
});

window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  if (!moved) cp.click(); // a tap, not a drag → jump to terminal
  // Re-evaluate pass-through at the release point so we don't stay glued
  // interactive if the drag ended over a transparent area.
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  haveCursor = true;
  if (PER_PIXEL) setInteractive(isOverPet(e.clientX, e.clientY));
});

requestAnimationFrame(tick);
