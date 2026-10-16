// vite.config.ts のプラグインが作る、ビルドのときに変換した原稿の表
declare module "virtual:web-store" {
  import type { PrebuiltStore } from "@/web/backend/prebuilt";

  const store: PrebuiltStore;
  export default store;
}
