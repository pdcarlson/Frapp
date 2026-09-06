/**
 * The shared pre-auth column — `/`, `/sign-in`, `/sign-up`, `/join`,
 * `/no-access`.
 *
 * Transcribed from `canvas-screens.dc.html` s01 (sign-in) and s02 (join): a
 * single centred column on `--background`, not the card grid these four routes
 * shipped before the #920 Profile & pre-auth slice. s01 draws **no cards** —
 * the fields and the primary sit directly on the app floor, and the only
 * bordered object on the screen is s02's hint card.
 *
 * It exists because the four routes inlined the same hero-plus-cards layout
 * four times, which is how they drifted into four different voices ("Frapp
 * staging", "Frapp admin access", "Frapp account setup", "Chapter invite") and
 * four different heading sizes. `design-system/README.md` §3 puts composites in
 * `components/*` and keeps route files thin.
 *
 * **These routes have no chapter.** `useChapterTheme()` mounts inside
 * `DashboardShell` (`components/layout/dashboard-shell.tsx`) and every route
 * here renders outside it, so the accent engine never runs and `--primary`
 * holds `signet.css`'s baked default seed. That is fine for `Button`, whose
 * default variant is the same gold s01 draws — but the *mark* takes
 * `--gold-house` explicitly, per `signet-mark.tsx`.
 *
 * Type roles, mapped from the drawings onto `foundations.md` §7's ladder rather
 * than transcribed as pixel values (§7 locks the scale and calls an off-scale
 * size a defect):
 *
 * - s01 wordmark 30/700 → `display` (32/700)
 * - s02 title 26/700 → `headline` (24/700). Deliberately 700 where the thirteen
 *   dashboard page headings are 600: those sit under a breadcrumb inside the
 *   shell, this is the screen's only anchor (§8 item 3).
 * - s01/s02 body 15.5–16 → `body` (16) in `--muted-foreground`
 * - s01 footer 14.5 → `label` (14)
 * - s02's "‹ Back" 15 → `label` (14), the nearest step. It is the one size the
 *   first cut of this file transcribed literally, which left an arbitrary
 *   `text-[15px]` in a docstring that claims to map every size onto the ladder.
 *
 * Captions the boards draw in `#78716A` take `--muted-foreground`, not
 * `--muted`: `components.md` §1 records that `--muted` "is not usable as text
 * anywhere on the ladder", and `--background` is its most forgiving step at
 * 4.041:1 — still under §6's 4.5:1 gate. Measured in
 * `components/profile/profile-contrast.spec.ts`.
 */

import Link from "next/link";
import { SignetMark } from "@/components/auth/signet-mark";
import { cn } from "@/lib/utils";

export function AuthScreen({
  mark = false,
  back,
  title,
  subtitle,
  children,
  footer,
}: {
  /** s01 draws the mark; s02 does not. The entry screen carries it, not every screen. */
  mark?: boolean;
  /** s02's "‹ Back". Omitted where there is nowhere to go back to. */
  back?: { href: string; label: string };
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background px-6 pb-10 pt-14">
      {/*
        `max-w-[400px]` is s01's 402pt artboard less its 24pt gutters, rounded
        onto the 4px grid (§8). The column is the page's whole width budget, so
        the 375px floor is held by construction rather than by a media query —
        `tests/visual/pre-auth-floor.spec.ts` measures it.
      */}
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[400px] flex-col">
        {back ? (
          <Link
            href={back.href}
            className="mb-6 -ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-sm font-semibold text-accent-text hover:underline"
          >
            <span aria-hidden="true">&lsaquo;</span>
            {back.label}
          </Link>
        ) : null}

        {mark ? <SignetMark className="mb-6" /> : null}

        <h1
          className={cn(
            "font-bold tracking-tight text-foreground",
            // s01's wordmark is the display step; s02's screen title is the
            // headline step. The mark's presence is what distinguishes an
            // entry screen from a step within the flow.
            mark ? "text-[32px] leading-tight" : "text-2xl",
          )}
        >
          {title}
        </h1>
        <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
          {subtitle}
        </p>

        <div className="mt-8">{children}</div>

        {footer ? (
          <div className="mt-auto pt-10 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * s01's "or" rule — two hairlines with a caption between them.
 *
 * `bg-border` is the token, never a diluted `border-border/70`: §3 rule 4 bans
 * one-offing a token value at the call site, and the hairline is already
 * `rgba(255,255,255,.08)`.
 */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * s02's hint card — the one bordered object the pre-auth screens draw.
 *
 * `--surface-1` on `--background` is the ladder's first step up, which is what
 * carries the elevation on a shadowless surface (`foundations.md` §10); the
 * hairline is the edge that makes it an object (§2).
 */
export function AuthNote({
  glyph,
  children,
}: {
  glyph: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-1 p-4">
      <span className="mt-px shrink-0 text-accent-text">{glyph}</span>
      <p className="text-sm leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}
