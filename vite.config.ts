import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^stream$/, replacement: "stream-browserify" },
      { find: /^buffer$/, replacement: "buffer/" },
      { find: /^events$/, replacement: "events/" },
    ],
  },
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: {
    outDir: "dist",
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep shared React and CJS helpers out of lazy Markdown dependencies.
          if (
            id.includes("commonjsHelpers") ||
            /node_modules\/(react|react-dom|scheduler)\//.test(id)
          )
            return "react-vendor";
          if (/node_modules\/(react-markdown|remark-gfm)\//.test(id))
            return "markdown-vendor";
          if (id.includes("node_modules/@supabase/")) return "supabase-vendor";
          if (id.includes("node_modules/zod/")) return "validation-vendor";
        },
      },
    },
  },
});
