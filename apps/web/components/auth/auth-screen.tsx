/**
 * The form column of the signed-out frame — `/sign-in`, `/sign-up`, `/join`,
 * `/no-access`.
 *
 * `AuthFrame` (`auth-frame.tsx`, mounted by `app/(auth)/layout.tsx`) owns the
 * page: the `<main>`, the lockup and the live product panel. This component is
 * what changes between routes: an optional `toggle` above the title (sign-in
 * and sign-up pass `AuthModeToggle`), the screen's one `<h1>`, an optional
 * subtitle (`/join` and `/no-access` keep theirs), the form, and a footer
 * pinned to the bottom of the column. It renders a fragment into
 * the frame's flex column, so the body takes `my-auto` and centres in the
 * space the footer leaves.
 *
 * It exists because the routes inlined the same hero-plus-cards layout four
 * times, which is how they drifted into four different voices ("Frapp
 * staging", "Frapp admin access", "Frapp account setup", "Chapter invite") and
 * four different heading sizes. `design-system/README.md` §3 puts composites in
 * `components/*` and keeps route files thin.
 *
 * **These routes have no chapter.** `useChapterTheme()` mounts inside
 * `DashboardShell` (`components/layout/dashboard-shell.tsx`) and every route
 * here renders outside it, so the accent engine never runs and `--primary`
 * holds `signet.css`'s baked default seed. That is fine for `Button`, whose
 * default variant is the same gold s01 draws — but the *mark* paints locked
 * emblem B (`#1A1A1A` / `#DDB844`) rather than `--primary`, per `signet-mark.tsx`.
 *
 * Type roles sit on `foundations.md` §7's ladder (§7 locks the scale and calls
 * an off-scale size a defect):
 *
 * - every screen title → `headline` (24/700), the screen's only anchor (§8
 *   item 3). Until 2026-11-05 the entry screen's title was the `display` step
 *   because it was the wordmark itself; the wordmark now lives in the frame's
 *   lockup, so every route's title is a plain screen title.
 * - body → `body` (16) in `--muted-foreground`
 * - footer → `label` (14)
 *
 * Captions the boards draw in `#78716A` take `--muted-foreground`, not
 * `--muted`: `components.md` §1 records that `--muted` "is not usable as text
 * anywhere on the ladder", and `--background` is its most forgiving step at
 * 4.041:1 — still under §6's 4.5:1 gate. Measured in
 * `components/profile/profile-contrast.spec.ts`.
 */

export function AuthScreen({
  title,
  subtitle,
  toggle,
  children,
  footer,
}: {
  title: string;
  /** Left out on sign-in and sign-up, where the toggle above says the same. */
  subtitle?: string;
  /** The sign-in / sign-up switch, above the title. */
  toggle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Spacing is tight on purpose: sign-in and sign-up have to fit a 1280×650
  // window without scrolling (Paul, 2026-11-05; `tests/visual/pre-auth-fit.spec.ts`),
  // so every gap is the smallest step that still separates its groups.
  return (
    <>
      <div className="my-auto w-full py-4">
        {toggle ? <div className="mb-6">{toggle}</div> : null}
        <h1 className="text-headline font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}

        <div className={subtitle ? "mt-8" : "mt-5"}>{children}</div>
      </div>

      {footer ? (
        <div className="space-y-2 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </>
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
    <div className="my-5 flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-caption text-muted-foreground">{label}</span>
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
