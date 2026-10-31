import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Alias, HtmlTagDescriptor, Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { APP_NAME, pageTitle } from "./src/app/page-title.ts";
import { THEME_BOOT_SCRIPT } from "./src/web/theme-boot.ts";

const host = process.env["TAURI_DEV_HOST"];

/** GitHub Pages の公開先（https://gjzkcal.github.io/field-medic-manual/）のパス */
const WEB_BASE = "/field-medic-manual/";

// src/web/router.tsx のルートのうち、引数を持たないものと、その画面の名前（各画面の usePageTitle と同じ）。
// ルートを足したらここにも足す（足し忘れるとその URL だけ HTTP 404 に戻る）
const WEB_STATIC_ROUTES: Readonly<Record<string, string>> = {
  library: "ライブラリ",
  quickref: "クイック表",
  settings: "設定",
  about: "このサイトについて",
};
const INDEX_TITLE = `<title>${APP_NAME}</title>`;

const DESKTOP_ENTRY = 'src="/src/main.tsx"';
const WEB_ENTRY = 'src="/src/web/main.tsx"';

const EMPTY_ROOT = '<div id="root"></div>';
// JS を読んで実行し終わるまで（低速の回線とスマホで数秒）真っ白にしないため、#root に読み込み中の表示を置く。
// React の描画で中身ごと置き換わる。Tailwind はこのファイルの中のクラスを拾わないので、色は CSS 変数で書く。
// デスクトップ版は最初の画面が描けるまでウィンドウを出さないので入れない
const WEB_LOADING_ROOT = [
  '<div id="root">',
  '<p role="status" style="margin:0;padding:3rem 1rem;text-align:center;color:var(--muted-foreground)">',
  "マニュアルを読み込んでいます…",
  "</p>",
  '<noscript><p style="margin:0;padding:0 1rem;text-align:center">',
  "表示するには JavaScript を有効にしてください。",
  "</p></noscript>",
  "</div>",
].join("");

// デスクトップ版（tauri.conf.json）と同じ方針の CSP から、Rust との IPC の宛先を除いたもの。
// 外部へ通信せず、同梱したもの以外を読まない。インラインのスクリプトは <head> のテーマの 1 つだけをハッシュで許す
const WEB_CSP = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${createHash("sha256").update(THEME_BOOT_SCRIPT).digest("base64")}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * ブラウザ向けの Web 版（`vite --mode web`）だけの設定。
 * index.html のエントリを Web 版のもの（小窓・トリアージの同期・自動更新を読まない）に替えて読み込み中の表示を置き、
 * 公開するビルドには CSP と favicon を入れ、GitHub Pages でディープリンクを開けるように 404.html とルートごとの写しを置く。
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
        if (!html.includes(EMPTY_ROOT)) {
          throw new Error(`index.html に ${EMPTY_ROOT} がありません`);
        }
        const tags: HtmlTagDescriptor[] = [
          // 本体の JS を読み込む前（読み込み中の表示）から、保存したテーマで描く。CSP の meta（下で先頭に足す）より後ろに置く
          { tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head" },
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
          // 外部のページへ移るときに、どのページから来たかを送らない（送る理由がなく、外部リンクも noreferrer で開いている）。
          // GitHub Pages ではレスポンスヘッダの Referrer-Policy を付けられないので meta で入れる
          {
            tag: "meta",
            attrs: { name: "referrer", content: "no-referrer" },
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
        return {
          html: html.replace(DESKTOP_ENTRY, WEB_ENTRY).replace(EMPTY_ROOT, WEB_LOADING_ROOT),
          tags,
        };
      },
    },
    writeBundle(options) {
      const dir = options.dir ?? "dist-web";
      const index = join(dir, "index.html");
      // Pages は無い URL に 404.html を返すので、どの URL でも同じ画面を起動させる
      copyFileSync(index, join(dir, "404.html"));
      // ただし 404.html の中身は HTTP 404 で返り、検索エンジンやリンクのプレビューには無いページに見える。
      // Pages は拡張子なしの URL（/library）を library.html で返すので、既知のルートには写しを置いて 200 にする。
      // library/index.html にしないのは、/library → /library/ のリダイレクトが挟まるため
      // 表題は JS が描いた後にも付くが、読み込み中・リンクのプレビュー・検索エンジンにも画面の名前を出す（WCAG 2.4.2）
      const indexHtml = readFileSync(index, "utf8");
      if (!indexHtml.includes(INDEX_TITLE)) {
        throw new Error(`index.html に ${INDEX_TITLE} がありません`);
      }
      const withTitle = (page: string): string =>
        indexHtml.replace(INDEX_TITLE, `<title>${escapeHtml(pageTitle(page))}</title>`);
      for (const [route, page] of Object.entries(WEB_STATIC_ROUTES)) {
        writeFileSync(join(dir, `${route}.html`), withTitle(page));
      }
      // 文書の id は原稿のファイル名の stem（src/features/content/bundle.ts と同じ規則）
      const docDir = join(dir, "doc");
      mkdirSync(docDir, { recursive: true });
      const manuals = fileURLToPath(new URL("./content/manuals", import.meta.url));
      for (const name of readdirSync(manuals)) {
        if (extname(name) === ".md") {
          const title = frontMatterTitle(readFileSync(join(manuals, name), "utf8")) ?? name;
          writeFileSync(join(docDir, `${basename(name, ".md")}.html`), withTitle(title));
        }
      }
    },
  };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 原稿の front matter の title。表題だけが要るので、YAML の全体は読まない（原稿の表題は 1 行の素の文字列） */
function frontMatterTitle(markdown: string): string | null {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  const title =
    frontMatter === undefined ? undefined : /^title:\s*(.+?)\s*$/m.exec(frontMatter)?.[1];
  return title === undefined ? null : title.replace(/^(["'])(.*)\1$/, "$2");
}

const WEB_STORE_ID = "virtual:web-store";
const RESOLVED_WEB_STORE_ID = ` ${WEB_STORE_ID}`;

/**
 * Web 版の原稿の表（src/lib/tauri.web.ts が本番で読む）。Web のビルドのときだけ、原稿を変換して JSON で埋め込む。
 * ほかのモード（テスト・開発サーバー）は実行時に変換するので読まれないが、解決できないと変換の段階で落ちるため、
 * 読んだら失敗するモジュールを返す
 */
function webStorePlugin(prebuild: boolean): Plugin {
  return {
    name: "field-medic-manual:web-store",
    resolveId(id) {
      return id === WEB_STORE_ID ? RESOLVED_WEB_STORE_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_WEB_STORE_ID) {
        return undefined;
      }
      if (!prebuild) {
        return `throw new Error("${WEB_STORE_ID} は Web 版のビルドのときだけ作る");`;
      }
      const output = fileURLToPath(new URL("./node_modules/.tmp/web-store.json", import.meta.url));
      mkdirSync(join(output, ".."), { recursive: true });
      const script = fileURLToPath(new URL("./scripts/web-prebuild.ts", import.meta.url));
      await promisify(execFile)(process.execPath, [script, output]);
      const json = await readFile(output, "utf8");
      // オブジェクトのリテラルより JSON.parse の文字列のほうが、ブラウザで速く読める
      return `export default JSON.parse(${JSON.stringify(json)});`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
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
    plugins: [
      react(),
      tailwindcss(),
      webStorePlugin(web && command === "build"),
      ...(web ? [webPlugin()] : []),
    ],
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
