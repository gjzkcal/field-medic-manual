// ビルドのときに変換した原稿の表（WebStore）を、JSON にして同梱する形。
// 変換のコードを読まずに表へ戻せるよう、このファイルは変換（load.ts）を import しない。
import type { NormalizedAsset } from "@/features/content/types";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { QuickrefTable } from "@/lib/bindings/QuickrefTable";
import type { WebStore } from "@/web/backend/store";

export interface PrebuiltAsset {
  id: string;
  fileName: string;
  mime: string;
  /** 中身の base64 */
  base64: string;
}

export interface PrebuiltStore {
  docs: DocDetail[];
  quickref: QuickrefTable;
  assets: PrebuiltAsset[];
}

export function toPrebuilt(store: WebStore): PrebuiltStore {
  return {
    docs: [...store.docs],
    quickref: store.quickref,
    assets: [...store.assets.values()].map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      mime: asset.mime,
      base64: bytesToBase64(asset.bytes),
    })),
  };
}

export function fromPrebuilt(prebuilt: PrebuiltStore): WebStore {
  return {
    docs: prebuilt.docs,
    quickref: prebuilt.quickref,
    assets: new Map(
      prebuilt.assets.map((asset): [string, NormalizedAsset] => [
        asset.id,
        {
          id: asset.id,
          fileName: asset.fileName,
          mime: asset.mime,
          bytes: base64ToBytes(asset.base64),
        },
      ]),
    ),
  };
}

// Uint8Array.toBase64 / fromBase64 は対応するブラウザがまだ新しいので、どこでもある btoa / atob を使う
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
