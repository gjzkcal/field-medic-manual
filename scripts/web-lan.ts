// 使い方: pnpm dev:web:lan（開発サーバー） / pnpm preview:web:lan（build:web の結果）
// Web 版を同じ LAN のスマホから開いて確かめるため、PC の IP アドレスで待ち受け、自己署名の HTTPS で配る。
// http のままだと localhost 以外は secure context にならず、crypto.subtle（原稿のハッシュ）と
// crypto.randomUUID（負傷者の記録）が使えない。証明書は信頼されないので、スマホのブラウザの警告を押して進む。
// 普段の dev:web / preview:web は PC で毎回警告が出ないよう http のままにし、ここで上乗せするだけにする。

import process from "node:process";

import basicSsl from "@vitejs/plugin-basic-ssl";
import { createServer, type InlineConfig, preview } from "vite";

const command = process.argv[2];

const config: InlineConfig = {
  mode: "web",
  server: { host: true },
  preview: { host: true },
  plugins: [basicSsl()],
};

if (command === "dev") {
  const server = await createServer(config);
  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} else if (command === "preview") {
  const server = await preview(config);
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} else {
  process.stderr.write(`dev か preview を指定してください: "${command ?? ""}"\n`);
  process.exit(1);
}
