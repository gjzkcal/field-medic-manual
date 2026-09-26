// テストで content/ の原稿を読むための補助。Node の API を使うのでテスト専用（tsconfig.test.json）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ReadImage } from "@/features/content/types";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** リポジトリのルートからのパス（/content/manuals/images/a.png）で、実際のファイルを読む。 */
export const readRepoFile: ReadImage = (path) =>
  Promise.resolve(new Uint8Array(readFileSync(resolve(REPO_ROOT, `.${path}`))));

/** 呼ばれたら失敗させる ReadImage（画像を読まないはずのテスト用）。 */
export const noImages: ReadImage = (path) =>
  Promise.reject(new Error(`読むはずのない画像: ${path}`));
