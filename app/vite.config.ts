import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],

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
