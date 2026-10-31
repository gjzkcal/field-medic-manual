const MAX_APP_PATH_LENGTH = 4096;

/**
 * `/` で始まるアプリ内のパスか。`//host` と `/\host` はブラウザが別のホストとして読むので通さない。
 * アプリの作る URL は `\` と制御文字を % エンコードするので、生のまま含むものは不正とみなす。
 * Rust 側の `is_app_path`（src-tauri/src/commands/window.rs）と同じ判定にする。
 */
export function isAppPath(href: string): boolean {
  return (
    href.length <= MAX_APP_PATH_LENGTH &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.includes("\\") &&
    !/\p{Cc}/u.test(href)
  );
}
