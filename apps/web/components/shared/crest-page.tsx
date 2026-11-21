"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The full-page terminal state — board `1k`, and **the only place crest art is
 * allowed.**
 *
 * `spec/ui/web-dashboard/reference/web-framework.dc.html` `1k` draws the 404 as
 * a 720×450 field at `#1A1A1A` holding a 260px crest beside a 300px column, and
 * its note extends the same layout to the error page with the code swapped. The
 * note also fixes the constraint this component exists to hold: *"Crest is the
 * locked raster at native colors, never recolored. In-app empty states stay
 * crest-free."*
 *
 * So crest art gets exactly one component and two call sites — `app/not-found.tsx`
 * and `app/error.tsx`. A `grep -rn CrestPage apps/web` is the proof that no empty
 * state, no error card and no dashboard surface grew one. `StateTile`
 * (`shared/async-states.tsx`) stays the in-app recipe and draws a glyph, never
 * the mark.
 *
 * ## Three places this transcribes the board rather than lifting it
 *
 * The reference is rank 1 on visuals, and `tokens.md` L-01 records the standing
 * rule that came out of lane 2's scrollbars: *transcribe the reference, never
 * lift it*. Three values here are off a locked map, and a locked map is what the
 * board is drawn against rather than something it overrules:
 *
 * 1. **`opacity:.9` on the crest is dropped.** `#DDB844` at 90% over `#1A1A1A`
 *    composites to `#CAA840` — which is not the mark gold, on the one surface
 *    that renders the mark largest. That is the exact defect
 *    [#2153](https://github.com/pdcarlson/Frapp/issues/2153) closed and that
 *    `scripts/check-brand-assets.mjs` now reads pixels to prevent, so a 10% wash
 *    would reintroduce a fourth near-gold in the product after the repo spent a
 *    re-export getting to three. The board's own note — "at native colors, never
 *    recolored" — is the half that governs, and the wash is the half that
 *    contradicts it. Quiet is carried instead by what the board also draws: no
 *    border, no interaction, `alt=""`, and no tile edge, so the glyph floats.
 *    Until 2026-11-19 that came from the full tile's own `#1A1A1A` field
 *    sitting flush on a matching ladder step (`--surface-1` or `--card`, by
 *    ladder). The violet 2026-11-19 ladder has no neutral step, so the
 *    neutral field read as a faint square on the violet card. The page now
 *    draws the glyph raster instead (`signet-emblem-B-glyph.png`, the crest
 *    alone on transparent, which `spec/ui/assets.md` names for surfaces that
 *    are not the charcoal field): the same locked gold, with no field to show
 *    on any ladder.
 * 2. **Radius 24 is dropped.** It rounded the full tile's corners. The glyph
 *    raster has no tile, so there is no corner to round (it rounded onto 20,
 *    `foundations.md` §8's ceiling, while the page drew the tile).
 * 3. **The 40px buttons become the 44px `sm` size.** §9's touch floor is 44 on
 *    every platform, and `components.md` §3's ladder has no 40 step. This is
 *    `button.tsx`'s own argument ("foundations.md §7 locks the type scale and
 *    calls an off-scale size a defect") applied to height.
 *
 * ## Type roles
 *
 * The board's 28/700 title carries `line-height:1.15`, which is the `display`
 * role's ratio exactly (`packages/theme/src/tailwind.config.ts`), and the page is a standalone
 * anchor with no flow around it — the same shape as the pre-auth entry screen,
 * which `auth-screen.tsx` maps to `display`. So `text-display`, not the headline
 * step. The 12px mono code rounds onto `caption` (12.5).
 *
 * These are the first call sites for lane 1's `--text-*` utilities, which shipped
 * with none. An unbound Tailwind key emits no CSS and raises nothing — #1145's
 * failure mode — so `crest-page.spec.tsx` asserts the three keys against the
 * app config merged with the shared preset that now declares them
 * (`packages/theme/src/tailwind.config.ts`), rather than trusting that they
 * resolve.
 *
 * ## Why the two pages paint their code label from different tokens
 *
 * `1k` draws both in `#DDB844`, and on its demo tenant that single hex is both
 * the chapter accent and the house gold — the board cannot tell them apart, and
 * `tokens.md` L-01 names reading a distinction off it as the house-tenant trap.
 * `components.md` §10 can: **"Error surfaces MUST NOT use the chapter accent."**
 *
 * So the 404 takes `--primary` and the 500 takes `--gold-house`. A 404 is not a
 * failure of ours — the link is wrong — so it is ordinary product chrome and
 * retints like the rest. A 500 is an error surface and holds still. Both render
 * the board's pixel today either way, because `useChapterTheme()` mounts inside
 * `DashboardShell` and neither of these routes renders under it, so `--primary`
 * is the baked seed here. That coincidence is exactly why this is a `tone` prop
 * and not a comment: it would stop being true the moment anything hoisted the
 * accent hook, and then the 500 would paint its label in a red-seeded chapter's
 * brand red next to a failure message.
 *
 * The crest itself is outside all of this. It is a raster, so it cannot retint
 * under either tone.
 */
export function CrestPage({
  code,
  tone,
  title,
  description,
  children,
}: {
  /** The board's mono eyebrow: `404`, `500`. */
  code: string;
  /**
   * Which gold the eyebrow takes. `"accent"` retints per chapter; `"error"`
   * holds at house gold, because `components.md` §10 bars the chapter accent
   * from an error surface.
   */
  tone: "accent" | "error";
  title: string;
  description: string;
  /** The action row. `1k` draws a primary and a secondary. */
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-card px-6 py-12 sm:flex-row sm:gap-12">
      {/*
        `aria-hidden` and an empty `alt`: the crest is a decorative restatement
        of a page that already says what happened in text, the same call
        `signet-mark.tsx` makes. `priority` because it is the page's only
        visual — lazily loaded, it would paint a hole where the board draws the
        subject (the failure mode `tokens.md` L-08 records for the app-bar
        chip).
      */}
      <Image
        src="/brand/signet-emblem-B-glyph.png"
        alt=""
        aria-hidden="true"
        width={260}
        height={260}
        priority
        className="h-[180px] w-[180px] shrink-0 sm:h-[260px] sm:w-[260px]"
      />
      <div className="w-full max-w-[300px]">
        <p
          className={cn(
            "font-mono text-caption font-semibold tracking-[0.1em]",
            tone === "accent" ? "text-primary" : "text-gold-house",
          )}
        >
          {code}
        </p>
        <h1 className="mt-2 text-display tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-body text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-wrap gap-2">{children}</div>
      </div>
    </main>
  );
}
