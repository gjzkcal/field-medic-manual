import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // bindings は ts-rs の生成物。手で直さないので対象外にする。
  // dev-docs は .gitignore 済みの非公開の資料置き場で、他のプロジェクトのソースや設定ファイルも置く。
  // ESLint は .gitignore を読まず、そこにある別の eslint.config.js まで読みに行って落ちるので明示する
  globalIgnores([
    "dist",
    "dist-web",
    "src-tauri/target",
    "src-tauri/gen",
    "src/lib/bindings",
    "dev-docs",
  ]),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      eslintReact.configs["strict-type-checked"],
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn はコンポーネントと variants / hook（buttonVariants, useSidebar）を同じファイルから export する構成。
    // ファイルを分けると `shadcn add` で更新したときの差分が大きくなるため、生成部品に限り Fast Refresh の制約を外す
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  // デスクトップ版と Web 版（vite --mode web）で混ざってはいけないものを import の段階で止める。
  // Tauri の API は src/lib/tauri.ts だけが触る（Web 版ではこのファイルを tauri.web.ts に差し替えるので、
  // ほかから直接読むと Web のバンドルに入り、ブラウザで落ちる）。
  // Web 版だけの実装（検索・原稿の読み込み）は、デスクトップ版の画面から読まない（デスクトップのバンドルを太らせない）。
  // テストは IPC のモックと、両方の実装の突き合わせのために両方を読む
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/tauri.ts",
      "src/lib/tauri.web.ts",
      "src/web/**",
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/*"],
              message: "Tauri の API は src/lib/tauri.ts の型付きラッパを経由して呼ぶ",
            },
            {
              group: ["@/web/*", "@/lib/tauri.web"],
              message: "Web 版だけの実装は、デスクトップ版と共有する画面から読まない",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/web/**/*.{ts,tsx}", "src/lib/tauri.web.ts"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/*"],
              message: "Web 版には Tauri がない",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["*.{js,ts}", "scripts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        { allowString: false, allowNumber: false, allowNullableObject: false },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
    },
  },
  prettier,
);
