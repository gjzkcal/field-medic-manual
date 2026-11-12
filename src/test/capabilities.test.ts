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

function readSource(...parts: string[]): string {
  return readFileSync(resolve(REPO_ROOT, "src-tauri", ...parts), "utf8");
}

/** build.rs の COMMANDS（権限にするコマンドの一覧） */
function manifestCommands(): string[] {
  const block = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/u.exec(readSource("build.rs"))?.[1];
  return [...(block ?? "").matchAll(/"([a-z_]+)"/gu)].map((m) => m[1] ?? "");
}

/** lib.rs の generate_handler! に並べたコマンド */
function handlerCommands(): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]/u.exec(readSource("src", "lib.rs"))?.[1];
  return [...(block ?? "").matchAll(/::([a-z_]+),/gu)].map((m) => m[1] ?? "");
}

function permissionNames(file: string): string[] {
  return permissionsOf(file).map((p) => (typeof p === "string" ? p : p.identifier));
}

// build.rs に入れ忘れたコマンドは権限で絞られず、どのウィンドウからも呼べてしまう
describe("コマンドの登録", () => {
  it("generate_handler! のコマンドがすべて build.rs の COMMANDS にある", () => {
    expect(handlerCommands().length).toBeGreaterThan(0);
    expect([...handlerCommands()].toSorted()).toStrictEqual([...manifestCommands()].toSorted());
  });

  it("AI チャットのコマンドはメインだけに許し、小窓には許さない", () => {
    const aiPermissions = manifestCommands()
      .filter((name) => name.startsWith("ai_"))
      .map((name) => `allow-${name.replaceAll("_", "-")}`);
    expect(aiPermissions.length).toBeGreaterThan(0);
    expect(permissionNames("main.json")).toStrictEqual(expect.arrayContaining(aiPermissions));
    expect(
      permissionNames("overlay.json").filter((name) => name.startsWith("allow-ai-")),
    ).toStrictEqual([]);
  });
});

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

  it("ログは client_log だけで書き、ログのプラグインを画面に開けない", () => {
    const names = permissions.map((p) => (typeof p === "string" ? p : p.identifier));
    expect(names).toContain("allow-client-log");
    expect(names.filter((name) => name.startsWith("log:"))).toStrictEqual([]);
  });

  it("外部で開ける URL を src/lib/external-url.ts と同じ種類に絞る", () => {
    const opener = permissions.find(
      (p) => typeof p !== "string" && p.identifier === "opener:allow-open-url",
    );
    expect(typeof opener === "string" ? [] : opener?.allow.map((a) => a.url)).toStrictEqual([
      "https://*",
      "http://*",
    ]);
  });
});
