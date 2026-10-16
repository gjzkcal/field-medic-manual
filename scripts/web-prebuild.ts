// Web 版の原稿の表を、ビルドのときに作る（`node scripts/web-prebuild.ts <出力先の JSON>`）。
// vite.config.ts のプラグインが pnpm build:web の途中に子プロセスで呼ぶ。DOM のグローバルを足すので、
// Vite 本体のビルドと同じプロセスで動かさない。
// 変換のコード（src/web/backend/load.ts）は import.meta.glob と alias を使うので、Vite の ssrLoadModule で読む。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createServer } from "vite";

interface BuildTimeModule {
  buildPrebuiltJson: (readImage: (path: string) => Promise<Uint8Array>) => Promise<unknown>;
}

// ssrLoadModule の戻り値は型が付かないので、使う関数があることだけを確かめる
function isBuildTimeModule(
  module: Record<string, unknown>,
): module is Record<string, unknown> & BuildTimeModule {
  return typeof module["buildPrebuiltJson"] === "function";
}

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2];
if (output === undefined) {
  throw new Error("出力先の JSON のパスを渡してください");
}

// 変換の無害化（DOMPurify）と節の切り出し（DOMParser）に DOM が要るので、jsdom の window にあって Node にないものを足す。
// DOMPurify は読み込んだ時点の window を使うので、変換のコードを読む前に足す。
// Node にあるもの（タイマー・URL など）は上書きしない（Vite 自身が使うため）
const dom = new JSDOM("<!DOCTYPE html>");
const added: string[] = [];
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get(): unknown {
        const value: unknown = Reflect.get(dom.window, key);
        return value;
      },
    });
    added.push(key);
  }
}
const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  resolve: { alias: [{ find: "@", replacement: join(root, "src") }] },
  // 一度読むだけなので監視しない（監視すると src-tauri/target まで走査し、読み込みに 10 倍近くかかった）
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: "custom",
});
try {
  const module = await server.ssrLoadModule("/src/web/backend/build-time.ts");
  if (!isBuildTimeModule(module)) {
    throw new Error("src/web/backend/build-time.ts に buildPrebuiltJson がありません");
  }
  // パスはリポジトリのルートから（例: /content/manuals/images/a.png）
  const json = await module.buildPrebuiltJson(async (path) =>
    Uint8Array.from(await readFile(join(root, path))),
  );
  if (typeof json !== "string") {
    throw new Error("buildPrebuiltJson が文字列を返しませんでした");
  }
  await writeFile(output, json);
} finally {
  await server.close();
  for (const key of added) {
    Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
}
