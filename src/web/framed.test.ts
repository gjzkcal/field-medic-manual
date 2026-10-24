import { describe, expect, it } from "vitest";

import { isFramed } from "@/web/framed";

describe("isFramed", () => {
  it("最上位で開いたときは枠の中ではない", () => {
    expect(isFramed()).toBe(false);
    const top = {};
    expect(isFramed({ top, self: top })).toBe(false);
  });

  it("親があれば枠の中とみなす", () => {
    expect(isFramed({ top: {}, self: {} })).toBe(true);
  });

  it("親を比べられないときも枠の中とみなす", () => {
    const win = {
      get top(): unknown {
        throw new Error("SecurityError");
      },
      self: {},
    };
    expect(isFramed(win)).toBe(true);
  });
});
