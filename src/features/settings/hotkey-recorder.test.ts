import { describe, expect, it } from "vitest";

import { acceleratorFromKey, displayAccelerator } from "@/features/settings/hotkey-recorder";

function key(
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): Parameters<typeof acceleratorFromKey>[0] {
  return {
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  };
}

describe("acceleratorFromKey", () => {
  it("Rust が保存する形（Ctrl+Alt+Shift+Super+キー）にそろえる", () => {
    expect(acceleratorFromKey(key("KeyM", { ctrl: true, shift: true }))).toEqual({
      kind: "ok",
      accelerator: "Ctrl+Shift+M",
    });
    expect(acceleratorFromKey(key("Digit2", { alt: true }))).toEqual({
      kind: "ok",
      accelerator: "Alt+2",
    });
    expect(
      acceleratorFromKey(key("F5", { ctrl: true, alt: true, shift: true, meta: true })),
    ).toEqual({ kind: "ok", accelerator: "Ctrl+Alt+Shift+Super+F5" });
    expect(acceleratorFromKey(key("Numpad1", { ctrl: true }))).toEqual({
      kind: "ok",
      accelerator: "Ctrl+Numpad1",
    });
  });

  it("キーボードの配列によらず、物理的なキーの位置で決める", () => {
    // 日本語配列でも英語配列でも、M の位置のキーは KeyM
    expect(acceleratorFromKey(key("KeyM", { ctrl: true }))).toEqual({
      kind: "ok",
      accelerator: "Ctrl+M",
    });
  });

  it("修飾キーだけを押している間は、続きを待つ", () => {
    expect(acceleratorFromKey(key("ControlLeft", { ctrl: true }))).toEqual({ kind: "pending" });
    expect(acceleratorFromKey(key("ShiftRight", { ctrl: true, shift: true }))).toEqual({
      kind: "pending",
    });
  });

  it("Ctrl・Alt・Win を含まない組み合わせは受け付けない（ゲームや文字入力のキーを奪うため）", () => {
    for (const k of [key("KeyM"), key("KeyM", { shift: true }), key("F5")]) {
      expect(acceleratorFromKey(k).kind).toBe("invalid");
    }
  });

  it("登録できないキーは受け付けない", () => {
    expect(acceleratorFromKey(key("IntlYen", { ctrl: true })).kind).toBe("invalid");
    expect(acceleratorFromKey(key("", { ctrl: true })).kind).toBe("invalid");
  });
});

describe("displayAccelerator", () => {
  it("Super は Windows の呼び方（Win）で出す", () => {
    expect(displayAccelerator("Ctrl+Super+M")).toBe("Ctrl + Win + M");
  });
});
