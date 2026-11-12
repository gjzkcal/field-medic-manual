import type { Config } from "prettier";
import type { PluginOptions } from "prettier-plugin-tailwindcss";

const config: Config & PluginOptions = {
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
  // Tailwind v4 は設定ファイルを持たないため、クラス順の基準になる CSS を明示する
  tailwindStylesheet: "./src/index.css",
};

export default config;
