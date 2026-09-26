// Windows のパス（`C:\dir\a.md`）と `/` 区切りの両方を扱う小さな関数群。
// Node の path は WebView にないため自前で持つ。

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 拡張子を除いたファイル名。タイトルの初期値に使う。 */
export function fileStem(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 小文字のドット付き拡張子（なければ空文字）。 */
export function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * `baseFile` のあるフォルダを基準に相対パスを解決する。区切りは baseFile に合わせる。
 * URL（`http:` など）や絶対パスは相対パスではないので null を返す。
 */
export function resolveRelative(baseFile: string, relative: string): string | null {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(relative) ||
    relative.startsWith("/") ||
    relative.startsWith("\\")
  ) {
    return null;
  }
  const separator = baseFile.includes("\\") ? "\\" : "/";
  const parts = baseFile.split(/[\\/]/);
  parts.pop();
  // ?query や #hash はファイル名の一部ではない
  const clean = decodeUriSafe(relative.replace(/[?#].*$/, ""));
  for (const part of clean.split(/[\\/]/)) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      // ドライブ（C:）より上には上がらない
      if (parts.length > 1) {
        parts.pop();
      }
      continue;
    }
    parts.push(part);
  }
  return parts.join(separator);
}

function decodeUriSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // `%` をそのまま含むファイル名もありうるため、デコードできなければそのまま使う
    return text;
  }
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** 画像の拡張子から MIME を返す。画像でなければ null。 */
export function imageMime(path: string): string | null {
  return IMAGE_MIME[extension(path)] ?? null;
}

/** MIME から拡張子（ドットなし）を返す。data URI の画像にファイル名を付けるため。 */
export function extensionForMime(mime: string): string {
  const found = Object.entries(IMAGE_MIME).find(([, m]) => m === mime);
  return found === undefined ? "bin" : found[0].slice(1);
}
