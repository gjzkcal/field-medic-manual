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

function memoryStorage(): () => Storage {
  const items = new Map<string, string>();
  const storage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  // テストで使う 2 つの関数だけを持つ偽物。残りは呼ばない
  return () => storage as Storage;
}

function person(id: string, records: Casualty["records"] = []): Casualty {
  return { id, name: id, createdAtMs: NOW, records };
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
    expect(list[0]?.records).toEqual([]);
    expect(applyOp(list, { op: "clear_all" }, NOW, ids)).toEqual([]);
  });

  it("人数と記録の上限を超えるものは受け付けない", () => {
    const ids = counter();
    const full = Array.from({ length: 20 }, (_, i) => person(`p${String(i)}`));
    expect(() => applyOp(full, { op: "add_casualty", name: "多い" }, NOW, ids)).toThrow(/20 人/);
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
    expect(() => applyOp([person("p", records)], op, NOW, ids)).toThrow(/100 件/);
  });

  it("文字数は Rust と同じくコードポイントで数える", () => {
    const ids = counter();
    expect(applyOp([], { op: "add_casualty", name: "😀".repeat(40) }, NOW, ids)).toHaveLength(1);
    expect(() => applyOp([], { op: "add_casualty", name: "😀".repeat(41) }, NOW, ids)).toThrow();
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
      expect(() => applyOp([person("p")], op, NOW, counter()), JSON.stringify(op)).toThrow();
    }
  });
});

describe("保存した記録の読み込み", () => {
  it("正しい形はそのまま読む", () => {
    const list = [person("p", [{ id: "r", atMs: NOW, entry: { kind: "saline" } }])];
    expect(parseStoredCasualties(list)).toEqual(list);
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
    expect(parseStoredCasualties(value)).toEqual([]);
  });

  it("保存して読み直せる。JSON が壊れていても失敗しない", () => {
    const storage = memoryStorage();
    applyAndSave({ op: "add_casualty", name: "田中" }, storage);
    expect(readCasualties(storage)[0]?.name).toBe("田中");
    storage().setItem(LOCAL_CASUALTIES_KEY, "{");
    expect(readCasualties(storage)).toEqual([]);
  });

  it("書く直前に読み直すので、別のタブが足した分を消さない", () => {
    const storage = memoryStorage();
    applyAndSave({ op: "add_casualty", name: "タブ 1" }, storage);
    applyAndSave({ op: "add_casualty", name: "タブ 2" }, storage);
    expect(readCasualties(storage).map((c) => c.name)).toEqual(["タブ 1", "タブ 2"]);
  });

  it("書けなければ io のエラーにする", () => {
    const failing = (): Storage => {
      const storage: Pick<Storage, "getItem" | "setItem"> = {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      };
      return storage as Storage;
    };
    expect(() => applyAndSave({ op: "add_casualty", name: "田中" }, failing)).toThrow(
      /ブラウザに保存できません/,
    );
  });

  it("キーは設定の頭と別にする", () => {
    expect(LOCAL_CASUALTIES_KEY.startsWith(LOCAL_SETTINGS_PREFIX)).toBe(false);
  });
});
