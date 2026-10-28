// テーマ（ライト / ダーク / システム）を <html> のクラスに当てる。色は index.css の :root（ライト）と .dark が持つ。
import { type Theme, useViewerSettings } from "@/features/settings/viewer-settings";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle("dark", resolved === "dark");
}

/**
 * 今の設定をすぐ当て、設定の変更と OS のテーマの変更を追う。起動時に 1 回呼ぶ。
 * OS の変更はシステムの間だけ効く（resolveTheme が見ない）。戻り値の関数を呼ぶと追うのをやめる（テスト用）
 */
export function startThemeSync(): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const apply = (): void => {
    applyTheme(resolveTheme(useViewerSettings.getState().settings.theme, query.matches));
  };
  apply();
  query.addEventListener("change", apply);
  const unsubscribe = useViewerSettings.subscribe((state, previous) => {
    if (state.settings.theme !== previous.settings.theme) {
      apply();
    }
  });
  return () => {
    query.removeEventListener("change", apply);
    unsubscribe();
  };
}
