// vite.config.ts のプラグインが作る、ビルドのときに変換した原稿の表を読む関数の表。
// Web 版のビルド以外（開発サーバー・テスト）は実行時に変換するので null
declare module "virtual:web-store" {
  import type { PartLoaders } from "@/web/backend/prebuilt";

  const loaders: PartLoaders | null;
  export default loaders;
}
