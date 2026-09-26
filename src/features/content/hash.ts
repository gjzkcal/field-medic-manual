/** bytes の sha256（小文字 16 進）。Rust の asset_put が計算する id と同じ値になる。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SharedArrayBuffer を背後に持つ配列は digest に渡せないため、ArrayBuffer に写してから渡す
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexOfText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}
