// pnpm build:web のときに Node で読むファイル（scripts/web-prebuild.ts が Vite の ssrLoadModule で読む）。
// ブラウザのバンドルには入らない。
import type { ReadImage } from "@/features/content/types";
import { loadWebStore } from "@/web/backend/load";
import { toPrebuilt } from "@/web/backend/prebuilt";

/** 同梱物を今と同じ規則で変換し、同梱する JSON にする。画像は Node では fetch できないので、読む関数を渡す */
export async function buildPrebuiltJson(readImage: ReadImage): Promise<string> {
  return JSON.stringify(toPrebuilt(await loadWebStore(readImage)));
}
