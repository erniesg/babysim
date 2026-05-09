import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".mjs", ".js", ".mts", ".jsx", ".json"],
    alias: {
      "@contracts": path.resolve(__dirname, "contracts"),
      "@engine": path.resolve(__dirname, "src/engine"),
      "@muppet": path.resolve(__dirname, "src/muppet"),
      "@components": path.resolve(__dirname, "src/components"),
      "@assets": path.resolve(__dirname, "assets"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.js", "**/node_modules/**", ".claude/**", "dist/**"],
  },
});
