/**
 * The signed-out frame: the form on the left, the product on the right.
 *
 * Mounted once by `app/(auth)/layout.tsx` for `/sign-in`, `/sign-up`, `/join`
 * and `/no-access` (`/` redirects to `/sign-in`), so moving between them swaps
 * only the form column and the showcase keeps playing instead of restarting. Paul asked for this on
 * 2026-11-05: the single centred column these routes drew before was the
 * mobile s01 layout stretched onto a desktop, and sign-in and sign-up should
 * read as one page with different fields.
 *
 * - **The brand sits in the frame, not in a screen.** Mark and wordmark head
 *   the column on every route, the way a product header does. The mobile
 *   boards' rule that only the entry screen draws the mark (s01 versus s02) is
 *   a phone rule about a full-height column with nothing else in it; here the
 *   form's `<h1>` is the anchor and the lockup is chrome.
 * - **The showcase is a laptop-and-up picture.** Below `lg` there is no room
 *   beside a 400px form, so the panel is not rendered visible at all and the
 *   column is the page, which keeps the 375px floor
 *   (`tests/visual/pre-auth-floor.spec.ts`) a property of the column alone.
 * - **The mark keeps its locked colours.** `SignetMark` paints emblem B, never
 *   the accent slot (`brand-identity.md` §2); see `auth-screen.tsx` for why
 *   these routes have no chapter accent to take anyway.
 */

import { ChapterShowcase } from "@/components/auth/chapter-showcase";
import { SignetMark } from "@/components/auth/signet-mark";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <main className="flex min-h-screen w-full flex-col px-6 pb-8 pt-8 lg:w-[44%] lg:min-w-[480px] lg:max-w-[640px] lg:shrink-0 lg:px-12">
        <div className="flex items-center gap-2.5">
          <SignetMark size="sm" />
          <span className="text-title font-bold tracking-tight text-foreground">
            Frapp
          </span>
        </div>
        {/*
          `max-w-[400px]` is s01's 402pt artboard less its 24pt gutters, rounded
          onto the 4px grid, kept from the single-column layout this replaced.
        */}
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col">
          {children}
        </div>
      </main>
      <ChapterShowcase className="hidden min-w-0 flex-1 py-4 pr-4 lg:sticky lg:top-0 lg:block lg:h-screen" />
    </div>
  );
}
