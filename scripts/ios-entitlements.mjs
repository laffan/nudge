// Brings the memory entitlements of the generated Xcode project
// (src-tauri/gen/apple/nudge_iOS/nudge_iOS.entitlements) in line with
// src-tauri/ios/Nudge.entitlements.
//
// The generated project is git-ignored and is rebuilt whenever Tauri's iOS
// settings change (bundle.iOS.frameworks, for one), and Tauri's config has
// no entitlements option of its own. `npm run ios:init` runs this after
// `tauri ios init`; it is safe to run again.
//
// Only the keys this script manages (MANAGED) are touched: those in
// Nudge.entitlements are added, the others removed, and anything else in
// the generated file is left alone. With --no-memory-limit, the increased
// memory limit is removed as well, for a signing team that can't have it:
//   npm run ios:entitlements -- --no-memory-limit
import fs from "node:fs";
import path from "node:path";

const SOURCE = "src-tauri/ios/Nudge.entitlements";
const appleDir = "src-tauri/gen/apple";
const MEMORY_LIMIT = "com.apple.developer.kernel.increased-memory-limit";
const MANAGED = [MEMORY_LIMIT, "com.apple.developer.kernel.extended-virtual-addressing"];

const args = process.argv.slice(2);
const noMemoryLimit = args.includes("--no-memory-limit");
const fileArg = args.find((a) => !a.startsWith("--"));

/** The <key>…</key><value/> pairs in a plist, as [key, raw value]. */
function pairs(xml) {
  const out = [];
  const re = /<key>([^<]+)<\/key>\s*(<true\s*\/>|<false\s*\/>|<string>[^<]*<\/string>|<integer>[^<]*<\/integer>)/g;
  for (const m of xml.matchAll(re)) out.push([m[1], m[2]]);
  return out;
}

function findTarget() {
  if (!fs.existsSync(appleDir)) return null;
  for (const entry of fs.readdirSync(appleDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith("_iOS")) continue;
    const file = path.join(appleDir, entry.name, `${entry.name}.entitlements`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const target = fileArg ?? findTarget();
if (!target) {
  console.error(`No generated entitlements file under ${appleDir} — run \`npm run tauri ios init\` first.`);
  process.exit(1);
}

const wanted = pairs(fs.readFileSync(SOURCE, "utf8")).filter(
  ([k]) => MANAGED.includes(k) && !(noMemoryLimit && k === MEMORY_LIMIT),
);
let xml = fs.readFileSync(target, "utf8");
const removed = [];

// Take out managed keys that shouldn't be there.
for (const key of MANAGED) {
  if (wanted.some(([k]) => k === key)) continue;
  const re = new RegExp(`[ \\t]*<key>${key.replace(/\./g, "\\.")}</key>\\s*<(?:true|false)\\s*/>\\n?`, "g");
  if (re.test(xml)) {
    xml = xml.replace(re, "");
    removed.push(key);
  }
}

// Add the wanted ones that are missing.
const have = new Set(pairs(xml).map(([k]) => k));
const missing = wanted.filter(([k]) => !have.has(k));
if (missing.length) {
  const lines = missing.map(([k, v]) => `\t<key>${k}</key>\n\t${v}`).join("\n");
  if (/<dict\s*\/>/.test(xml)) {
    xml = xml.replace(/<dict\s*\/>/, `<dict>\n${lines}\n</dict>`);
  } else if (xml.includes("</dict>")) {
    const at = xml.lastIndexOf("</dict>");
    xml = `${xml.slice(0, at)}${lines}\n${xml.slice(at)}`;
  } else {
    console.error(`${target} has no <dict> to add to; add these keys by hand:\n${lines}`);
    process.exit(1);
  }
}

if (!missing.length && !removed.length) {
  console.log(`${target}: entitlements already in place.`);
  process.exit(0);
}
// An emptied <dict> is written back in its short form.
xml = xml.replace(/<dict>\s*<\/dict>/, "<dict/>");
fs.writeFileSync(target, xml);
const said = [
  missing.length ? `added ${missing.map(([k]) => k).join(", ")}` : "",
  removed.length ? `removed ${removed.join(", ")}` : "",
].filter(Boolean);
console.log(`${target}: ${said.join("; ")}.`);
