import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REPO_ROOT } from "@/test/samples";

const capabilitySchema = z.object({
  permissions: z.array(
    z.union([
      z.string(),
      z.object({
        identifier: z.string(),
        allow: z.array(z.object({ url: z.string() })),
      }),
    ]),
  ),
});

function permissionsOf(file: string): z.infer<typeof capabilitySchema>["permissions"] {
  const path = resolve(REPO_ROOT, "src-tauri", "capabilities", file);
  return capabilitySchema.parse(JSON.parse(readFileSync(path, "utf8"))).permissions;
}

// まとめの権限は、プラグインの更新で中身が増えると気づかないうちに権限が広がるので、使うものを列挙する
describe.each(["main.json", "overlay.json"])("%s", (file) => {
  const permissions = permissionsOf(file);

  it("まとめの権限を使わない", () => {
    const names = permissions.map((p) => (typeof p === "string" ? p : p.identifier));
    expect(names).not.toContain("core:default");
    expect(names).not.toContain("opener:default");
    expect(names).not.toContain("opener:allow-default-urls");
    expect(names).not.toContain("opener:allow-reveal-item-in-dir");
  });

  it("外部で開ける URL を src/lib/external-url.ts と同じ種類に絞る", () => {
    const opener = permissions.find(
      (p) => typeof p !== "string" && p.identifier === "opener:allow-open-url",
    );
    expect(typeof opener === "string" ? [] : opener?.allow.map((a) => a.url)).toEqual([
      "https://*",
      "http://*",
    ]);
  });
});
