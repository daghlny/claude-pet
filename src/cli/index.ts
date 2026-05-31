#!/usr/bin/env node
/**
 * claude-pet CLI — install/uninstall Claude Code hooks, and import pet packs.
 *
 * Edits ~/.claude/settings.json by adding command-type hook entries that
 * invoke the bundled claude-pet-emit.sh, one per event of interest. Existing
 * unrelated hooks are preserved. Idempotent.
 *
 * `import` brings a petdex / codex-pets compatible pet pack into
 * ~/.claude-pet/pets/<slug>/ from a local folder, a local .zip, or a remote
 * .zip URL (e.g. a download from https://codex-pets.net/).
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync, spawn } from "child_process";
import { importPet } from "../main/petLoader";

const HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "StopFailure",
  "Notification",
  "SessionEnd",
];

const MARKER = "claude-pet";

interface HookSpec { type: "command"; command: string; args?: string[]; timeout?: number; }
interface HookEntry { matcher?: string; hooks: HookSpec[]; }
interface Settings { hooks?: Record<string, HookEntry[]>; [k: string]: unknown; }

function settingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function hookScriptPath(): string {
  // When installed via npm, this file is at <pkg>/dist/cli/index.js — the
  // shell script lives at <pkg>/hooks/claude-pet-emit.sh.
  return path.resolve(__dirname, "..", "..", "hooks", "claude-pet-emit.sh");
}

function loadSettings(): Settings {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function saveSettings(s: Settings) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Best-effort backup.
  if (fs.existsSync(p)) fs.copyFileSync(p, p + ".claude-pet.bak");
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

function install() {
  const script = hookScriptPath();
  if (!fs.existsSync(script)) {
    console.error(`hook script missing: ${script}`);
    process.exit(1);
  }
  try { fs.chmodSync(script, 0o755); } catch {}

  const s = loadSettings();
  s.hooks = s.hooks ?? {};
  for (const event of HOOK_EVENTS) {
    s.hooks[event] = (s.hooks[event] ?? []).filter(
      (entry) => !entry.hooks?.some((h) => h.command?.includes(MARKER)),
    );
    s.hooks[event].push({
      hooks: [{ type: "command", command: script, args: [event], timeout: 5 }],
    });
  }
  saveSettings(s);
  console.log(`✓ installed claude-pet hooks → ${settingsPath()}`);
  console.log(`  events: ${HOOK_EVENTS.join(", ")}`);
  console.log(`  script: ${script}`);
}

function uninstall() {
  const s = loadSettings();
  if (s.hooks) {
    for (const event of Object.keys(s.hooks)) {
      s.hooks[event] = (s.hooks[event] ?? []).filter(
        (entry) => !entry.hooks?.some((h) => h.command?.includes(MARKER)),
      );
      if (s.hooks[event].length === 0) delete s.hooks[event];
    }
    saveSettings(s);
  }
  // The off switch: also quit the running pet so nothing lingers.
  const wasRunning = stopApp(true);
  console.log("✓ removed claude-pet hooks" + (wasRunning ? " and stopped the app" : ""));
}

function status() {
  const s = loadSettings();
  const found: string[] = [];
  for (const event of HOOK_EVENTS) {
    const has = (s.hooks?.[event] ?? []).some((entry) =>
      entry.hooks?.some((h) => h.command?.includes(MARKER)),
    );
    if (has) found.push(event);
  }
  console.log(`hook script: ${hookScriptPath()}`);
  console.log(`settings:    ${settingsPath()}`);
  console.log(`installed:   ${found.length ? found.join(", ") : "(none)"}`);
  console.log(`app:         ${isAppRunning() ? "running" : "stopped"}`);
  const log = path.join(
    process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet"),
    "events.jsonl",
  );
  console.log(`event log:   ${log}${fs.existsSync(log) ? "" : " (not yet created)"}`);
}

function petHome(): string {
  return process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet");
}

/** App root = two levels up from dist/cli/index.js. Symlinks are resolved by
 *  Node, so this is correct whether run locally or via an `npm link`ed bin. */
function appRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function pidFile(): string {
  return path.join(petHome(), "app.pid");
}

/** Resolve the Electron executable. In plain Node, `require("electron")`
 *  returns the path to the binary; fall back to the local .bin shim. */
function electronExec(): string | null {
  try {
    const p = require("electron");
    if (typeof p === "string" && fs.existsSync(p)) return p;
  } catch {
    /* electron not resolvable from here */
  }
  const local = path.join(appRoot(), "node_modules", ".bin", "electron");
  return fs.existsSync(local) ? local : null;
}

/** Pattern that matches only this app's Electron process (not the CLI). */
function appProcPattern(): string {
  return path.join(appRoot(), "node_modules", "electron");
}

function isAppRunning(): boolean {
  try {
    execFileSync("pgrep", ["-f", appProcPattern()], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function startApp(): void {
  stopApp(true); // replace any existing instance
  const exec = electronExec();
  if (!exec) {
    console.error(`✗ could not find Electron — run \`npm install\` in ${appRoot()}`);
    process.exit(1);
  }
  const child = spawn(exec, [appRoot()], { detached: true, stdio: "ignore" });
  child.unref();
  try {
    fs.mkdirSync(petHome(), { recursive: true });
    if (child.pid) fs.writeFileSync(pidFile(), String(child.pid));
  } catch {
    /* pidfile is best-effort; stop falls back to pgrep/pkill */
  }
  console.log("✓ Claude Pet is running (look for 🐾 in the menu bar).");
}

function stopApp(quiet = false): boolean {
  let stopped = false;
  // 1) PID recorded by `start`.
  const pf = pidFile();
  if (fs.existsSync(pf)) {
    const pid = parseInt(fs.readFileSync(pf, "utf8").trim(), 10);
    if (pid > 0) {
      try { process.kill(pid); stopped = true; } catch { /* already gone */ }
    }
    try { fs.unlinkSync(pf); } catch { /* ignore */ }
  }
  // 2) Fallback: kill any Electron launched from this app dir (e.g. `npm start`).
  try {
    execFileSync("pkill", ["-f", appProcPattern()], { stdio: "ignore" });
    stopped = true;
  } catch { /* nothing matched */ }
  if (!quiet) {
    console.log(stopped ? "✓ stopped Claude Pet." : "  Claude Pet wasn't running.");
  }
  return stopped;
}

/** Locate the directory that contains a pet.json, searching breadth-first up
 *  to a few levels deep (zips often wrap the pack in a top-level folder). */
function findPetDir(root: string, maxDepth = 3): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (fs.existsSync(path.join(dir, "pet.json"))) return dir;
    if (depth >= maxDepth) continue;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name === "__MACOSX" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isDirectory()) queue.push({ dir: full, depth: depth + 1 });
      } catch { /* skip unreadable */ }
    }
  }
  return null;
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
}

function extractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    // -o overwrite, -q quiet. Present on macOS and most Linux distros.
    run("unzip", ["-o", "-q", zipPath, "-d", destDir]);
  } catch {
    throw new Error("failed to unzip — is the `unzip` command available?");
  }
}

function download(url: string, destPath: string): void {
  try {
    // -f fail on HTTP errors, -L follow redirects, -s silent, -S show errors.
    run("curl", ["-fLsS", "-o", destPath, url]);
  } catch {
    throw new Error(`failed to download ${url} — is \`curl\` available and the URL valid?`);
  }
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
    throw new Error(`download produced no data: ${url}`);
  }
}

function importCmd(source: string | undefined) {
  if (!source) {
    console.error("usage: claude-pet import <folder | file.zip | https://…/pet.zip>");
    process.exit(1);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-pet-"));
  let cleanup = true;
  try {
    let petDir: string;

    if (/^https?:\/\//i.test(source)) {
      // Remote zip.
      const zip = path.join(tmpRoot, "pack.zip");
      console.log(`↓ downloading ${source}`);
      download(source, zip);
      const ex = path.join(tmpRoot, "extracted");
      extractZip(zip, ex);
      const found = findPetDir(ex);
      if (!found) throw new Error("no pet.json found inside the downloaded zip");
      petDir = found;
    } else if (!fs.existsSync(source)) {
      throw new Error(`no such file or directory: ${source}`);
    } else if (fs.statSync(source).isDirectory()) {
      // Local folder — import in place (don't keep the temp dir).
      cleanup = false;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      const found = findPetDir(source);
      if (!found) throw new Error(`no pet.json found in ${source}`);
      petDir = found;
    } else if (/\.zip$/i.test(source)) {
      // Local zip.
      const ex = path.join(tmpRoot, "extracted");
      extractZip(source, ex);
      const found = findPetDir(ex);
      if (!found) throw new Error("no pet.json found inside the zip");
      petDir = found;
    } else {
      throw new Error(`unsupported source (expected a folder, a .zip, or an http(s) .zip URL): ${source}`);
    }

    const dest = importPet(petDir);
    console.log(`✓ imported pet → ${dest}`);
    console.log("  restart Claude Pet (or it'll pick it up on next launch) and select it from the tray.");
  } catch (e) {
    console.error(`✗ import failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    if (cleanup) fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case "install":   install(); break;
  case "uninstall": uninstall(); break;
  case "status":    status(); break;
  case "import":    importCmd(process.argv[3]); break;
  case "start":     startApp(); break;
  case "stop":
  case "close":
  case "quit":      stopApp(); break;
  default:
    console.log("usage: claude-pet <command>");
    console.log("  install    add Claude Code hooks");
    console.log("  uninstall  remove hooks and stop the app (the off switch)");
    console.log("  start      launch the desktop pet");
    console.log("  stop       quit the desktop pet  (alias: close)");
    console.log("  status     show install + running state");
    console.log("  import     import a pet pack (folder | .zip | https URL)");
    process.exit(cmd ? 1 : 0);
}
