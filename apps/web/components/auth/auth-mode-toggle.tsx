import Link from "next/link";

import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

export type AuthMode = "sign-in" | "sign-up";

const MODES: { mode: AuthMode; label: string }[] = [
  { mode: "sign-in", label: "Sign in" },
  { mode: "sign-up", label: "Create account" },
];

/**
 * The switch between `/sign-in` and `/sign-up`, at the top of the form
 * (Paul, 2026-11-05: the two are one page with different fields, so the way
 * across is a toggle rather than a footer sentence).
 *
 * Two links, not a client-side tab: each mode keeps its own URL, so a shared
 * `/sign-up` link and the browser's back button still work, and the frame's
 * product panel stays mounted across the hop because both routes share
 * `app/(auth)/layout.tsx`. `redirectTo` rides along so an invite survives the
 * switch. The current mode is `aria-current="page"`.
 */
export function AuthModeToggle({
  current,
  redirectTo,
}: {
  current: AuthMode;
  redirectTo: string;
}) {
  return (
    <nav
      aria-label="Sign in or create an account"
      className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1"
    >
      {MODES.map(({ mode, label }) => {
        const active = mode === current;
        return (
          <Link
            key={mode}
            href={`/${mode}?redirectTo=${encodeURIComponent(redirectTo)}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center justify-center rounded-sm border text-sm font-semibold",
              FOCUS_RING,
              active
                ? "border-input bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
