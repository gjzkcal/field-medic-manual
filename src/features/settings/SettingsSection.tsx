import type { JSX, ReactNode } from "react";

/** 設定のカード（表題は h2）の中の節。 */
export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      {/* カードの表題（h2）の下の節 */}
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}
