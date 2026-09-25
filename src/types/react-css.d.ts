// shadcn の部品は `--sidebar-width` などの CSS カスタムプロパティを style で渡す。
// `as React.CSSProperties` で型チェックを外さずに書けるよう、`--` で始まるキーだけを許可する
import "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- 既存の interface にキーを足すモジュール拡張は Record 型では書けない
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
