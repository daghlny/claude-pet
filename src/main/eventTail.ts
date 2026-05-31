import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import chokidar from "chokidar";
import type { HookEvent } from "../shared/types";

/**
 * Tails ~/.claude-pet/events.jsonl. Emits "event" for each JSON line appended.
 *
 * We track the file by offset and re-read on change. chokidar handles
 * truncation and rotation by re-firing "add". This is intentionally simple:
 * a single-writer append-only log is the contract with the shell hook.
 */
export class EventTail extends EventEmitter {
  private filePath: string;
  private offset = 0;
  private watcher?: chokidar.FSWatcher;
  private buf = "";
  /** Reentrancy guard: drain() reads asynchronously, so a change firing mid-read
   * must not start a second overlapping read against the same offset. */
  private draining = false;
  private pending = false;

  constructor(home = process.env.CLAUDE_PET_HOME || path.join(os.homedir(), ".claude-pet")) {
    super();
    this.filePath = path.join(home, "events.jsonl");
  }

  start() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "");
      // Start at EOF — we only care about new events after the app launches.
      this.offset = fs.statSync(this.filePath).size;
    } catch (e) {
      console.error("[claude-pet] cannot init event log", e);
    }

    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      usePolling: process.platform === "darwin", // FSEvents on appended files can be flaky
      interval: 200,
      // Don't replay the whole existing log on launch — we set offset to EOF
      // above and only want events appended after the app starts.
      ignoreInitial: true,
    });
    this.watcher.on("change", () => this.drain());
    this.watcher.on("add", () => {
      this.offset = 0;
      this.drain();
    });
  }

  stop() {
    this.watcher?.close();
  }

  private drain() {
    // A read is already in flight; remember to run again once it finishes so
    // we don't open a second stream against the same (stale) offset.
    if (this.draining) {
      this.pending = true;
      return;
    }
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size < this.offset) this.offset = 0; // truncated
      if (stat.size === this.offset) return;
      this.draining = true;
      const readEnd = stat.size;
      const stream = fs.createReadStream(this.filePath, {
        start: this.offset,
        end: readEnd - 1,
      });
      stream.on("data", (chunk: string | Buffer) => {
        this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      const finish = () => {
        this.draining = false;
        if (this.pending) {
          this.pending = false;
          this.drain();
        }
      };
      stream.on("error", (e) => {
        console.error("[claude-pet] read stream error", e);
        finish();
      });
      stream.on("end", () => {
        this.offset = readEnd;
        const lines = this.buf.split("\n");
        this.buf = lines.pop() || ""; // keep partial line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as HookEvent;
            this.emit("event", evt);
          } catch {
            // ignore malformed lines
          }
        }
        finish();
      });
    } catch (e) {
      console.error("[claude-pet] drain error", e);
      this.draining = false;
    }
  }
}
