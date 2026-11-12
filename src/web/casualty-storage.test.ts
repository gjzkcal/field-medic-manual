import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Casualty } from "@/lib/bindings/Casualty";
import type { CasualtyOp } from "@/lib/bindings/CasualtyOp";
import { REPO_ROOT } from "@/test/samples";
import {
  applyAndSave,
  applyOp,
  parseStoredCasualties,
  readCasualties,
} from "@/web/casualty-storage";
import { LOCAL_CASUALTIES_KEY, LOCAL_SETTINGS_PREFIX } from "@/web/storage-keys";

const NOW = 1_793_000_000_000;

function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `id-${String(n)}`;
  };
}

// Storage には添字のシグネチャがあり、クラスで満たすには宣言が要る
class MemoryStorage implements Storage {
  [name: string]: unknown;
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("quota");
  }
}

function memoryStorage(): () => Storage {
  const storage = new MemoryStorage();
  return () => storage;
}

function person(id: string, records: Casualty["records"] = []): Casualty {
  return { id, name: id, createdAtMs: NOW, inPain: true, records };
}

describe("applyOp", () => {
  it("負傷者と記録を足し、消せる", () => {
    const ids = counter();
    let list = applyOp([], { op: "add_casualty", name: " 田中 " }, NOW, ids);
    expect(list[0]?.name).toBe("田中");
    const casualtyId = list[0]?.id ?? "";
    list = applyOp(
      list,
      { op: "add_record", casualtyId, entry: { kind: "drug", drug: "morphine" } },
      NOW + 1,
      ids,
    );
    const recordId = list[0]?.records[0]?.id ?? "";
    expect(list[0]?.records[0]?.atMs).toBe(NOW + 1);
    list = applyOp(list, { op: "remove_record", casualtyId, recordId }, NOW, ids);
    expect(list[0]?.records).toStrictEqual([]);
    expect(applyOp(list, { op: "clear_all" }, NOW, ids)).toStrictEqual([]);
  });

  it("痛み・気胸は、足したときはありで、切り替えられる", () => {
    const ids = counter();
    let list = applyOp([], { op: "add_casualty", name: "田中" }, NOW, ids);
    expect(list[0]?.inPain).toBe(true);
    const casualtyId = list[0]?.id ?? "";
    list = applyOp(list, { op: "set_pain", casualtyId, inPain: false }, NOW, ids);
    expect(list[0]?.inPain).toBe(false);
  });

  it("人数と記録の上限を超えるものは受け付けない", () => {
    const ids = counter();
    const full = Array.from({ length: 20 }, (_, i) => person(`p${String(i)}`));
    expect(() => applyOp(full, { op: "add_casualty", name: "多い" }, NOW, ids)).toThrow(
      /負傷者は 20 人までです/u,
    );
    const records = Array.from({ length: 100 }, (_, i) => ({
      id: `r${String(i)}`,
      atMs: NOW,
      entry: { kind: "saline" } as const,
    }));
    const op: CasualtyOp = {
      op: "add_record",
      casualtyId: "p",
      entry: { kind: "saline" },
    };
    expect(() => applyOp([person("p", records)], op, NOW, ids)).toThrow(
      /記録は 1 人 100 件までです/u,
    );
  });

  it("文字数は Rust と同じくコードポイントで数える", () => {
    const ids = counter();
    expect(applyOp([], { op: "add_casualty", name: "😀".repeat(40) }, NOW, ids)).toHaveLength(1);
    expect(() => applyOp([], { op: "add_casualty", name: "😀".repeat(41) }, NOW, ids)).toThrow(
      /記録の内容が不正です/u,
    );
  });

  it("Rust のテストと同じ不正な操作を受け付けない", () => {
    const parsed: unknown = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "src-tauri/src/db/testdata/casualty-invalid-ops.json"),
        "utf8",
      ),
    );
    const cases: unknown[] = Array.isArray(parsed) ? parsed : [];
    expect(cases.length).toBeGreaterThan(0);
    for (const value of cases) {
      const text = JSON.stringify(value).replaceAll("$CASUALTY", "p");
      const op: unknown = JSON.parse(text);
      expect(() => applyOp([person("p")], op, NOW, counter())).toThrow(
        /記録の内容が不正です|負傷者が見つかりません/u,
      );
    }
  });
});

describe("保存した記録の読み込み", () => {
  it("正しい形はそのまま読む", () => {
    const list = [person("p", [{ id: "r", atMs: NOW, entry: { kind: "saline" } }])];
    expect(parseStoredCasualties(list)).toStrictEqual(list);
  });

  it("痛み・気胸を足す前に保存した記録は、ありとして読む", () => {
    const old = { id: "p", name: "p", createdAtMs: NOW, records: [] };
    expect(parseStoredCasualties([old])).toStrictEqual([person("p")]);
    expect(parseStoredCasualties([{ ...old, inPain: "yes" }])).toStrictEqual([]);
  });

  it.each([
    ["配列でない", { a: 1 }],
    ["時刻が文字列", [{ ...person("p"), createdAtMs: "x" }]],
    ["知らないキー", [{ ...person("p"), extra: 1 }]],
    ["名前が長い", [{ ...person("p"), name: "あ".repeat(41) }]],
    ["人数が多い", Array.from({ length: 21 }, (_, i) => person(String(i)))],
    [
      "記録の中身が不正",
      [{ ...person("p"), records: [{ id: "r", atMs: NOW, entry: { kind: "drug", drug: "x" } }] }],
    ],
  ])("%s なら空にする", (_, value) => {
    expect(parseStoredCasualties(value)).toStrictEqual([]);
  });

  it("保存して読み直せる。JSON が壊れていても失敗しない", () => {
    const storage = memoryStorage();
    applyAndSave({ op: "add_casualty", name: "田中" }, storage);
    expect(readCasualties(storage)[0]?.name).toBe("田中");
    storage().setItem(LOCAL_CASUALTIES_KEY, "{");
    expect(readCasualties(storage)).toStrictEqual([]);
  });

  it("書く直前に読み直すので、別のタブが足した分を消さない", () => {
    const storage = memoryStorage();
    applyAndSave({ op: "add_casualty", name: "タブ 1" }, storage);
    applyAndSave({ op: "add_casualty", name: "タブ 2" }, storage);
    expect(readCasualties(storage).map((c) => c.name)).toStrictEqual(["タブ 1", "タブ 2"]);
  });

  it("書けなければ io のエラーにする", () => {
    const full = new FullStorage();
    expect(() => applyAndSave({ op: "add_casualty", name: "田中" }, () => full)).toThrow(
      /ブラウザに保存できません/u,
    );
  });

  it("キーは設定の頭と別にする", () => {
    expect(LOCAL_CASUALTIES_KEY.startsWith(LOCAL_SETTINGS_PREFIX)).toBe(false);
  });
});
