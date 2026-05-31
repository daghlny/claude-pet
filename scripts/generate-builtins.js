#!/usr/bin/env node
/**
 * Generate built-in pet sprite sheets.
 *
 * petdex format: 8 rows × 9 columns, each cell 192×208, transparent PNG.
 * Row order: idle, wave, run, failed, review, jump, extra1, extra2.
 *
 * We emit deliberately simple, readable pixel-art pets — they need to be
 * recognizable at small scales without an artist in the loop. Two pets:
 *   - "blob": a friendly blob that squashes/stretches
 *   - "cube": a tiny robot cube with antenna and led
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const FRAME_W = 192;
const FRAME_H = 208;
const COLS = 9;
const ROWS = 8;
const SHEET_W = FRAME_W * COLS;
const SHEET_H = FRAME_H * ROWS;
const STATES = ["idle", "wave", "run", "failed", "review", "jump", "extra1", "extra2"];

function makeSheet() {
  const png = new PNG({ width: SHEET_W, height: SHEET_H });
  png.data.fill(0);
  return png;
}

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = a;
}

function fillRect(png, x, y, w, h, r, g, b, a = 255) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(png, x + dx, y + dy, r, g, b, a);
    }
  }
}

function fillEllipse(png, cx, cy, rx, ry, r, g, b, a = 255) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) {
        setPixel(png, cx + x, cy + y, r, g, b, a);
      }
    }
  }
}

// Frame origin helpers
function originX(col) { return col * FRAME_W; }
function originY(row) { return row * FRAME_H; }

// ---- Pet: BLOB ----------------------------------------------------------
// State-specific palette + body shape mods.
function blobBodyColor(state) {
  switch (state) {
    case "failed": return [220, 80, 80];
    case "review": return [240, 200, 60];
    case "wave":   return [120, 200, 140];
    case "run":    return [120, 180, 240];
    case "jump":   return [180, 140, 240];
    default:       return [140, 200, 220];
  }
}

function drawBlobFrame(png, row, col, state, frame) {
  const ox = originX(col);
  const oy = originY(row);
  const t = frame / 6; // 0..1 across loop
  const wobble = Math.sin(t * Math.PI * 2);
  const [br, bg, bb] = blobBodyColor(state);

  // Ground shadow.
  fillEllipse(png, ox + FRAME_W / 2, oy + FRAME_H - 16, 56, 8, 0, 0, 0, 80);

  // Body: ellipse that squashes on wobble.
  const bodyCx = ox + FRAME_W / 2 + Math.round(wobble * (state === "run" ? 10 : 2));
  const bodyCy = oy + FRAME_H - 60 - (state === "jump" ? Math.round(Math.abs(wobble) * 30) : 0);
  const rx = 50 + Math.round(wobble * 4);
  const ry = 44 - Math.round(wobble * 4);
  fillEllipse(png, bodyCx, bodyCy, rx, ry, br, bg, bb);
  // Highlight.
  fillEllipse(png, bodyCx - 18, bodyCy - 14, 10, 6, 255, 255, 255, 160);

  // Eyes.
  const eyeY = bodyCy - 8;
  const blink = state === "idle" && frame === 3 ? 1 : 5;
  fillEllipse(png, bodyCx - 14, eyeY, 4, blink, 20, 20, 30);
  fillEllipse(png, bodyCx + 14, eyeY, 4, blink, 20, 20, 30);

  // Mouth varies by state.
  if (state === "failed") {
    // frown
    for (let i = -8; i <= 8; i++) {
      setPixel(png, bodyCx + i, bodyCy + 12 + Math.round((i * i) / 16), 40, 20, 20);
      setPixel(png, bodyCx + i, bodyCy + 13 + Math.round((i * i) / 16), 40, 20, 20);
    }
  } else if (state === "wave" || state === "jump") {
    // open smile
    fillEllipse(png, bodyCx, bodyCy + 14, 10, 5, 40, 20, 20);
  } else {
    // simple smile
    for (let i = -8; i <= 8; i++) {
      setPixel(png, bodyCx + i, bodyCy + 12 - Math.round((i * i) / 24), 40, 20, 20);
    }
  }

  // Wave arm during 'wave'/'review'.
  if (state === "wave" || state === "review") {
    const armX = bodyCx + rx - 4;
    const armY = bodyCy - 20 - Math.round(wobble * 6);
    fillRect(png, armX, armY, 10, 22, br, bg, bb);
    fillEllipse(png, armX + 5, armY, 8, 8, br, bg, bb);
  }

  // Exclamation mark above for review.
  if (state === "review") {
    fillRect(png, bodyCx - 2, bodyCy - 56, 4, 16, 220, 60, 60);
    fillRect(png, bodyCx - 2, bodyCy - 36, 4, 4, 220, 60, 60);
  }

  // Running dust puffs.
  if (state === "run") {
    fillEllipse(png, ox + 30 + (frame * 18) % FRAME_W, oy + FRAME_H - 18, 4, 2, 200, 200, 200, 200);
  }
}

// ---- Pet: CUBE ----------------------------------------------------------
function cubeBodyColor(state) {
  switch (state) {
    case "failed": return [180, 60, 60];
    case "review": return [200, 170, 50];
    case "wave":   return [80, 180, 120];
    case "run":    return [70, 140, 210];
    case "jump":   return [150, 110, 220];
    default:       return [120, 130, 150];
  }
}

function drawCubeFrame(png, row, col, state, frame) {
  const ox = originX(col);
  const oy = originY(row);
  const t = frame / 6;
  const bob = Math.round(Math.sin(t * Math.PI * 2) * 4);
  const [br, bg, bb] = cubeBodyColor(state);

  fillEllipse(png, ox + FRAME_W / 2, oy + FRAME_H - 16, 50, 7, 0, 0, 0, 70);

  const bodyX = ox + FRAME_W / 2 - 40;
  const bodyY = oy + FRAME_H - 110 + bob - (state === "jump" ? Math.abs(bob) * 4 : 0);
  // Body cube.
  fillRect(png, bodyX, bodyY, 80, 70, br, bg, bb);
  // Bevels.
  fillRect(png, bodyX, bodyY, 80, 4, 255, 255, 255, 80);
  fillRect(png, bodyX, bodyY + 66, 80, 4, 0, 0, 0, 80);

  // LED — color by state.
  const ledColor = state === "failed" ? [255, 80, 80] :
                   state === "review" ? [255, 220, 80] :
                   state === "wave"   ? [120, 240, 160] :
                   state === "run"    ? [120, 200, 255] :
                                        [120, 200, 255];
  const ledOn = state === "idle" ? (frame % 4 < 2) : true;
  if (ledOn) {
    fillEllipse(png, bodyX + 40, bodyY + 20, 6, 6, ledColor[0], ledColor[1], ledColor[2]);
  }

  // Eyes — two glowing rects.
  const eyeColor = state === "failed" ? [255, 100, 100] : [220, 240, 255];
  fillRect(png, bodyX + 20, bodyY + 36, 12, 6, eyeColor[0], eyeColor[1], eyeColor[2]);
  fillRect(png, bodyX + 48, bodyY + 36, 12, 6, eyeColor[0], eyeColor[1], eyeColor[2]);

  // Antenna.
  fillRect(png, bodyX + 38, bodyY - 14, 4, 14, 60, 60, 70);
  fillEllipse(png, bodyX + 40, bodyY - 16, 5, 5, ledColor[0], ledColor[1], ledColor[2]);

  // Tiny feet swap during run.
  const footY = bodyY + 70;
  if (state === "run") {
    const swing = frame % 2 === 0 ? 0 : 6;
    fillRect(png, bodyX + 12, footY + swing, 18, 6, 40, 40, 50);
    fillRect(png, bodyX + 50, footY + (6 - swing), 18, 6, 40, 40, 50);
  } else {
    fillRect(png, bodyX + 12, footY, 18, 6, 40, 40, 50);
    fillRect(png, bodyX + 50, footY, 18, 6, 40, 40, 50);
  }

  if (state === "review") {
    fillRect(png, bodyX + 38, bodyY - 36, 4, 14, 220, 60, 60);
    fillRect(png, bodyX + 38, bodyY - 20, 4, 4, 220, 60, 60);
  }
  if (state === "wave") {
    const armX = bodyX + 76;
    const armY = bodyY + 8 + bob;
    fillRect(png, armX, armY, 10, 24, br, bg, bb);
    fillEllipse(png, armX + 5, armY, 7, 7, br, bg, bb);
  }
}

function buildPet(name, slug, drawFn) {
  const png = makeSheet();
  for (let row = 0; row < ROWS; row++) {
    const state = STATES[row];
    for (let col = 0; col < COLS; col++) {
      drawFn(png, row, col, state, col);
    }
  }
  const outDir = path.join(__dirname, "..", "assets", "pets", slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "pet.json"),
    JSON.stringify({
      name,
      slug,
      kind: "builtin",
      tags: ["builtin"],
      frame: { w: FRAME_W, h: FRAME_H },
      grid: { cols: COLS, rows: ROWS },
      spritesheet: "spritesheet.png",
    }, null, 2),
  );
  const buf = PNG.sync.write(png);
  fs.writeFileSync(path.join(outDir, "spritesheet.png"), buf);
  console.log(`built ${slug} → ${outDir}`);
}

buildPet("Blob",  "blob",  drawBlobFrame);
buildPet("Cube",  "cube",  drawCubeFrame);
