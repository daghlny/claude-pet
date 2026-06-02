import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { EventTail } from "./eventTail";
import { mapEventToAdvice } from "./stateMapper";
import { focusSession } from "./focusTerminal";
import { listPets, importPet, LoadedPet } from "./petLoader";
import { loadSettings, saveSettings, settingsFilePath, AppSettings } from "./settings";
import type { HookEvent, StateAdvice } from "../shared/types";

const BUILTINS_DIR = path.join(__dirname, "..", "..", "assets", "pets");

// setIgnoreMouseEvents' `forward` option (needed so the renderer keeps getting
// mousemove while the window ignores the mouse) is documented macOS/Windows
// only. Per-pixel click-through is gated to these; the renderer mirrors this.
const CLICK_THROUGH_CAPABLE = process.platform === "darwin" || process.platform === "win32";

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let tail: EventTail | null = null;
let settings: AppSettings = loadSettings();
let currentPet: LoadedPet | null = null;
/** Last event that triggered a non-null state advice — used by click→focus. */
let lastFocusableEvent: HookEvent | undefined;

function petSize(): { w: number; h: number } {
  const f = currentPet?.manifest.frame ?? { w: 192, h: 208 };
  return { w: Math.round(f.w * settings.scale), h: Math.round(f.h * settings.scale) };
}

function createPetWindow() {
  const { w, h } = petSize();
  const display = screen.getPrimaryDisplay().workArea;
  const pos = settings.position ?? {
    x: display.x + display.width - w - 24,
    y: display.y + display.height - h - 24,
  };

  petWindow = new BrowserWindow({
    width: w,
    height: h + 60, // extra room for speech bubble
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    movable: true,
    // macOS: make it a non-activating NSPanel. A panel floats over other apps'
    // fullscreen spaces and never steals key focus — the correct primitive for
    // a desktop pet. (This is how Codex's own mascot window is created.)
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    // We're already an accessory app (app.dock.hide() runs before this), so
    // this suppresses the brief dock/process-type flip macOS would otherwise
    // do when the window joins all workspaces.
    skipTransformProcessType: true,
  });
  // Per-pixel click-through. Start out ignoring the mouse; the renderer flips
  // the window back to interactive only while the cursor is over an opaque
  // sprite pixel (see pet.ts). forward:true keeps mousemove/mouseleave flowing
  // so the renderer can hit-test. Net effect: transparent margins and the
  // bubble strip pass clicks through to whatever is behind the pet, while the
  // body stays draggable/clickable.
  // Only on platforms where `forward` is supported (macOS/Windows). On Linux
  // forwarding doesn't work, so we'd never detect the cursor re-entering and
  // the pet would get stuck click-through — there we leave it interactive and
  // rely on ghost mode for explicit pass-through.
  if (CLICK_THROUGH_CAPABLE) petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(path.join(__dirname, "..", "renderer", "pet.html"));

  petWindow.on("moved", () => {
    if (!petWindow) return;
    const [x, y] = petWindow.getPosition();
    settings.position = { x, y };
    saveSettings(settings);
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 480,
    title: "Claude Pet",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, "..", "renderer", "settings.html"));
  settingsWindow.on("closed", () => (settingsWindow = null));
}

function buildTray() {
  // No icon asset yet — use an empty image and rely on the title glyph.
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🐾");
  refreshTrayMenu();
}

function menuTemplate(): Electron.MenuItemConstructorOptions[] {
  const pets = listPets(BUILTINS_DIR);
  const petItems = pets.map((p) => ({
    label: `${p.manifest.name} (${p.manifest.slug})`,
    type: "radio" as const,
    checked: p.manifest.slug === settings.petSlug,
    click: () => switchPet(p.manifest.slug),
  }));
  return [
    { label: "Claude Pet", enabled: false },
    { type: "separator" },
    { label: "Pets", submenu: petItems.length ? petItems : [{ label: "(none)", enabled: false }] },
    { label: "Settings…", click: createSettingsWindow },
    {
      label: "Click-through (ghost mode)",
      type: "checkbox" as const,
      checked: !!settings.clickThrough,
      click: () => toggleClickThrough(),
    },
    { label: "Reveal events log", click: revealEventLog },
    { type: "separator" },
    { label: "Quit Claude Pet", click: () => app.quit() },
  ];
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

/** Push the current ghost-mode flag to every window that cares: the pet (which
 *  acts on it) and an open settings window (so its checkbox stays in sync). */
function broadcastGhost() {
  const on = !!settings.clickThrough;
  petWindow?.webContents.send("pet:ghost", on);
  settingsWindow?.webContents.send("pet:ghost", on);
}

/** Flip "ghost mode" on/off: persist, tell the renderer, refresh the menu tick.
 *  The actual setIgnoreMouseEvents call is driven by the renderer's hit-test so
 *  the two passthrough modes (per-pixel vs. full) share one code path. */
function toggleClickThrough() {
  settings.clickThrough = !settings.clickThrough;
  saveSettings(settings);
  broadcastGhost();
  refreshTrayMenu();
}

function revealEventLog() {
  const p = path.join(
    process.env.CLAUDE_PET_HOME || path.join(require("os").homedir(), ".claude-pet"),
    "events.jsonl",
  );
  if (fs.existsSync(p)) require("electron").shell.showItemInFolder(p);
}

function switchPet(slug: string) {
  const pets = listPets(BUILTINS_DIR);
  const next = pets.find((p) => p.manifest.slug === slug) ?? pets[0];
  if (!next) return;
  currentPet = next;
  settings.petSlug = next.manifest.slug;
  saveSettings(settings);
  if (petWindow) {
    const { w, h } = petSize();
    petWindow.setSize(w, h + 60);
    petWindow.webContents.send("pet:load", serializePet(next));
  }
  refreshTrayMenu();
}

function serializePet(p: LoadedPet) {
  return {
    manifest: p.manifest,
    spritesheetUrl: `file://${p.spritesheetPath}`,
    scale: settings.scale,
  };
}

/**
 * Watch settings.json for external edits (e.g. `claude-pet switch <name>` or
 * `claude-pet import <name>` from the CLI) and apply pet/scale changes live.
 * Our own saveSettings() writes here too, but switchPet() leaves petSlug equal
 * to what we just set, so the reload below no-ops — no write loop.
 */
function startSettingsWatcher() {
  const p = settingsFilePath();
  const dir = path.dirname(p);
  const base = path.basename(p);
  try {
    // Watch the directory, not the file: settings.json may not exist yet on a
    // fresh install (loadSettings creates the dir but not the file), and
    // editors/CLIs that replace-on-save would break a file-level watch. Filter
    // to our file so the busy events.jsonl in the same dir doesn't wake us.
    fs.watch(dir, { persistent: false }, (_evt, filename) => {
      if (filename && filename !== base) return;
      // Debounce: editors/writes can fire multiple events.
      if (settingsWatchTimer) clearTimeout(settingsWatchTimer);
      settingsWatchTimer = setTimeout(applyExternalSettings, 150);
    });
  } catch (e) {
    console.warn("[claude-pet] settings watch unavailable:", (e as Error).message);
  }
}

function applyExternalSettings() {
  let next: AppSettings;
  try {
    next = loadSettings();
  } catch {
    return;
  }
  if (next.petSlug !== settings.petSlug) {
    switchPet(next.petSlug); // updates settings, window, tray
  }
  if (typeof next.scale === "number" && next.scale !== settings.scale) {
    settings.scale = next.scale;
    if (petWindow) {
      const { w, h } = petSize();
      petWindow.setSize(w, h + 60);
      petWindow.webContents.send("pet:scale", settings.scale);
    }
  }
  if (!!next.clickThrough !== !!settings.clickThrough) {
    settings.clickThrough = !!next.clickThrough;
    broadcastGhost();
    refreshTrayMenu();
  }
}

function startEventLoop() {
  tail = new EventTail();
  tail.on("event", (evt: HookEvent) => {
    const advice: StateAdvice | null = mapEventToAdvice(evt);
    if (!advice) return;
    lastFocusableEvent = evt;
    petWindow?.webContents.send("pet:state", advice);
  });
  tail.start();
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:save", (_e, next: Partial<AppSettings>) => {
  settings = { ...settings, ...next };
  saveSettings(settings);
  if (typeof next.scale === "number" && petWindow) {
    const { w, h } = petSize();
    petWindow.setSize(w, h + 60);
    petWindow.webContents.send("pet:scale", settings.scale);
  }
  if (typeof next.clickThrough === "boolean") {
    broadcastGhost();
    refreshTrayMenu();
  }
  return settings;
});
ipcMain.handle("pets:list", () => listPets(BUILTINS_DIR).map((p) => p.manifest));
ipcMain.handle("pets:current", () => (currentPet ? serializePet(currentPet) : null));
ipcMain.handle("pets:switch", (_e, slug: string) => {
  switchPet(slug);
  return true;
});
ipcMain.handle("pets:import", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Choose a pet folder (must contain pet.json)",
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const dest = importPet(r.filePaths[0]);
    refreshTrayMenu();
    return { ok: true, dest };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});
ipcMain.on("pet:click", async () => {
  const used = await focusSession(lastFocusableEvent);
  console.log("[claude-pet] focus strategy:", used);
});
ipcMain.on("pet:contextmenu", () => {
  if (!petWindow) return;
  Menu.buildFromTemplate(menuTemplate()).popup({ window: petWindow });
});
// Renderer drives per-pixel passthrough: ignore the mouse over transparent
// areas (forward:true so we still get mousemove to detect re-entry), capture
// it over the sprite body. See pet.ts.
ipcMain.on("pet:ignoreMouse", (_e, ignore: boolean) => {
  if (!petWindow) return;
  if (ignore) petWindow.setIgnoreMouseEvents(true, { forward: true });
  else petWindow.setIgnoreMouseEvents(false);
});
ipcMain.handle("win:getpos", () => petWindow?.getPosition() ?? [0, 0]);
let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
let settingsWatchTimer: ReturnType<typeof setTimeout> | null = null;
ipcMain.on("win:move", (_e, x: number, y: number) => {
  const rx = Math.round(x);
  const ry = Math.round(y);
  petWindow?.setPosition(rx, ry);
  settings.position = { x: rx, y: ry };
  // Programmatic setPosition doesn't reliably fire the window "moved" event on
  // macOS, so persist here. Debounce to avoid hammering disk during a drag.
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => saveSettings(settings), 400);
});

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  // Pick initial pet.
  const pets = listPets(BUILTINS_DIR);
  currentPet = pets.find((p) => p.manifest.slug === settings.petSlug) ?? pets[0] ?? null;
  buildTray();
  createPetWindow();
  startEventLoop();
  startSettingsWatcher();

  petWindow?.webContents.once("did-finish-load", () => {
    if (currentPet) petWindow!.webContents.send("pet:load", serializePet(currentPet));
    petWindow!.webContents.send("pet:ghost", !!settings.clickThrough);
  });
});

// Keep the app alive in the tray after the pet/settings windows close. The
// mere presence of this handler (which does not call app.quit()) is what keeps
// the process running — there is no default-quit to prevent here.
app.on("window-all-closed", () => {
  /* intentionally empty: live in the tray */
});
