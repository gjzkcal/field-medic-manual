/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
  // Tailwind v4 は設定ファイルを持たないため、クラス順の基準になる CSS を明示する
  tailwindStylesheet: "./src/index.css",
};

export default config;
