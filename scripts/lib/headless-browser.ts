// Lighthouse に測らせるブラウザを、自分で起動して自分で閉じさせる。
// Lighthouse（chrome-launcher）に起動させると、Windows では計測のたびに taskkill /F で止め、
// ウィンドウの項目だけが Alt+Tab とスナップの候補に残る（実体は無く、エクスプローラーを再起動するまで消せない。
// 全画面を 5 回ずつ測ると 90 個たまる）。デバッグのポートに先にブラウザを用意しておくと Lighthouse はそれに接続し、
// 止めるのもこちらの仕事になるので、ブラウザ自身に閉じさせる。

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

// chrome-launcher 1.2.2（Lighthouse 13.6.0 が使う版）の DEFAULT_FLAGS と同じ。
// 点数が、Lighthouse に起動させたとき（CI・PageSpeed Insights）と変わらないようにそろえる
const LAUNCHER_FLAGS = [
  `--disable-features=${[
    "Translate",
    "OptimizationHints",
    "MediaRouter",
    "DialMediaRouteProvider",
    "CalculateNativeWinOcclusion",
    "InterestFeedContentSuggestions",
    "CertificateTransparencyComponentUpdater",
    "AutofillServerCommunication",
    "PrivacySandboxSettings4",
    "RenderDocument",
  ].join(",")}`,
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-sync",
  "--metrics-recording-only",
  "--disable-default-apps",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-ipc-flooding-protection",
  "--password-store=basic",
  "--use-mock-keychain",
  "--force-fieldtrials=*BackgroundTracing/default/",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-domain-reliability",
  "--propagate-iph-for-testing",
];

const READY_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 10_000;

const versionSchema = z.object({ webSocketDebuggerUrl: z.string() });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestClose(url: string): void {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  });
}

export interface HeadlessBrowser {
  /** ブラウザ自身に閉じさせ、終わるのを待つ。何度呼んでもよい */
  close: () => Promise<void>;
}

/**
 * ブラウザをヘッドレスで起動し、デバッグのポートが開くのを待つ。
 * 起動できなければ（ポートが開かなければ）止めてから例外にする。
 * 一時プロファイルは profileRoot の下に作り、閉じるときに消す
 */
export async function launchHeadlessBrowser(
  executable: string,
  port: number,
  profileRoot = tmpdir(),
): Promise<HeadlessBrowser> {
  // 既定のプロファイルを使うと、開いているふだんのブラウザに引き渡されて、ポートが開かない
  const profile = mkdtempSync(join(profileRoot, "lighthouse-browser-"));
  const child = spawn(
    executable,
    [
      ...LAUNCHER_FLAGS,
      "--headless=new",
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    child.on("exit", () => {
      resolve();
    });
    // 実行ファイルが無い・起動する権限が無いときは、exit ではなく error が来る。受け手が無いと Node が例外にして
    // スクリプトごと落ち、やり直しにも一時プロファイルの片付けにも進めない。始まっていないので、終わったものとして扱う
    child.on("error", (error) => {
      spawnError = error;
      resolve();
    });
  });

  async function debuggerUrl(): Promise<string | undefined> {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`);
      return versionSchema.parse(await response.json()).webSocketDebuggerUrl;
    } catch {
      // まだ起動していないか、もう終わっている
      return undefined;
    }
  }

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      const url = await debuggerUrl();
      if (url !== undefined) {
        requestClose(url);
      }
      const closed = await Promise.race([
        exited.then(() => true),
        sleep(url === undefined ? 0 : CLOSE_TIMEOUT_MS).then(() => false),
      ]);
      if (!closed && child.pid !== undefined) {
        // 応答しないブラウザを残すよりは、Alt+Tab に項目が残るほうを選ぶ。子のプロセスまで止める
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGKILL");
        }
        await exited;
      }
      // 終わった直後はファイルをつかんでいることがある。消せなくても計測は失敗にしない（一時フォルダに残るだけ）
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // 上のとおり
      }
    })();
    return closing;
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while ((await debuggerUrl()) === undefined) {
    if (spawnError !== undefined || child.exitCode !== null || Date.now() > deadline) {
      await close();
      throw new Error(
        `ブラウザを起動できませんでした（ポート ${String(port)}）${spawnError === undefined ? "" : `: ${spawnError.message}`}`,
      );
    }
    await sleep(200);
  }
  return { close };
}
