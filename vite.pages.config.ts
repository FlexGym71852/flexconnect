import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github-pages",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  define: {
    "import.meta.env.VITE_GITHUB_PAGES": JSON.stringify("true"),
  },
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
