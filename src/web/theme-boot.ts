// Web 版の <head> に直接書くスクリプト。JS の本体を読み込むまでの「読み込んでいます…」の表示から、選んだテーマで出すため。
// vite.config.ts が読み、CSP の script-src にこの文字列のハッシュを足す（インラインのスクリプトはハッシュでしか許さない）。
// vite.config.ts から読むので、@/ の別名は使えない
import { LOCAL_SETTINGS_PREFIX } from "./storage-keys.ts";

/** src/features/settings/viewer-settings.ts の VIEWER_SETTINGS_KEY と同じ（テストで突き合わせる） */
const VIEWER_KEY = "viewer";

/**
 * 判定は src/features/settings/theme.ts の resolveTheme と同じ規則（light・dark 以外はシステム）。
 * localStorage を読めない・壊れているときは OS に合わせる
 */
export const THEME_BOOT_SCRIPT = `(()=>{let d=matchMedia("(prefers-color-scheme: dark)").matches;try{const t=JSON.parse(localStorage.getItem(${JSON.stringify(LOCAL_SETTINGS_PREFIX + VIEWER_KEY)}))?.theme;if(t==="light"||t==="dark")d=t==="dark"}catch{}if(d)document.documentElement.classList.add("dark")})()`;
