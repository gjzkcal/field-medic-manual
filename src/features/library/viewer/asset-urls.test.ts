import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetUrlCache, type LoadAsset } from "@/features/library/viewer/asset-urls";

const noop = (): void => undefined;

let created: Blob[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked.length = 0;
  // jsdom には Blob URL がないので、作成と解放を記録するだけの代わりを置く
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return `blob:test/${String(created.length)}`;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetUrlCache", () => {
  it("同じ画像は 1 回だけ読み、MIME を付けた Blob にする", async () => {
    const load = vi.fn<LoadAsset>(() => Promise.resolve(new ArrayBuffer(4)));
    const cache = new AssetUrlCache(load, () => "image/svg+xml");

    const [a, b] = await Promise.all([cache.get("x"), cache.get("x")]);

    expect(a).toBe("blob:test/1");
    expect(b).toBe(a);
    expect(load).toHaveBeenCalledOnce();
    expect(created[0]?.type).toBe("image/svg+xml");
  });

  it("revokeAll ですべて解放し、その後に読み終わったものもすぐ解放する", async () => {
    let finish: (bytes: ArrayBuffer) => void = noop;
    const late = new Promise<ArrayBuffer>((resolve) => {
      finish = resolve;
    });
    const load = vi.fn<LoadAsset>((id: string) =>
      id === "late" ? late : Promise.resolve(new ArrayBuffer(1)),
    );
    const cache = new AssetUrlCache(load, () => undefined);

    const first = await cache.get("x");
    const pending = cache.get("late");
    cache.revokeAll();
    expect(revoked).toStrictEqual([first]);

    finish(new ArrayBuffer(1));
    await expect(pending).rejects.toThrow("画面を離れたため画像の表示をやめました");
    expect(revoked).toHaveLength(2);

    // 解放した後も、読み直せば使える（StrictMode で effect がやり直されたときのため）
    await expect(cache.get("x")).resolves.toMatch(/^blob:test\//u);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("読めなかった画像は覚えず、次に読み直す", async () => {
    const load = vi
      .fn<(id: string) => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(new ArrayBuffer(1));
    const cache = new AssetUrlCache(load, () => undefined);

    await expect(cache.get("x")).rejects.toThrow("not found");
    await expect(cache.get("x")).resolves.toBe("blob:test/1");
  });
});
