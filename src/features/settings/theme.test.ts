import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, resolveTheme, startThemeSync } from "@/features/settings/theme";
import { DEFAULT_VIEWER_SETTINGS, useViewerSettings } from "@/features/settings/viewer-settings";

/** jsdom には matchMedia がないので、OS のテーマを切り替えられる偽物を置く */
function mockOsTheme(initialDark: boolean): (dark: boolean) => void {
  let matches = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" && matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (dark) => {
    matches = dark;
    for (const listener of listeners) {
      listener();
    }
  };
}

const root = document.documentElement;
let stop: (() => void) | undefined;

beforeEach(() => {
  root.className = "";
  useViewerSettings.setState({ settings: DEFAULT_VIEWER_SETTINGS });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("ライト・ダークは OS によらずそのまま、システムは OS に合わせる", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("applyTheme", () => {
  it("ダークのときだけ dark のクラスを付ける（ライトは :root の色）", () => {
    applyTheme("dark", root);
    expect([...root.classList]).toEqual(["dark"]);
    applyTheme("light", root);
    expect([...root.classList]).toEqual([]);
  });

  it("ほかのクラス（小窓の overlay-window）は残す", () => {
    root.classList.add("overlay-window");
    applyTheme("dark", root);
    expect(root.classList.contains("overlay-window")).toBe(true);
  });
});

describe("startThemeSync", () => {
  it("既定（システム）は OS に合わせ、OS が変わったらすぐ切り替える", () => {
    const setOsDark = mockOsTheme(true);
    stop = startThemeSync();
    expect(root.classList.contains("dark")).toBe(true);

    setOsDark(false);
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("設定を変えたらすぐ当て、ライト・ダークの間は OS の変更を無視する", () => {
    const setOsDark = mockOsTheme(false);
    stop = startThemeSync();
    expect(root.classList.contains("dark")).toBe(false);

    useViewerSettings.setState({ settings: { ...DEFAULT_VIEWER_SETTINGS, theme: "dark" } });
    expect(root.classList.contains("dark")).toBe(true);

    setOsDark(false);
    expect(root.classList.contains("dark")).toBe(true);
  });
});
