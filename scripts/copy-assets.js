#!/usr/bin/env node
// Copy renderer HTML alongside the compiled JS so file:// loads work.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "renderer");
const OUT = path.join(__dirname, "..", "dist", "renderer");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(SRC)) {
  if (f.endsWith(".html")) {
    fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  }
}
console.log("renderer html copied →", OUT);
