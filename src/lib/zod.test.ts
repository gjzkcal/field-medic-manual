import { describe, expect, it } from "vitest";

import { z } from "@/lib/zod";

describe("zod の設定", () => {
  it("new Function を試さない設定にする", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("アプリのコードは zod を src/lib/zod.ts から読む", () => {
    // 直接読むと、そのスキーマが設定より先に作られることがあり、CSP の違反が報告される
    const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const direct = Object.entries(sources)
      .filter(([, text]) => /from\s+["']zod(\/[^"']*)?["']/.test(text))
      .map(([path]) => path);
    expect(direct).toEqual(["/src/lib/zod.ts"]);
  });
});
