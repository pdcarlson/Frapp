import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The call-site half of the Profile & pre-auth guard, and the half that catches
 * the defect class this family actually shipped.
 *
 * Two lessons from earlier slices are built into the regexes rather than
 * restated:
 *
 * - **A value-level guard cannot see a call site.**
 *   `profile-contrast.spec.ts` computes every ratio here correctly and would
 *   stay green through a full revert of the code it was written for
 *   (`components/settings/settings-contrast.spec.ts` says the same about its
 *   own). Both halves are needed and they catch different things.
 * - **Checking *which token* cannot see *at what opacity*.** Slice 7's first
 *   guard banned `text-muted-foreground/40` literally and the review walked
 *   past it with `text-muted-foreground/[.4]` — the identical 2.184:1 through
 *   the bracket syntax. So rule 1 matches on the `/` itself, across every
 *   semantic token and both Tailwind spellings, rather than on a list of
 *   known-bad pairs.
 *
 * Verified the way slices 6 and 7 verified theirs, and the result is the reason
 * this file exists: reverting the archetype card to `border-primary
 * bg-primary/5` / `hover:bg-accent/50` and the tutorial strip to
 * `bg-secondary/60` turns **two** tests here red and leaves all thirteen in
 * `profile-contrast.spec.ts` green.
 */

const ROOT = join(__dirname, "..", "..");

/**
 * Every file the slice owns. A ledger rather than a glob, in the shape
 * `components/shared/can-fallback.spec.tsx` uses: a glob silently stops
 * covering a file that moves, and the point of this list is that it has to be
 * edited deliberately.
 */
const FAMILY = [
  "app/page.tsx",
  "app/sign-in/page.tsx",
  "app/sign-up/page.tsx",
  "app/join/page.tsx",
  "app/no-access/page.tsx",
  "app/global-error.tsx",
  "app/(dashboard)/profile/page.tsx",
  "components/auth/auth-screen.tsx",
  "components/auth/signet-mark.tsx",
  "components/auth/join-errors.ts",
  "components/profile/profile-panel.tsx",
  "components/profile/profile-glyphs.tsx",
  "components/onboarding/chapter-wizard.tsx",
  "components/onboarding/onboarding-tutorial.tsx",
  "components/onboarding/step-dots.tsx",
] as const;

/**
 * Comments are stripped first. Every one of these rules is *about* a defect
 * this slice removed, so the docstrings explaining them quote the very class
 * strings the rules ban — and a guard that fails on its own explanation is a
 * guard nobody keeps.
 */
function code(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TOKENS = [
  "primary",
  "secondary",
  "accent",
  "accent-subtle",
  "accent-subtle-hover",
  "accent-border",
  "accent-text",
  "muted",
  "muted-foreground",
  "foreground",
  "card",
  "popover",
  "border",
  "input",
  "background",
  "surface-1",
  "success",
  "warning",
].join("|");

/** `bg-primary/5`, `text-muted-foreground/[.4]`, `border-border/70`, … */
const OPACITY_WASH = new RegExp(
  `\\b(?:bg|text|border|ring|divide|from|to)-(?:${TOKENS})\\/(?:\\d+|\\[[^\\]]*\\])`,
);

/**
 * The two sanctioned exceptions, both from `components.md`: §10's error card
 * border and icon tile (`--destructive` at 28% and 13%) and `focus.ts`'s ring.
 * `--destructive` is deliberately absent from `TOKENS` for that reason; the
 * separate rule below keeps it honest.
 */
const SANCTIONED = /\b(?:border-destructive\/\[\.28\]|bg-destructive\/\[\.13\]|bg-destructive\/\[\.14\]|hover:bg-destructive\/20|ring-ring\/25|ring-destructive\/25)/g;

describe("no token is painted through an opacity wash", () => {
  it.each(FAMILY)("%s", (file) => {
    // The rule that survives being defeated: it matches the `/`, not the pair.
    // Reverting `bg-primary/5`, `hover:bg-accent/50`, `bg-secondary/60` or
    // `border-border/70` each fire it, and so does diluting any of their
    // replacements to `/[.4]`.
    expect(code(file)).not.toMatch(OPACITY_WASH);
  });

  it.each(FAMILY)("%s uses only the sanctioned destructive alphas", (file) => {
    const stripped = code(file).replace(SANCTIONED, "");
    expect(stripped).not.toMatch(/\bbg-destructive\//);
    expect(stripped).not.toMatch(/\bborder-destructive\//);
    expect(stripped).not.toMatch(/\btext-destructive\//);
  });
});

describe("no raw Tailwind palette, and no dead `dark:` variant", () => {
  const PALETTE =
    /\b(?:bg|text|border|ring|from|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it.each(FAMILY)("%s", (file) => {
    // `join/page.tsx` carried the last one in `apps/web`:
    // `border-emerald-500/30 bg-emerald-500/10 text-emerald-900`, #916's
    // conflicting green beside `--success`.
    expect(code(file)).not.toMatch(PALETTE);
  });

  it.each(FAMILY)("%s has no `dark:` variant", (file) => {
    // Nothing sets `.dark` — the shell slice made Signet dark-only — so a
    // `dark:` branch never applies and the *light* one is what ships.
    //
    // The trailing character class is load-bearing rather than tidiness: a
    // bare `/\bdark:/` also matches an object key spelled `dark:`. The wizard
    // used to send exactly that as a branding payload key until the #920
    // slice-9 cutover removed the second brand colour, and the same collision
    // is one property name away from returning. A Tailwind variant is followed
    // immediately by a utility; an object key is followed by a space.
    expect(code(file)).not.toMatch(/\bdark:[a-z[-]/);
  });
});

describe("the ✦ is the Ask affordance's alone", () => {
  it.each(FAMILY)("%s imports no Sparkles and draws no ✦", (file) => {
    // `components.md` §11: it "MUST NOT mark anything that is not an Ask/AI
    // entry point". The wizard's header eyebrow and the tutorial's welcome
    // slide were the last two in the tree — the third time this exact
    // correction has been made, after the slash-command trigger.
    const source = code(file);
    expect(source).not.toMatch(/\bSparkles\b/);
    expect(source).not.toMatch(/✦/);
  });
});

describe("mono is reserved for machine values", () => {
  /**
   * `foundations.md` §7 reserves mono for numeric, status and code-like
   * strings. The wizard spent it on a section eyebrow and a council
   * abbreviation, both of which are labels — and the abbreviation at
   * `text-[0.65rem]` (10.4px), off the locked scale entirely.
   */
  const ALLOWED: Record<string, number> = {
    // The accent hex and the invite link — both machine values. Was three
    // until the #920 slice-9 cutover removed the second colour picker: a
    // chapter now supplies one seed, not a dark/accent pair.
    "components/onboarding/chapter-wizard.tsx": 2,
    // The invite token a member reads character by character.
    "app/join/page.tsx": 1,
  };

  it.each(FAMILY)("%s", (file) => {
    const count = (code(file).match(/\bfont-mono\b/g) ?? []).length;
    expect(count).toBe(ALLOWED[file] ?? 0);
  });
});

describe("the accent slot never paints a pre-auth screen", () => {
  /**
   * `useChapterTheme()` mounts inside `DashboardShell`, and every route here
   * renders outside it — so the engine never runs and the accent family
   * resolves to `signet.css`'s baked seed.
   *
   * **The rule is narrower than it first reads, and the narrow version is the
   * true one.** Ordinary chrome on these screens may take accent roles and
   * does — the primary button, the footer links, the `/no-access` state tile —
   * because if a chapter accent were ever applied this high they *should*
   * follow it. What may never take the slot is the **mark**
   * (`brand-identity.md` §2, "MUST NOT take the chapter accent — ever"), which
   * is why the assertions below ban the bare accent-slot classes from a page
   * body and then pin the mark's own tokens positively. Banning
   * `accent-text`/`accent-subtle` outright here would fail four correct call
   * sites and enforce a rule nothing states.
   */
  const PRE_AUTH = [
    "app/page.tsx",
    "app/sign-in/page.tsx",
    "app/sign-up/page.tsx",
    "app/join/page.tsx",
    "app/no-access/page.tsx",
    "components/auth/auth-screen.tsx",
  ] as const;

  it.each(PRE_AUTH)("%s paints no bare accent-slot class", (file) => {
    const source = code(file);
    expect(source).not.toMatch(/\btext-primary\b/);
    expect(source).not.toMatch(/\bbg-primary\b/);
  });

  it("draws the mark in house gold, not the accent slot", () => {
    const source = code("components/auth/signet-mark.tsx");
    expect(source).toMatch(/\bbg-gold-house\b/);
    expect(source).toMatch(/\btext-gold-on-house\b/);
    expect(source).not.toMatch(/\bbg-primary\b/);
  });
});
