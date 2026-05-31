import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { EventTail } from "./eventTail";
import { mapEventToAdvice } from "./stateMapper";
import { focusSession } from "./focusTerminal";
import { listPets, importPet, LoadedPet } from "./petLoader";
import { loadSettings, saveSettings, AppSettings } from "./settings";
import type { HookEvent, StateAdvice } from "../shared/types";

const BUILTINS_DIR = path.join(__dirname, "..", "..", "assets", "pets");

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
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    { label: "Reveal events log", click: revealEventLog },
    { type: "separator" },
    { label: "Quit Claude Pet", click: () => app.quit() },
  ];
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
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
ipcMain.handle("win:getpos", () => petWindow?.getPosition() ?? [0, 0]);
let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
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

  petWindow?.webContents.once("did-finish-load", () => {
    if (currentPet) petWindow!.webContents.send("pet:load", serializePet(currentPet));
  });
});

// Keep the app alive in the tray after the pet/settings windows close. The
// mere presence of this handler (which does not call app.quit()) is what keeps
// the process running — there is no default-quit to prevent here.
app.on("window-all-closed", () => {
  /* intentionally empty: live in the tray */
});
