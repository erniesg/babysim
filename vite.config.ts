import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contracts": path.resolve(__dirname, "contracts"),
      "@engine": path.resolve(__dirname, "src/engine"),
      "@muppet": path.resolve(__dirname, "src/muppet"),
      "@components": path.resolve(__dirname, "src/components"),
      "@assets": path.resolve(__dirname, "assets"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
