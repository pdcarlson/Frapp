import Link from "next/link";

import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
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
 *
 * Drawn as `components.md` §6 tabs, the underline style `ui/tabs.tsx` paints,
 * because §6 rules out segmented pills; `TabsTrigger` itself is a Radix
 * button that switches panels in place, and these switch pages. The same
 * numbers: 44px items (§6's touch floor), `gap-6`, a 2px `border-primary`
 * underline over the hairline, and the offset focus ring, since the bottom
 * border is the selected cue and `FOCUS_RING`'s border swap would fake it.
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
      className="flex items-center gap-6 border-b border-border"
    >
      {MODES.map(({ mode, label }) => {
        const active = mode === current;
        return (
          <Link
            key={mode}
            href={`/${mode}?redirectTo=${encodeURIComponent(redirectTo)}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center rounded-t-xs border-b-2 px-1 py-3 text-sm transition-colors",
              FOCUS_RING_OFFSET,
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent font-normal text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
