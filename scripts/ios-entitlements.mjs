// Merges src-tauri/ios/Nudge.entitlements into the entitlements file of the
// generated Xcode project (src-tauri/gen/apple/nudge_iOS/nudge_iOS.entitlements).
//
// The generated project is git-ignored and is rebuilt whenever Tauri's iOS
// settings change (bundle.iOS.frameworks, for one), and Tauri's config has
// no entitlements option of its own. Without the increased memory limit,
// iPadOS stops the app when an on-device model of about 2.7 GB is loaded on
// an 8 GB iPad. `npm run ios:init` runs this after `tauri ios init`; it is
// safe to run again, since keys already present are left alone.
import fs from "node:fs";
import path from "node:path";

const SOURCE = "src-tauri/ios/Nudge.entitlements";
const appleDir = "src-tauri/gen/apple";

/** The <key>…</key><true/> pairs in a plist, as [key, raw value]. */
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

const target = process.argv[2] ?? findTarget();
if (!target) {
  console.error(`No generated entitlements file under ${appleDir} — run \`npm run tauri ios init\` first.`);
  process.exit(1);
}

let xml = fs.readFileSync(target, "utf8");
const have = new Set(pairs(xml).map(([k]) => k));
const missing = pairs(fs.readFileSync(SOURCE, "utf8")).filter(([k]) => !have.has(k));
if (missing.length === 0) {
  console.log(`${target}: entitlements already in place.`);
  process.exit(0);
}

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
fs.writeFileSync(target, xml);
console.log(`${target}: added ${missing.map(([k]) => k).join(", ")}.`);
