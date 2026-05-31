# claude-pet

**English** · [简体中文](README.zh-CN.md)

A desktop pet for [Claude Code](https://claude.com/claude-code). Lives on
your desktop, reacts to your Claude Code session — working, waiting,
finished, errored — and clicks back into the terminal session it came from.

Petdex/codex-pets asset format compatible: drop any `pet.json` +
`spritesheet.{png,webp}` pack into `~/.claude-pet/pets/<slug>/` and it
shows up in the picker.

macOS only for v0.1. Cross-platform groundwork is in place
(`focusTerminal.ts` and the hook script are the only macOS-specific bits).

## Install

One shot:

```bash
./install.sh        # deps + built-in pets + build + wire hooks
npm start           # launch the Electron app
```

`./install.sh --no-hooks` builds everything but leaves
`~/.claude/settings.json` untouched. Equivalent manual steps:

```bash
npm install
npm run gen:builtins       # produce the 2 built-in pet sprite sheets
npm run build              # compile TS + copy renderer HTML
node dist/cli/index.js install   # wire hooks into ~/.claude/settings.json
npm start                  # launch the Electron app
```

Then start any `claude` session in Terminal/iTerm — the pet will animate
on permission prompts, tool runs, completions, and errors.

## CLI

```bash
claude-pet install     # add hook entries to ~/.claude/settings.json
claude-pet status      # show install state + event log path
claude-pet uninstall   # remove hook entries
claude-pet import <src># import a pet pack (folder | .zip | http(s) .zip URL)
```

(If you haven't linked the `claude-pet` bin, call it as
`node dist/cli/index.js <command>`.)

`claude-pet install` is idempotent — re-running replaces any prior
claude-pet hook entries while leaving the rest of your settings untouched
(a `.claude-pet.bak` backup is written next to `settings.json`).

## How it works

1. The CLI registers `hooks/claude-pet-emit.sh` for these Claude Code
   events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`,
   `StopFailure`, `Notification`, `SessionEnd`.
2. On each event, the script walks the parent process tree to record the
   terminal app + controlling tty, then appends one JSON line to
   `~/.claude-pet/events.jsonl`.
3. The Electron main process tails that file (`chokidar`) and maps each
   event to a pet animation state + speech bubble:

   | Event                                | State    | Bubble                |
   |--------------------------------------|----------|-----------------------|
   | `SessionStart`                       | `jump`   | "Claude is ready."    |
   | `PreToolUse`                         | `run`    | "Running &lt;tool&gt;…"     |
   | `Notification` (permission\_prompt)  | `review` | "Needs your permission." |
   | `Notification` (idle\_prompt)        | `wave`   | "Waiting on you."     |
   | `Stop`                               | `wave`   | "Done — your turn."   |
   | `StopFailure`                        | `failed` | error\_type           |
   | `SessionEnd`                         | `idle`   | "Session ended."      |

4. Click the pet → an AppleScript looks up the recorded tty inside
   Terminal.app or iTerm2 and raises that specific tab. Falls back to
   activating the terminal app, then to opening `cwd` in Finder.

## Pet pack format (petdex-compatible)

```
my-pet/
├── pet.json
└── spritesheet.png      # or .webp
```

`spritesheet.png`: 8 rows × 9 columns, **192×208** per frame
(total **1728×1664**). Row order:

```
0 idle    1 wave   2 run    3 failed
4 review  5 jump   6 extra1 7 extra2
```

`pet.json`:

```json
{
  "name": "Blob",
  "slug": "blob",
  "tags": ["builtin"],
  "kind": "builtin",
  "spritesheet": "spritesheet.png",
  "frame":   { "w": 192, "h": 208 },
  "grid":    { "cols": 9, "rows": 8 },
  "frames":    { "idle": 6, "run": 6 },
  "durations": { "idle": 1100, "run": 800 }
}
```

`frames`/`durations` are optional (defaults: 6 frames/state, 1100 ms loop).

Drop your pet folder into `~/.claude-pet/pets/<slug>/` or use **Settings →
Import pet folder…** in the app. Pets shipped by petdex (`npx petdex
install <slug>`) write to the same conventions.

### Importing packs from the CLI

```bash
claude-pet import ./my-pet                       # a local folder
claude-pet import ./my-pet.zip                    # a local zip
claude-pet import https://example.com/my-pet.zip  # a remote zip
```

The importer locates the `pet.json` even when a zip wraps the pack in a
top-level folder, validates it, then copies it into
`~/.claude-pet/pets/<slug>/`. codex-pets manifests (`id` / `displayName` /
`spritesheetPath`) are accepted and normalized automatically.

> Zip/URL import shells out to the system `unzip` and `curl` (both present on
> macOS and most Linux distros).

### Using pets from codex-pets.net

[codex-pets.net](https://codex-pets.net/) has a gallery of community pet
packs that use the same sprite format. Browse it, find a pet you like, and
note its **slug** (the last path segment of its page URL, e.g. `deepseek`).

**Easiest — import straight from the site into Claude Pet:**

```bash
claude-pet import "https://codex-pets.net/api/pets/<slug>/download"
# e.g.
claude-pet import "https://codex-pets.net/api/pets/deepseek/download"
```

That single command downloads the pack and installs it to
`~/.claude-pet/pets/<slug>/`. Restart Claude Pet (or just relaunch) and pick
it from the tray menu.

**Already installed it via codex's own tooling?** codex-pets installs to
`~/.codex/pets/<slug>/`. Point the importer at that folder to copy it into
Claude Pet:

```bash
# after `npx codex-pets add deepseek`
claude-pet import ~/.codex/pets/deepseek
```

> Claude Pet reads from `~/.claude-pet/pets/`, while codex reads from
> `~/.codex/pets/`. The two are independent — `import` bridges a pack from
> codex's location (or directly from the website) into Claude Pet's.

## Built-in pets

`npm run gen:builtins` paints two simple pixel pets, `blob` and `cube`,
into `assets/pets/`. They're generated procedurally with `pngjs` so
there's no binary art in the repo — tweak `scripts/generate-builtins.js`
to add your own.

## Extending beyond macOS

The macOS-specific code is isolated to:

- `hooks/claude-pet-emit.sh` — uses `ps` to walk the process tree.
  Linux works as-is; Windows needs a `.ps1` equivalent.
- `src/main/focusTerminal.ts` — AppleScript. Replace with `wmctrl`
  (Linux) or `powershell` window activation (Windows) and dispatch on
  `process.platform`.

The event log, pet loader, state mapper, and renderer are all
platform-agnostic.

## License

MIT
