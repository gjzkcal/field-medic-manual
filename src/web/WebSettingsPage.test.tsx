import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebSettingsPage } from "@/web/WebSettingsPage";

vi.mock(import("@/lib/platform"), () => ({ IS_WEB: true }));

afterEach(() => {
  cleanup();
});

describe("WebSettingsPage", () => {
  // ホットキー・小窓・AI・PC のフォルダは、ブラウザでは使えない。使えない設定を出さない
  it("Web 版で使える設定のカードだけを出す", () => {
    render(<WebSettingsPage />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toStrictEqual([
      "表示",
      "使っている MOD",
      "負傷者",
      "トリアージ",
    ]);
    expect(screen.queryByRole("button", { name: "保存場所を開く" })).toBeNull();
    expect(screen.getByText(/^実行画面のキー操作。/u)).toBeDefined();
  });
});
