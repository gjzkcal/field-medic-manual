import type { JSX } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

interface PagePlaceholderProps {
  title: string;
  description: string;
}

/** 中身を実装するまでの仮の画面。どの画面に遷移したかを確認できればよい。 */
export function PagePlaceholder({ title, description }: PagePlaceholderProps): JSX.Element {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>準備中</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
