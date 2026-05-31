import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppSettings {
  petSlug: string;
  scale: number;
  position?: { x: number; y: number };
}

const DEFAULTS: AppSettings = { petSlug: "blob", scale: 0.5 };

function file() {
  const home = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet");
  fs.mkdirSync(home, { recursive: true });
  return path.join(home, "settings.json");
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
