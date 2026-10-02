import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DocPage } from "@/features/library/DocPage";
import { DEFAULT_MOD_SETTINGS, useModSettings } from "@/features/settings/mod-settings";
import type { DocDetail } from "@/lib/bindings/DocDetail";
import type { DocOutline } from "@/lib/bindings/DocOutline";
import type { Section } from "@/lib/bindings/Section";

const ASSET_ID = "a".repeat(64);

function section(id: number, level: number, title: string, anchor: string, html: string): Section {
  return {
    id,
    parentId: null,
    level,
    title,
    anchor,
    orderIndex: id,
    html,
    plainText: "",
    page: null,
    tags: [],
    mods: [],
    withoutMods: [],
  };
}

const META = {
  modTarget: "core",
  modChannel: null,
  modVersion: null,
  verifiedAt: "2026-09-25",
  tags: [],
  order: null,
  category: null,
} as const;

const HEMORRHAGE: DocDetail = {
  id: "d1",
  title: "止血",
  sourceType: "markdown",
  sourcePath: "bundle://manuals/hemorrhage.md",
  sourceHash: "h",
  meta: { ...META, tags: ["出血"] },
  sectionCount: 3,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  originalAssetId: null,
  assets: [{ id: ASSET_ID, mime: "image/png", fileName: "diagram.png", size: 1 }],
  sections: [
    section(
      1,
      1,
      "止血",
      "止血",
      [
        '<p>関連: <a href="cardiac-arrest.md#cpr-%E3%81%AE%E6%89%8B%E9%A0%86">CPR</a></p>',
        '<p><a href="https://anvil.acemod.org/dev/">出典</a></p>',
        "<script>window.__hacked = true</script>",
        '<img src="x" onerror="window.__hacked = true">',
      ].join(""),
    ),
    section(
      2,
      2,
      "止血帯を使う",
      "止血帯を使う",
      [
        "<table><thead><tr><th>程度</th></tr></thead><tbody><tr><td>Class I</td></tr></tbody></table>",
        '<blockquote class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">警告</p><p>放置しない</p></blockquote>',
        `<p><img alt="図" data-asset-id="${ASSET_ID}"></p>`,
      ].join(""),
    ),
    section(3, 2, "包帯を巻く", "包帯を巻く", "<p>包帯</p>"),
  ],
};

// MOD の組み合わせで分かれた節。条件は変換で親から子へ合わせてあるので、子も親と同じ条件を持つ
const CARDIAC_ARREST: DocDetail = {
  ...HEMORRHAGE,
  id: "d3",
  title: "心停止",
  sourcePath: "bundle://manuals/cardiac-arrest.md",
  assets: [],
  sections: [
    section(10, 1, "心停止", "心停止", "<p>共通</p>"),
    {
      ...section(11, 2, "Circulation を入れている場合", "circ", "<p>CPR をする</p>"),
      mods: ["circulation"],
    },
    {
      ...section(12, 2, "Circulation なし（Core だけ）の場合", "no-circ", "<p>CPR はない</p>"),
      withoutMods: ["circulation"],
    },
    {
      ...section(13, 3, "Core の蘇生", "core-revive", "<p>エピネフリン</p>"),
      withoutMods: ["circulation"],
    },
    section(14, 2, "関連ページ", "関連ページ", "<p>リンク</p>"),
  ],
};

const OUTLINE: DocOutline[] = [
  {
    id: "d1",
    title: "止血",
    sourcePath: "bundle://manuals/hemorrhage.md",
    meta: HEMORRHAGE.meta,
    headings: [
      { level: 2, title: "止血帯を使う", anchor: "止血帯を使う", mods: [], withoutMods: [] },
    ],
  },
  {
    id: "d2",
    title: "心停止と CPR",
    sourcePath: "bundle://manuals/cardiac-arrest.md",
    meta: HEMORRHAGE.meta,
    headings: [
      { level: 2, title: "CPR の手順", anchor: "cpr-の手順", mods: [], withoutMods: [] },
      {
        level: 2,
        title: "Breathing を入れているとき",
        anchor: "breathing",
        mods: ["breathing"],
        withoutMods: [],
      },
      {
        level: 2,
        title: "Circulation を入れている場合",
        anchor: "circulation",
        mods: ["circulation"],
        withoutMods: [],
      },
    ],
  },
];

const opened: unknown[] = [];
const revoked: string[] = [];

beforeEach(() => {
  useModSettings.setState({ settings: DEFAULT_MOD_SETTINGS });
  opened.length = 0;
  revoked.length = 0;
  // jsdom にない API の代わり（Blob URL、要素のスクロール、要素の大きさの監視）
  let n = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:test/${String(++n)}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
  Element.prototype.scrollTo = function scrollTo(): void {
    // 位置の計算は jsdom ではできないので、呼べることだけを確かめる
  };
  // Base UI の ScrollArea がスクロールバーの表示を切り替えるときに使う
  Element.prototype.getAnimations = (): Animation[] => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        // 何もしない
      }
      unobserve(): void {
        // 何もしない
      }
      disconnect(): void {
        // 何もしない
      }
    },
  );
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "doc_get":
        return args === undefined || !("id" in args)
          ? Promise.reject(new Error("unexpected"))
          : args["id"] === "d1"
            ? HEMORRHAGE
            : args["id"] === "d3"
              ? CARDIAC_ARREST
              : Promise.reject(new Error("unexpected"));
      case "doc_outline":
        return OUTLINE;
      case "asset_get":
        return new ArrayBuffer(1);
      case "plugin:opener|open_url":
        opened.push(args);
        return null;
      default:
        return null;
    }
  });
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.unstubAllGlobals();
});

function renderDoc(path: string): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      { path: "/doc/:id", element: <DocPage /> },
      { path: "/library", element: <p>ライブラリ</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

describe("DocPage", () => {
  it("本文を描画し、表示の直前にも無害化する", async () => {
    renderDoc("/doc/d1");

    expect(await screen.findByRole("heading", { level: 2, name: "止血帯を使う" })).toBeDefined();
    const article = document.querySelector("article");
    expect(article?.querySelector("table td")?.textContent).toBe("Class I");
    expect(article?.querySelector(".markdown-alert-warning")?.textContent).toContain("警告");
    expect(article?.querySelector("script")).toBeNull();
    expect(article?.querySelector("[onerror]")).toBeNull();
    // モジュールとタグはタイトル（h1）の直下、版と確認日は末尾のフッター
    const h1 = screen.getByRole("heading", { level: 1, name: "止血" });
    expect(h1.nextElementSibling?.textContent).toContain("Core");
    expect(h1.nextElementSibling?.textContent).toContain("#出血");
    const footer = article?.querySelector("footer");
    expect(footer?.textContent).toContain("版を問わない");
    expect(footer?.textContent).toContain("2026-09-25");
    expect(article?.lastElementChild).toBe(footer);
    // 目次にも見出しが並ぶ
    expect(screen.getByRole("navigation", { name: "目次" }).textContent).toContain("包帯を巻く");
  });

  it("画像に Blob URL を付け、画面を離れると解放する", async () => {
    renderDoc("/doc/d1");

    const img = await screen.findByAltText("図");
    await waitFor(() => {
      expect(img.getAttribute("src")).toMatch(/^blob:test\//);
    });
    const url = img.getAttribute("src");

    cleanup();
    expect(revoked).toContain(url);
  });

  it("外部リンクはブラウザで開き、アプリ内では遷移しない", async () => {
    const router = renderDoc("/doc/d1");

    fireEvent.click(await screen.findByText("出典"));

    await waitFor(() => {
      expect(opened).toEqual([expect.objectContaining({ url: "https://anvil.acemod.org/dev/" })]);
    });
    expect(router.state.location.pathname).toBe("/doc/d1");
  });

  it("相対パスの md のリンクは、sourcePath で探した文書のアンカーへ移る", async () => {
    const router = renderDoc("/doc/d1");
    await screen.findByRole("heading", { level: 2, name: "止血帯を使う" });

    await waitFor(() => {
      // 目次のツリー（doc_outline）を読み終えてから押す
      expect(document.body.textContent).toContain("心停止と CPR");
    });
    fireEvent.click(screen.getByText("CPR"));

    expect(router.state.location.pathname).toBe("/doc/d2");
    expect(decodeURIComponent(router.state.location.hash)).toBe("#cpr-の手順");
  });

  it("検索結果から開いたときは検索語をハイライトし、目次で移ると消す", async () => {
    // jsdom には CSS Custom Highlight API がないので、登録された範囲だけを見られる代わりを置く
    const highlights = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal(
      "Highlight",
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    const router = renderDoc(
      `/doc/d1?hl=${encodeURIComponent("包帯")}#${encodeURIComponent("包帯を巻く")}`,
    );
    await screen.findByRole("heading", { level: 2, name: "包帯を巻く" });

    await waitFor(() => {
      // 見出しと本文の 2 か所（目次の中は本文の外なので数えない）
      expect(highlights.get("search-hit")?.ranges.map(String)).toEqual(["包帯", "包帯"]);
    });

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "目次" })).getByText("止血帯を使う"),
    );
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(highlights.has("search-hit")).toBe(false);
  });

  it("設定の MOD に合わない節を外し、合う節は見出しの代わりにラベルで出し、スイッチですべて出す", async () => {
    renderDoc("/doc/d3");

    expect(await screen.findByText("CPR をする")).toBeDefined();
    // 合う組み合わせの節は、見出しではなくラベルにして目次からも外す
    expect(screen.queryByRole("heading", { name: "Circulation を入れている場合" })).toBeNull();
    const label = document.querySelector('[data-anchor="circ"]');
    expect(label?.textContent).toBe("Circulation あり");
    expect(screen.queryByText("CPR はない")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Core の蘇生" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "関連ページ" })).toBeDefined();
    const toc = screen.getByRole("navigation", { name: "目次" });
    expect(toc.textContent).toContain("関連ページ");
    expect(toc.textContent).not.toContain("Circulation");
    expect(document.body.textContent).toContain(
      "Core + Circulation + Breathing に合う節を表示しています（設定で変更）。2 節を省略",
    );

    fireEvent.click(screen.getByRole("switch", { name: "すべての組み合わせを表示" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Circulation を入れている場合" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "Circulation なし（Core だけ）の場合" }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Core の蘇生" })).toBeDefined();
    expect(document.body.textContent).toContain("すべての組み合わせの節を表示しています");
  });

  it("隠れる節をアンカーで直接開いたときは、隠れている親からまとめて出して印を付ける", async () => {
    renderDoc(`/doc/d3#${encodeURIComponent("core-revive")}`);

    const parent = await screen.findByRole("heading", {
      level: 2,
      name: "Circulation なし（Core だけ）の場合",
    });
    expect(screen.getByRole("heading", { level: 3, name: "Core の蘇生" })).toBeDefined();
    expect(parent.nextElementSibling?.textContent).toContain(
      "今の MOD の設定では表示しない組み合わせです（Circulation なし）",
    );
  });

  it("ツリーの他の文書の見出しも設定の MOD で絞る", async () => {
    useModSettings.setState({ settings: { enabled: ["circulation"] } });
    renderDoc("/doc/d1");
    await screen.findByRole("heading", { level: 2, name: "止血帯を使う" });

    const tree = screen.getByRole("navigation", { name: "マニュアルの見出し" });
    fireEvent.click(within(tree).getByRole("button", { name: "心停止と CPRの見出しを開く" }));

    expect(within(tree).getByText("CPR の手順")).toBeDefined();
    expect(within(tree).queryByText("Breathing を入れているとき")).toBeNull();
    // 合う組み合わせの見出しも、本文ではラベルになるのでツリーには出さない
    expect(within(tree).queryByText("Circulation を入れている場合")).toBeNull();
  });

  it("見つからない文書はその旨を出す", async () => {
    mockIPC((cmd) => {
      if (cmd === "doc_get") {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tauri はコマンドのエラーを Error ではなく AppError の素のオブジェクトで reject する。それを再現する
        return Promise.reject({ kind: "not_found", message: "見つかりません: d9" });
      }
      return [];
    });
    renderDoc("/doc/d9");

    expect(await screen.findByText("マニュアルが見つかりません")).toBeDefined();
  });
});
