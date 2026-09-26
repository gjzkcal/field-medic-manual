// 本文の画像（`<img data-asset-id>`）を Blob URL にする。asset プロトコルを開かずに済ませるため（00-overview.md §5）。

export type LoadAsset = (id: string) => Promise<ArrayBuffer>;

/**
 * 1 つのドキュメントを表示している間の Blob URL の置き場。同じ画像は 1 回だけ読む。
 * Blob URL は revoke するまでメモリに残るので、画面を離れるときに `revokeAll` を呼ぶ。
 */
export class AssetUrlCache {
  readonly #load: LoadAsset;
  readonly #mimeOf: (id: string) => string | undefined;
  readonly #pending = new Map<string, Promise<string>>();
  readonly #created = new Set<string>();
  // revokeAll の後に読み終わった画像の URL を、使われないまま残さないための世代番号
  #generation = 0;

  constructor(load: LoadAsset, mimeOf: (id: string) => string | undefined) {
    this.#load = load;
    this.#mimeOf = mimeOf;
  }

  get(id: string): Promise<string> {
    const cached = this.#pending.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const generation = this.#generation;
    const promise = this.#load(id).then((bytes) => {
      // 型を付けないと SVG が画像として表示されない
      const type = this.#mimeOf(id) ?? "";
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      if (generation !== this.#generation) {
        URL.revokeObjectURL(url);
        throw new Error("画面を離れたため画像の表示をやめました");
      }
      this.#created.add(url);
      return url;
    });
    this.#pending.set(id, promise);
    // 失敗した画像は、次に表示するときに読み直せるよう覚えておかない
    promise.catch(() => {
      if (this.#pending.get(id) === promise) {
        this.#pending.delete(id);
      }
    });
    return promise;
  }

  revokeAll(): void {
    this.#generation++;
    for (const url of this.#created) {
      URL.revokeObjectURL(url);
    }
    this.#created.clear();
    this.#pending.clear();
  }
}
