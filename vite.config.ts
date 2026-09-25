import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env["TAURI_DEV_HOST"];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Tauri 向けの設定（`tauri dev` / `tauri build` のときだけ意味を持つ）
  // Rust のエラー表示を Vite が消さないようにする
  clearScreen: false,
  server: {
    // Tauri は devUrl の固定ポートを見に行くので、使用中なら別ポートに逃げずに失敗させる
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host === undefined ? {} : { hmr: { protocol: "ws", host, port: 1421 } }),
    watch: {
      // Rust 側の変更は tauri CLI が監視するため、Vite では二重に反応させない
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
