import { fileName, fileStem } from "@/features/content/path";
import { docHref } from "@/features/library/link";
import { WEB_BASE, WEB_ORIGIN } from "@/lib/web-site";

/** Web 版の文書の id。原稿のファイル名から決まるので、どの端末でも同じになる。 */
export function webDocId(sourcePath: string): string {
  return fileStem(fileName(sourcePath));
}

/**
 * 仲間に送るための、Web 版で文書（anchor を渡せばその節）を開く URL。
 * デスクトップ版の文書の id は端末ごとの DB の UUID でほかの人には開けないので、どの版でも Web 版の URL にする。
 * 検索語のハイライト（hl）は、送った相手の読む邪魔になるので入れない。
 */
export function shareUrl(sourcePath: string, anchor: string | null): string {
  return `${WEB_ORIGIN}${WEB_BASE.replace(/\/$/u, "")}${docHref(webDocId(sourcePath), anchor)}`;
}
