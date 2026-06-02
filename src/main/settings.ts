import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppSettings {
  petSlug: string;
  scale: number;
  position?: { x: number; y: number };
  /** "Ghost mode": when true the pet ignores the mouse entirely and all clicks
   *  pass through to whatever is behind it. When false the pet is interactive
   *  over its opaque pixels and click-through only on transparent areas. */
  clickThrough?: boolean;
}

const DEFAULTS: AppSettings = { petSlug: "blob", scale: 0.5 };

function file() {
  const home = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet");
  fs.mkdirSync(home, { recursive: true });
  return path.join(home, "settings.json");
}

/** Absolute path to the settings file (exported for the settings watcher). */
export function settingsFilePath(): string {
  return file();
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: AppSettings) {
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
}
