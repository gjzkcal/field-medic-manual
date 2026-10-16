// アプリの zod はここから読む（"zod" を直接読まない。src/lib/zod.test.ts で確かめる）。
// 設定を、どのスキーマよりも先に効かせるため。zod はスキーマを作った時点で設定を読むが、
// エントリの先頭で設定しても、ビルドでスキーマが別のチャンクに入ると、そちらが先に評価されてしまう
import { z } from "zod";

// zod は既定で、速い検証のコードを作れるかを `new Function` で試す。アプリの CSP（script-src 'self'）では
// 例外は握りつぶされるものの、CSP の違反として報告される（Web 版では Lighthouse の減点になる）。
// 検証するのは同梱の小さな YAML だけなので、試さずに遅い方の検証を使う
z.config({ jitless: true });

export { z };
