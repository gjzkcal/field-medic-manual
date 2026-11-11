// 質問に付ける画像（ゲームのスクリーンショットなど）を、送る前に縮める。
// 画像は会話が続く間、毎回の入力に残るので、トークンを抑えるため長い辺を API が勧める大きさまで落とす。
import type { PreparedImage } from "@/features/chat/chat-store";

/** Claude API が、これより大きい画像は縮めてから読むとしている長い辺の大きさ */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;
export const MAX_IMAGES = 3;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type);
}

/** 縮めた後の大きさ。小さい画像は大きくしない。 */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // 一度に大きな配列を String.fromCharCode に渡すと引数の上限を超えるので、区切って変換する
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 画像を縮めて JPEG にする。スクリーンショットの PNG は JPEG にすると数分の 1 になる。
 *
 * @throws 画像として読めないとき
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const size = fitSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new Error("画像を縮められませんでした");
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return {
    image: { mediaType: "image/jpeg", data: await blobToBase64(blob) },
    view: { url: URL.createObjectURL(blob), name: file.name },
  };
}
