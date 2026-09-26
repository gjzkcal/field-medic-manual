// content/manuals/ の原稿と画像をアプリに同梱する（dev-docs/reference/bundled-content.md §3）。
// import.meta.glob はビルド時に展開されるので、原稿を足すだけでここを直さずに同梱される。
import { sha256HexOfText } from "@/features/content/hash";
import { fileName } from "@/features/content/path";
import type { ManualSource, ReadImage } from "@/features/content/types";

const MANUAL_TEXTS = import.meta.glob<string>("/content/manuals/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// 画像は本文に比べて大きいので、中身ではなく URL を同梱し、DB に入れるときにだけ読む
const IMAGE_URLS = import.meta.glob<string>("/content/manuals/images/*", {
  query: "?url",
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
  const manuals = await Promise.all(
    Object.entries(MANUAL_TEXTS).map(async ([path, text]) => ({
      fileName: fileName(path),
      path,
      text,
      hash: await sha256HexOfText(`${text}\n\0${imageFingerprint}`),
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
