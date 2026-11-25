import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// pdf.js loads some of what it needs by URL at run time — the WebAssembly
// JBIG2 / JPEG 2000 decoders scanned PDFs need, colour profiles, standard
// fonts and CMaps. This serves those folders of pdfjs-dist under /pdfjs/
// in dev and copies them into the build (as Zotero Helper does);
// src/lib/pdf/pdfjs.ts points pdf.js at them.
const PDFJS_DIRS = ["wasm", "iccs", "standard_fonts", "cmaps"];
const PDFJS_ROOT = fileURLToPath(new URL("./node_modules/pdfjs-dist", import.meta.url));

function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const [dir, file] = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, "").split("/");
        if (!PDFJS_DIRS.includes(dir) || !file || file.includes("..")) return next();
        const full = path.join(PDFJS_ROOT, dir, file);
        if (!fs.existsSync(full)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        fs.createReadStream(full).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const file of fs.readdirSync(path.join(PDFJS_ROOT, dir))) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${file}`,
            source: fs.readFileSync(path.join(PDFJS_ROOT, dir, file)),
          });
        }
      }
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), pdfjsAssets()],
  clearScreen: false,
  build: { target: "safari16", chunkSizeWarningLimit: 2000 },
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
