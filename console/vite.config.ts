import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// Static output. The console reads chain state directly from an RPC in the browser and has no
// server of its own, so it deploys as files — which is also why Next.js was not used here.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {outDir: "dist", sourcemap: true},
  server: {port: 5173, host: "127.0.0.1"},
});
