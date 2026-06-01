# claude-pet

**English** · [简体中文](README.zh-CN.md)

A desktop pet for [Claude Code](https://claude.com/claude-code). It lives on
your desktop, reacts to your Claude Code session — working, waiting, finished,
errored — and clicks back into the terminal session it came from.

macOS only for v0.1.

## Quick start

### 1. Install & launch (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/install.sh | bash
```

This fetches the code, builds it, wires the Claude Code hooks, and starts the
pet (look for 🐾 in the menu bar). Requires Node.js 18+ and git. Now start any
`claude` session in your terminal and the pet animates on tool runs, permission
prompts, completions, and errors.

### 2. Use a different pet

Browse [codex-pets.net](https://codex-pets.net/) — the default pet source — pick
a pet, note its **name** (the last part of its page URL, e.g. `deepseek`), then:

```bash
claude-pet import deepseek      # downloads from codex-pets.net AND switches to it
```

Already imported it before? Just switch:

```bash
claude-pet switch deepseek      # switch to an installed pet (live, no restart)
```

Both take effect immediately on the running pet. You can also import a local
folder, a `.zip`, or any direct URL:

```bash
claude-pet import ./my-pet
claude-pet import ./my-pet.zip
claude-pet import https://example.com/my-pet.zip
```

Prefer the mouse? Right-click the pet (or the 🐾 menu bar icon) to switch pets,
open settings, or quit. The installer puts a `claude-pet` command on your PATH,
so the CLI is just `claude-pet <command>` (run it with no args to see them all).

### 3. Turn it off

```bash
claude-pet close       # hide the pet for now (start it again with: claude-pet start)
claude-pet uninstall   # the off switch: remove hooks AND quit the app
```

`uninstall` stops it coming back. To also delete the app, pets, and settings:

```bash
claude-pet uninstall && rm -rf ~/.claude-pet
```

> If the `claude-pet` command isn't on your PATH (global link failed), the same
> off switch is available as a one-liner:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/uninstall.sh | bash
> # add  -s -- --purge  to also delete app/pets/settings
> ```

---

## How it works

1. The installer registers `hooks/claude-pet-emit.sh` for these Claude Code
   events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `StopFailure`,
   `Notification`, `SessionEnd`.
2. On each event the script records the originating terminal app + tty and
   appends one JSON line to `~/.claude-pet/events.jsonl`.
3. The Electron app tails that file and maps each event to an animation +
   speech bubble:

   | Event                                | State    | Bubble                   |
   |--------------------------------------|----------|--------------------------|
   | `SessionStart`                       | `jump`   | "Claude is ready."       |
   | `PreToolUse`                         | `run`    | "Running &lt;tool&gt;…"        |
   | `Notification` (permission\_prompt)  | `review` | "Needs your permission." |
   | `Notification` (idle\_prompt)        | `wave`   | "Waiting on you."        |
   | `Stop`                               | `wave`   | "Done — your turn."      |
   | `StopFailure`                        | `failed` | error\_type              |
   | `SessionEnd`                         | `idle`   | "Session ended."         |

4. Click the pet → AppleScript raises the exact Terminal.app / iTerm2 tab that
   ran Claude Code (falling back to activating the app, then opening `cwd`).

## CLI

```bash
claude-pet install        # add hook entries to ~/.claude/settings.json
claude-pet uninstall      # remove hooks AND quit the app (the off switch)
claude-pet start          # launch the desktop pet
claude-pet stop           # quit the desktop pet  (alias: close)
claude-pet status         # show install + running state
claude-pet import <name>  # install a pet and switch to it. <name> is a
                          # codex-pets.net pet; also accepts a folder/.zip/URL
claude-pet switch <name>  # switch to an already-installed pet (live)
```

`import` and `switch` apply to a running pet immediately (the app watches its
settings file). You can also right-click the pet to switch/quit from the menu.

## Manual install

If you'd rather not pipe to `bash`:

```bash
git clone https://github.com/daghlny/claude-pet.git
cd claude-pet
./install.sh                 # same as the one-liner, run locally
# or: ./install.sh --no-hooks --no-launch  then  npm start
```

## Pet pack format (petdex / codex-pets compatible)

```
my-pet/
├── pet.json
└── spritesheet.png      # or .webp
```

A spritesheet is a grid of frames; rows are states, columns are animation
frames. Row order: `idle, wave, run, failed, review, jump, extra1, extra2`.
The frame grid is auto-detected from the image, so both layouts work (built-ins
are 9×8 at 192×208/frame; codex packs are 8×9). Minimal `pet.json`:

```json
{ "name": "Blob", "slug": "blob", "spritesheet": "spritesheet.png" }
```

codex-pets manifests (`id` / `displayName` / `spritesheetPath`) are accepted and
normalized automatically. Packs live in `~/.claude-pet/pets/<slug>/`; the
importer copies them there for you. Built-in `blob` and `cube` are generated
procedurally by `npm run gen:builtins` (no binary art in the repo).

## Extending beyond macOS

macOS-specific code is isolated to `hooks/claude-pet-emit.sh` (uses `ps`; Linux
works as-is) and `src/main/focusTerminal.ts` (AppleScript; swap for `wmctrl` /
PowerShell and dispatch on `process.platform`). Everything else is
platform-agnostic.

## License

MIT
