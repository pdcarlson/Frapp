import type { HTMLAttributes } from "react";
import { joinClassNames } from "./utils";

export type CodeProps = HTMLAttributes<HTMLElement>;

export function Code({ className, ...props }: CodeProps) {
  return (
    <code
      className={joinClassNames(
        "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.9em]",
        className,
      )}
      {...props}
    />
  );
}
