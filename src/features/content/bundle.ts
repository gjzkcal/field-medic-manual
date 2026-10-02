// content/manuals/ の原稿と画像とグラフの CSV をアプリに同梱する。
// import.meta.glob はビルド時に展開されるので、原稿を足すだけでここを直さずに同梱される。
import { sha256HexOfText } from "@/features/content/hash";
import { fileName } from "@/features/content/path";
import type { ManualSource, ReadData, ReadImage } from "@/features/content/types";

const MANUAL_TEXTS = import.meta.glob<string>("/content/manuals/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * 原稿の変換の版。変換の出力（保存する HTML・読み取るメタデータ）を変えたら上げる。
 * DB の原稿はハッシュが同じなら入れ直さないので、上げないと更新後も古い変換結果が残る。
 */
const CONVERTER_VERSION = 7;

// 画像は本文に比べて大きいので、中身ではなく URL を同梱し、DB に入れるときにだけ読む
const IMAGE_URLS = import.meta.glob<string>("/content/manuals/images/*", {
  query: "?url",
  import: "default",
  eager: true,
});

// グラフの CSV は小さいので中身ごと同梱する
const DATA_TEXTS = import.meta.glob<string>("/content/manuals/data/*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** 同梱した原稿の一覧（ファイル名順）。 */
export async function bundledManuals(): Promise<ManualSource[]> {
  // 本番ビルドの URL には中身のハッシュが入るので、画像だけを差し替えても原稿の変更として検出できる
  const imageFingerprint = Object.entries(IMAGE_URLS)
    .map(([path, url]) => `${path}=${url}`)
    .sort()
    .join("\n");
  // どの原稿がどの CSV を使うかは変換するまで分からないので、CSV の中身をすべての原稿のハッシュに混ぜる
  const dataFingerprint = Object.entries(DATA_TEXTS)
    .map(([path, text]) => `${path}\n${text}`)
    .sort()
    .join("\0");
  const manuals = await Promise.all(
    Object.entries(MANUAL_TEXTS).map(async ([path, text]) => ({
      fileName: fileName(path),
      path,
      text,
      hash: await sha256HexOfText(
        `${text}\n\0${imageFingerprint}\n\0${dataFingerprint}\n\0${String(CONVERTER_VERSION)}`,
      ),
    })),
  );
  return manuals.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** 同梱した画像を読む。パスはリポジトリのルートから（例: /content/manuals/images/a.png）。 */
export const readBundledImage: ReadImage = async (path) => {
  const url = IMAGE_URLS[path];
  if (url === undefined) {
    throw new Error(`同梱されていない画像です（content/manuals/images/ に置いてください）: ${path}`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`画像を読めません（${String(response.status)}）: ${path}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/** 同梱したグラフの CSV を読む。パスはリポジトリのルートから（例: /content/manuals/data/a.csv）。 */
export const readBundledData: ReadData = (path) => {
  const text = DATA_TEXTS[path];
  return text === undefined
    ? Promise.reject(
        new Error(`同梱されていない CSV です（content/manuals/data/ に置いてください）: ${path}`),
      )
    : Promise.resolve(text);
};
