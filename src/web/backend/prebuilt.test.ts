import { describe, expect, it } from "vitest";

import type { NormalizedAsset } from "@/features/content/types";
import { CONVERT_TIMEOUT_MS } from "@/test/samples";
import { bleeding, EMPTY_QUICKREF } from "@/test/web-fixtures";
import { loadWebStore } from "@/web/backend/load";
import { fromPrebuilt, toPrebuilt } from "@/web/backend/prebuilt";
import { buildStore, type WebStore } from "@/web/backend/store";

/** 同梱するときと同じく JSON の文字列にしても形が崩れないことを確かめてから、表に戻す */
function roundTrip(store: WebStore): WebStore {
  const prebuilt = toPrebuilt(store);
  expect(JSON.parse(JSON.stringify(prebuilt))).toEqual(prebuilt);
  return fromPrebuilt(prebuilt);
}

describe("ビルドのときに変換した原稿の表", () => {
  it(
    "同梱の原稿とクイック表は、JSON を通しても同じ表に戻る",
    { timeout: CONVERT_TIMEOUT_MS * 2 },
    async () => {
      const store = await loadWebStore();
      expect(roundTrip(store)).toEqual(store);
    },
  );

  it("画像の中身（0〜255 のバイト）をそのまま戻す", () => {
    const asset: NormalizedAsset = {
      id: "a".repeat(64),
      fileName: "a.png",
      mime: "image/png",
      bytes: Uint8Array.from({ length: 256 }, (_, i) => i),
    };
    const doc = { ...bleeding(), assets: [asset] };
    const store = buildStore([doc], EMPTY_QUICKREF, "2026-10-16T00:00:00.000Z");
    expect(roundTrip(store).assets.get(asset.id)).toEqual(asset);
  });
});
