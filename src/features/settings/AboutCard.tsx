import { ChevronRightIcon } from "lucide-react";
import { useState, type JSX, type ReactNode } from "react";

import { AppVersion } from "@/app/AppVersion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { checkForUpdates, openUpdateDialog, useUpdateStore } from "@/features/updater/update-store";
import { errorMessage, openExternal } from "@/lib/tauri";
import { cn } from "cn";

const REPOSITORY_URL = "https://github.com/gjzkcal/field-medic-manual";
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
const ACE_REPOSITORY_URL = "https://github.com/acemod/ACE-Anvil";
const ACE_DOCS_URL = "https://anvil.acemod.org/dev/components/medical/";

/**
 * 設定画面の末尾に置く About。版と更新、ライセンス、原稿の出典、免責。
 * 原稿は ACE-Anvil（GPL-2.0-or-later）のソースとドキュメントを要約したもので ACE チームの承認は受けていないこと、
 * Bohemia が指定する免責文を、配布物に載せる必要があるため。
 */
export function AboutCard(): JSX.Element {
  const [linkError, setLinkError] = useState<string | null>(null);

  function open(url: string): void {
    openExternal(url).then(
      () => {
        setLinkError(null);
      },
      (error: unknown) => {
        setLinkError(`リンクを開けませんでした: ${errorMessage(error)}`);
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>このアプリについて</CardTitle>
        <CardDescription>
          Field Medic Manual — Arma Reforger の ACE Medical 向けの非公式マニュアル
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <UpdateSection />

        <AboutSection title="ライセンス">
          <p>
            Copyright (C) 2026 gjzkcal。GNU General Public License v3.0
            またはそれ以降の版（GPL-3.0-or-later）で、無料・非営利で配布しています。無保証です。
          </p>
          <div className="flex flex-wrap gap-x-4">
            <ExternalLink onOpen={open} url={REPOSITORY_URL}>
              ソースコード（GitHub）
            </ExternalLink>
            <ExternalLink onOpen={open} url={LICENSE_URL}>
              ライセンスの全文
            </ExternalLink>
          </div>
        </AboutSection>

        <AboutSection title="マニュアルの出典">
          <p>
            同梱のマニュアル・クイック表・トリアージのフローは、ACE Medical
            のソースコードとドキュメント（acemod/ACE-Anvil、GPL-2.0-or-later、Copyright (C)
            acemod）を作者が読んで要約・解説したものです。ACE の公式のものではなく、ACE
            チームの承認も受けていません。対象の版と確認日は、マニュアル「このマニュアルについて」と各マニュアルの末尾にあります。処置の手順はゲーム内の遊び方の参考で、古くなっている場合があります。
          </p>
          <div className="flex flex-wrap gap-x-4">
            <ExternalLink onOpen={open} url={ACE_REPOSITORY_URL}>
              acemod/ACE-Anvil
            </ExternalLink>
            <ExternalLink onOpen={open} url={ACE_DOCS_URL}>
              ACE Anvil – Medical（Dev）
            </ExternalLink>
          </div>
        </AboutSection>

        <AboutSection title="免責事項">
          <p lang="en">
            This project is not affiliated with or authorized by Bohemia Interactive a.s. Bohemia
            Interactive, ARMA, DAYZ and all associated logos and designs are trademarks or
            registered trademarks of Bohemia Interactive a.s.
          </p>
          <p>
            このプロジェクトは Bohemia Interactive a.s.
            と提携しておらず、同社の承認も受けていません。Bohemia Interactive、ARMA、DAYZ
            および関連するすべてのロゴとデザインは、Bohemia Interactive a.s.
            の商標または登録商標です。
          </p>
        </AboutSection>

        <ThirdPartyLicenses />

        {linkError !== null && (
          <p role="alert" className="text-destructive">
            {linkError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AboutSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function ExternalLink({
  url,
  onOpen,
  children,
}: {
  url: string;
  onOpen: (url: string) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Button
      variant="link"
      className="h-auto px-0"
      onClick={() => {
        onOpen(url);
      }}
    >
      {children}
    </Button>
  );
}

function UpdateSection(): JSX.Element {
  const status = useUpdateStore((s) => s.status);
  const busy = status.kind === "checking" || status.kind === "installing";

  return (
    <AboutSection title="版と更新">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          今の版: <AppVersion />
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            void checkForUpdates({ manual: true });
          }}
        >
          更新を確認
        </Button>
        <p aria-live="polite" className="text-muted-foreground">
          {statusText(status)}
        </p>
        {status.kind === "available" && (
          <Button size="sm" onClick={openUpdateDialog}>
            更新の内容を見る
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        起動時にも自動で確かめます。インターネットに接続するのは、この確認と更新のときだけです。
      </p>
    </AboutSection>
  );
}

function statusText(status: ReturnType<typeof useUpdateStore.getState>["status"]): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "checking":
      return "確認しています…";
    case "upToDate":
      return "最新の版です";
    case "error":
      return `確認できませんでした（${status.message}）`;
    case "available":
      return `新しい版 v${status.update.info.version} があります`;
    case "installing":
      return "更新しています…";
  }
}

type LicensesText = { kind: "idle" | "loading" } | { kind: "ok"; text: string } | { kind: "error" };

/** 依存ライブラリのライセンス表記。約 400 KB あるので、開いたときに初めて読み込む（起動時の JS を増やさない） */
function ThirdPartyLicenses(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [licenses, setLicenses] = useState<LicensesText>({ kind: "idle" });

  function load(): void {
    setLicenses({ kind: "loading" });
    import("../../../THIRD_PARTY_LICENSES.txt?raw").then(
      (module) => {
        setLicenses({ kind: "ok", text: module.default });
      },
      () => {
        setLicenses({ kind: "error" });
      },
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && licenses.kind !== "ok" && licenses.kind !== "loading") {
          load();
        }
      }}
    >
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>
        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        サードパーティのライセンス
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mb-2 text-muted-foreground">
          このアプリに含まれるライブラリとフォントのライセンスです（インストール先の
          THIRD_PARTY_LICENSES.txt と同じ内容）。
        </p>
        {licenses.kind === "ok" ? (
          <pre
            aria-label="サードパーティのライセンスの全文"
            className="max-h-96 overflow-auto rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap"
          >
            {licenses.text}
          </pre>
        ) : (
          <p className="text-muted-foreground">
            {licenses.kind === "error" ? "読み込めませんでした" : "読み込んでいます…"}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
