import { execSync } from "node:child_process";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev only, and removed with Coderview. See tools/coderviewSink.ts.
import { coderviewSink } from "./tools/coderviewSink";

/**
 * Which commit this bundle was built from.
 *
 * ── Why a build needs to be able to say what it is ────────────────────────
 *
 * A fix was pushed, the tests passed, the same sentence failed again on the
 * phone, and there was no way to tell whether the fix was wrong or whether
 * the browser was still running last week's bundle. Two very different
 * problems that look identical from the outside, and hours went into the
 * wrong one.
 *
 * Coderview prints this, so the next export answers it in one line.
 *
 * Cloudflare Pages sets `CF_PAGES_COMMIT_SHA`; git answers locally. Neither
 * being available is not an error, it just means the build cannot say.
 */
const buildStamp = (): string => {
  const fromPages = process.env["CF_PAGES_COMMIT_SHA"];
  if (fromPages) return fromPages.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss(), coderviewSink()],

  define: {
    __BUILD_COMMIT__: JSON.stringify(buildStamp()),
    __BUILD_AT__: JSON.stringify(new Date().toISOString()),
  },

  build: {
    rollupOptions: {
      output: {
        /**
         * Three chunks that change at three different rates.
         *
         * Firebase and Recharts are ~80% of the bytes and change only when
         * their versions do. Splitting them means an app edit invalidates
         * ~40 kB of cache instead of 850 kB, which matters on mobile data.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("firebase") || id.includes("@firebase")) return "firebase";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          return "vendor";
        },
      },
    },
    // The firebase chunk is legitimately large and is cached across deploys;
    // warning about it on every build is noise.
    chunkSizeWarningLimit: 700,
  },
});
