import { copyFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Alias, HtmlTagDescriptor, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const host = process.env["TAURI_DEV_HOST"];

/** GitHub Pages の公開先（https://gjzkcal.github.io/field-medic-manual/）のパス */
const WEB_BASE = "/field-medic-manual/";

const DESKTOP_ENTRY = 'src="/src/main.tsx"';
const WEB_ENTRY = 'src="/src/web/main.tsx"';

// デスクトップ版（tauri.conf.json）と同じ方針の CSP から、Rust との IPC の宛先を除いたもの。
// 外部へ通信せず、同梱したもの以外を読まない
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * ブラウザ向けの Web 版（`vite --mode web`）だけの設定。
 * index.html のエントリを Web 版のもの（小窓・トリアージの同期・自動更新を読まない）に替え、
 * 公開するビルドには CSP と favicon を入れ、GitHub Pages でディープリンクを開けるように 404.html を置く。
 */
function webPlugin(): Plugin {
  return {
    name: "field-medic-manual:web",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (!html.includes(DESKTOP_ENTRY)) {
          // 置き換えられないまま、デスクトップ版のエントリで公開してしまわないように止める
          throw new Error(`index.html に ${DESKTOP_ENTRY} がありません`);
        }
        const tags: HtmlTagDescriptor[] = [
          // 自作のアイコン（ゲームの資産ではない）。Vite がビルドでファイル名にハッシュを付けて出力する
          {
            tag: "link",
            attrs: { rel: "icon", type: "image/png", href: "/src-tauri/icons/32x32.png" },
            injectTo: "head",
          },
          {
            tag: "meta",
            attrs: {
              name: "description",
              content:
                "Arma Reforger の ACE Medical 向けの非公式マニュアル（Field Medic Manual の Web 版）",
            },
            injectTo: "head",
          },
        ];
        // 開発サーバーは React Refresh のインラインのスクリプトを使うので、ビルドだけに入れる
        if (context.server === undefined) {
          tags.unshift({
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: WEB_CSP },
            injectTo: "head",
          });
        }
        return { html: html.replace(DESKTOP_ENTRY, WEB_ENTRY), tags };
      },
    },
    writeBundle(options) {
      // Pages は無い URL（/field-medic-manual/doc/… を直接開いたとき）に 404.html を返すので、同じ画面を起動させる
      const dir = options.dir ?? "dist-web";
      copyFileSync(join(dir, "index.html"), join(dir, "404.html"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  const src = fileURLToPath(new URL("./src", import.meta.url));
  const alias: Alias[] = [
    // Web 版では Rust の呼び出しを、ブラウザで完結する実装に差し替える（ほかの @/lib/tauri.* は巻き込まない）
    ...(web
      ? [
          {
            find: /^@\/lib\/tauri$/,
            replacement: fileURLToPath(new URL("./src/lib/tauri.web.ts", import.meta.url)),
          },
        ]
      : []),
    { find: "@", replacement: src },
  ];

  return {
    plugins: [react(), tailwindcss(), ...(web ? [webPlugin()] : [])],
    resolve: { alias },
    ...(web
      ? {
          base: WEB_BASE,
          // Tauri が読む dist（frontendDist）を上書きしない
          build: { outDir: "dist-web" },
        }
      : {}),

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
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
      restoreMocks: true,
    },
  };
});
