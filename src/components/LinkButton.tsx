import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";

import { buttonVariants } from "@/components/ui/button";

type LinkButtonProps = useRender.ComponentProps<"a"> & VariantProps<typeof buttonVariants>;

/**
 * ボタンの見た目のリンク。Button に nativeButton={false} で Link を渡すと、Base UI が role="button" を付け、
 * 画面を移るリンクが読み上げで「ボタン」と伝わってしまう（WCAG 4.1.2）。見た目だけを shadcn の Button からもらい、役割はリンクのままにする。
 * 移る先は render に Link か a を渡す（例: render={<Link to="/library" />}）
 */
export function LinkButton({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: LinkButtonProps): React.JSX.Element {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">({ className: cn(buttonVariants({ variant, size, className })) }, props),
  });
}
