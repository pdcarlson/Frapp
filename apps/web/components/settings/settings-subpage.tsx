import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The way back from a page opened inside a module page of Chapter settings
 * (#3837): one channel's settings, or Discord import, both drawn in place of
 * the Chat page. A quiet line above the page's heading, the way Discord's
 * channel settings and iOS Settings put the parent's name behind a back arrow,
 * so the rail row stays lit and nothing else moves.
 */
export function SettingsBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition hover:text-foreground",
        FOCUS_RING,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}

/**
 * A page opened inside a module page: the back line, its heading under the
 * same rule a module page's header draws, and its body.
 */
export function SettingsSubpage({
  backHref,
  backLabel,
  title,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      <header className="space-y-1 border-b border-border pb-6">
        <SettingsBackLink href={backHref} label={backLabel} />
        <h2 className="text-title text-foreground">{title}</h2>
      </header>
      {children}
    </div>
  );
}
