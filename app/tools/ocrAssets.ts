/**
 * The picture reader's files, served from this site and nowhere else.
 *
 * tesseract.js fetches its worker, its engine and its English data from a
 * public CDN unless told otherwise. This app loads no third-party scripts
 * (CLAUDE.md, working rules), so the same files are copied out of
 * node_modules into the build under `/ocr/<version>/`, and served from there
 * in development. Nothing is committed: the files come from the installed
 * packages every build, so they always match the library that uses them.
 *
 * Only the LSTM engines are copied, the only kind `data/ocr.ts` asks for, in
 * the three builds the worker chooses between by what the device supports.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

/** Where `data/ocr.ts` looks. Versioned, so a new engine is never mixed with a cached old one. */
export const OCR_BASE = "ocr/v7";

function files(): Record<string, string> {
  const tesseract = dirname(require.resolve("tesseract.js/package.json"));
  const core = dirname(require.resolve("tesseract.js-core/package.json"));
  const eng = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
  return {
    "worker.min.js": join(tesseract, "dist/worker.min.js"),
    "core/tesseract-core-lstm.wasm.js": join(core, "tesseract-core-lstm.wasm.js"),
    "core/tesseract-core-simd-lstm.wasm.js": join(core, "tesseract-core-simd-lstm.wasm.js"),
    "core/tesseract-core-relaxedsimd-lstm.wasm.js": join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"),
    "lang/eng.traineddata.gz": join(eng, "4.0.0_best_int/eng.traineddata.gz"),
  };
}

export function ocrAssets(): Plugin {
  return {
    name: "fms-ocr-assets",

    configureServer(server) {
      const map = files();
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const prefix = `/${OCR_BASE}/`;
        if (!path.startsWith(prefix)) return next();
        const source = map[path.slice(prefix.length)];
        if (!source) return next();
        res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(source));
      });
    },

    generateBundle() {
      for (const [name, source] of Object.entries(files())) {
        this.emitFile({ type: "asset", fileName: `${OCR_BASE}/${name}`, source: readFileSync(source) });
      }
    },
  };
}
