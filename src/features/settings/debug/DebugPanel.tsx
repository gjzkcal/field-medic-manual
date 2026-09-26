import { useEffect, useState, type JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { syncBundledManuals } from "@/features/content/sync";
import { DebugSearch } from "@/features/settings/debug/DebugSearch";
import { insertDummyDocs, removeDummyDocs } from "@/features/settings/debug/dummy";
import type { DocSummary } from "@/lib/bindings/DocSummary";
import type { SynonymGroup } from "@/lib/bindings/SynonymGroup";
import type { TagCount } from "@/lib/bindings/TagCount";
import { docDelete, docList, errorMessage, synonymList, tagList } from "@/lib/tauri";

interface DebugData {
  docs: DocSummary[];
  tags: TagCount[];
  synonyms: SynonymGroup[];
}

/** 開発ビルドだけで出す、データ層の動作確認用の画面。ライブラリの一覧（Step 04）ができるまでの代わりも兼ねる。 */
export function DebugPanel(): JSX.Element {
  const [data, setData] = useState<DebugData>({ docs: [], tags: [], synonyms: [] });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 投入・削除のあとに一覧と検索結果を読み直すための番号
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // アンマウント後や、より新しい読み込みのあとに古い結果で上書きしないため
    let cancelled = false;
    Promise.all([docList(), tagList(), synonymList()])
      .then(([docs, tags, synonyms]) => {
        if (!cancelled) {
          setData({ docs, tags, synonyms });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
      setRevision((r) => r + 1);
    }
  }

  async function resync(): Promise<string> {
    const result = await syncBundledManuals();
    if (result === null) {
      return "同期に失敗しました（ライブラリ画面に理由が出ます）";
    }
    return `同期しました: 追加 ${String(result.added)} / 更新 ${String(result.updated)} / 変更なし ${String(result.unchanged)} / 削除 ${String(result.removed)} / 失敗 ${String(result.failed.length)}`;
  }

  async function insertDummy(): Promise<string> {
    const started = performance.now();
    const sections = await insertDummyDocs();
    return `ダミーを ${String(sections)} 節入れました（${(performance.now() - started).toFixed(0)} ms）。次の起動時の同期で消えます`;
  }

  async function removeDummy(): Promise<string> {
    return `ダミーを ${String(await removeDummyDocs())} 文書消しました`;
  }

  async function remove(doc: DocSummary): Promise<string> {
    await docDelete(doc.id);
    return `「${doc.title}」を削除しました`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>デバッグ（開発ビルドのみ）</CardTitle>
        <CardDescription>
          データ層と検索の動作確認用。同梱の原稿（content/manuals）は起動時に同期される。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={() => {
              void run(resync);
            }}
          >
            同梱の原稿を同期し直す
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run(insertDummy);
            }}
          >
            ダミー 1000 節を投入
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run(removeDummy);
            }}
          >
            ダミーを削除
          </Button>
          {message !== null && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">ドキュメント（{data.docs.length}）</h3>
          {data.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <span className="font-medium">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {doc.sectionCount} セクション
                  </span>
                  {doc.meta.modTarget !== null && (
                    <Badge variant="secondary">{doc.meta.modTarget}</Badge>
                  )}
                  <Badge variant="outline">{doc.meta.modChannel ?? "版不問"}</Badge>
                  {doc.meta.modVersion !== null && (
                    <Badge variant="outline">{doc.meta.modVersion}</Badge>
                  )}
                  {doc.meta.tags.map((tag) => (
                    <Badge key={tag} variant="ghost">
                      #{tag}
                    </Badge>
                  ))}
                  <Button
                    className="ml-auto"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void run(() => remove(doc));
                    }}
                  >
                    削除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DebugSearch revision={revision} />

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">タグ（{data.tags.length}）</h3>
          <div className="flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <Badge key={tag.name} variant="outline">
                #{tag.name}（文書 {tag.documentCount} / 節 {tag.sectionCount}）
              </Badge>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">同義語（{data.synonyms.length} グループ）</h3>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {data.synonyms.map((group) => (
              <li key={group.id}>{group.terms.join(" = ")}</li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
