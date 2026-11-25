// Fails the build when a code file passes 700 lines (README_TECHNICAL.md,
// "Rules"). Covers the frontend, the Rust core and the stylesheets.
import fs from "node:fs";
import path from "node:path";

const LIMIT = 700;
const ROOTS = ["src", "src-tauri/src", "scripts"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".rs"]);
const over = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (EXT.has(path.extname(entry.name))) {
      const lines = fs.readFileSync(p, "utf8").split("\n").length;
      if (lines > LIMIT) over.push(`${p}: ${lines} lines`);
    }
  }
}

for (const r of ROOTS) if (fs.existsSync(r)) walk(r);
if (over.length) {
  console.error(`Files over ${LIMIT} lines:\n  ${over.join("\n  ")}`);
  process.exit(1);
}
console.log(`All code files are within ${LIMIT} lines.`);
