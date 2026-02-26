import type { ReactNode } from "react";
import Link from "next/link";

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Docs
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-[13px] font-medium text-foreground/70">
          Guide
        </span>
      </div>

      <article className="prose-docs">{children}</article>
    </div>
  );
}
