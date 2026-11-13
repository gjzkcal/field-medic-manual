import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { launchHeadlessBrowser } from "./headless-browser.ts";

describe("launchHeadlessBrowser", () => {
  it("実行ファイルが無ければ、落ちずに例外にして、一時プロファイルを残さない", async () => {
    // 手元で計測を流している最中でも、その一時プロファイルと混ざらないよう、置き場所を分ける
    const root = mkdtempSync(join(tmpdir(), "headless-browser-test-"));
    try {
      // 受け手の無い error イベントは Node が例外にしてプロセスごと落とす。ここへ戻ってくること自体が確かめたいこと
      await expect(
        launchHeadlessBrowser(join(root, "no-such-browser.exe"), 9299, root),
      ).rejects.toThrow("ブラウザを起動できませんでした");
      expect(readdirSync(root)).toStrictEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
