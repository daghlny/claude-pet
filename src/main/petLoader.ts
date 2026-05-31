import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FRAME_W, FRAME_H, GRID_COLS, GRID_ROWS, PetManifest } from "../shared/types";

export interface LoadedPet {
  manifest: PetManifest;
  /** Absolute path to the spritesheet image. */
  spritesheetPath: string;
  /** Directory the pet was loaded from. */
  dir: string;
}

/** Loads a petdex-compatible pet folder (pet.json + spritesheet.{webp,png}). */
export function loadPet(petDir: string): LoadedPet {
  const manifestPath = path.join(petDir, "pet.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing pet.json in ${petDir}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PetManifest & {
    id?: string;
    displayName?: string;
    spritesheetPath?: string;
  };
  // codex-pets compat: `id` → slug, `displayName` → name, `spritesheetPath` → spritesheet.
  const manifest: PetManifest = {
    ...raw,
    slug: raw.slug ?? raw.id ?? path.basename(petDir),
    name: raw.name ?? raw.displayName ?? raw.slug ?? raw.id ?? path.basename(petDir),
    spritesheet: raw.spritesheet ?? raw.spritesheetPath,
  };

  // Spritesheet candidates: explicit > webp > png.
  const candidates = [
    manifest.spritesheet && path.join(petDir, manifest.spritesheet),
    path.join(petDir, "spritesheet.webp"),
    path.join(petDir, "spritesheet.png"),
  ].filter(Boolean) as string[];
  const spritesheetPath = candidates.find((p) => fs.existsSync(p));
  if (!spritesheetPath) {
    throw new Error(`No spritesheet found in ${petDir}`);
  }

  // Apply petdex defaults for the frame box / grid only. We deliberately do
  // NOT pre-fill per-state `frames`/`durations` here: the renderer auto-detects
  // the real column (frame) count from the spritesheet's pixel size, and only
  // falls back to a default when a value is absent. Filling every state with 6
  // would mask that detection and pin every pet to 6 frames regardless of its
  // actual sheet. Whatever the pet.json declares explicitly is preserved.
  manifest.frame = manifest.frame ?? { w: FRAME_W, h: FRAME_H };
  manifest.grid = manifest.grid ?? { cols: GRID_COLS, rows: GRID_ROWS };

  return { manifest, spritesheetPath, dir: petDir };
}

/** All discoverable pets: built-ins + user pets in ~/.claude-pet/pets. */
export function listPets(builtinsDir: string): LoadedPet[] {
  const userDir = path.join(
    process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet"),
    "pets",
  );
  const dirs: string[] = [];
  for (const root of [builtinsDir, userDir]) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "pet.json"))) {
        dirs.push(full);
      }
    }
  }
  const out: LoadedPet[] = [];
  for (const d of dirs) {
    try {
      out.push(loadPet(d));
    } catch (e) {
      console.warn(`[claude-pet] skipping pet at ${d}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Import a folder into ~/.claude-pet/pets/<slug>. Returns destination path. */
export function importPet(srcDir: string): string {
  const loaded = loadPet(srcDir); // validate
  const slug = loaded.manifest.slug || path.basename(srcDir);
  const home = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet");
  const dest = path.join(home, "pets", slug);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const full = path.join(srcDir, file);
    // Only copy regular files (skip nested dirs); pet packs are flat.
    if (fs.statSync(full).isFile()) {
      fs.copyFileSync(full, path.join(dest, file));
    }
  }
  return dest;
}
