# Foundation tokens

What lane 1 ([#2143](https://github.com/pdcarlson/Frapp/issues/2143)) landed in the theme package,
and what is still open. Token **values** stay canonical in
[`../design-system/foundations.md`](../design-system/foundations.md); this page is the lane record
and does not restate them.

---

## 1. What landed

### Surface ladder, re-pitched

`packages/theme/src/signet.ts` and `packages/theme/src/signet.css`, documented in
[`foundations.md`](../design-system/foundations.md) §2.

| Step | Was | Now |
| ---- | --- | --- |
| `--background` | `#0E0D0B` | `#131211` |
| `--surface-1` | `#171512` | `#1A1A1A` |
| `--card` | `#1E1B17` | `#211E1A` |
| `--popover` | `#26221C` | `#2A2621` |

`--surface-1` is now the mark's own field, so locked emblem B sits flush on the raised surface.

### Accent seed

The house default seed moved from `#F2B72E` to `#DDB844`, the mark gold. A chapter with no accent of
its own now resolves to the same gold the crest is drawn in.

Three golds now coexist, and they are not interchangeable:

| Gold | Value | What it is |
| ---- | ----- | ---------- |
| House gold | `#EFB63B` | Signet's own brand accent. Paints the Ask and AI surface. Never retints per chapter. Unchanged. |
| Mark gold | `#DDB844` | The emblem. Never takes the chapter accent. Unchanged. |
| Accent seed | `#DDB844` | The default fed to the accent engine. **Changed**, and now equal to the mark gold. |

The seed being equal to the mark gold is a coincidence of value, not an identity. A chapter that
picks its own accent moves the seed and leaves both other golds where they are.

### Type scale, grid, and scrollbars

These are the wiring half of the lane. The type scale and the 4px grid were already specified in
[`foundations.md`](../design-system/foundations.md) §7 and §9 and already existed as numeric
constants in `signet.ts` for mobile. They had **no CSS custom properties**, so web had no way to name
them at all. They do now: `--text-*`, `--space-*`, `--touch-*`.

A custom property alone is not reachable from a component, so the two families that add capability
are also bound as utilities in `apps/web/tailwind.config.ts`:

| Family | Utilities | Why |
| ------ | --------- | --- |
| `--text-*` | `text-display` / `-headline` / `-title` / `-body` / `-label` / `-caption` | Tailwind has no equivalent scale, so without this a screen writes `text-[12.5px]`. Each key carries size, line height and weight together |
| `--touch-*` | `min-h-touch`, `min-h-button`, `min-w-touch` | Names the 44px floor so a reviewer can see it honored |
| `--space-*` | **none, deliberately** | Tailwind's own spacing scale **is** this 4px grid (`p-2` is 8px, `gap-4` is 16px). A second named spelling would be a parallel token set on one surface, which the cutover rule bans. The custom properties exist for hand-written CSS and for parity with the mobile token source, not to replace `p-4` |
| `--scrollbar-*` | none needed | Consumed directly by the `.signet-scroll` rule |

Scrollbars are genuinely new. Nothing specified them before; they are now
[`foundations.md`](../design-system/foundations.md) §12, with `--scrollbar-*` tokens and a
`.signet-scroll` opt-in class. Lane 2 consumes them.

### Two AA text lifts

The lighter ladder pushed two solid semantics under the 4.5:1 gate on the surfaces their badges sit
on. `--destructive-text` already existed; `--info-text` is new. Both are CSS-only and are not new
semantics. [`foundations.md`](../design-system/foundations.md) §5 carries the rule and the
measurements.

### One accessibility fix the ladder forced

`FOCUS_RING_OFFSET` drew its ring in `--ring` (accent-8). The ring is the **entire** focus indicator
in that recipe, so it has to clear the 3:1 non-text floor unaided. It is not a two-component recipe:
`ui/switch.tsx` and `ui/tabs.tsx` are the archetypes, but `settings-fields-tab`, `settings-modules-tab`,
`chat-admin-page`, `members-directory`, `roles-page`, `documents-page` and `chapter-wizard` all use it
too — nine files. Do not delete the constant on the assumption that removing Switch and Tabs styling
orphans it. Its margin was always thin (3.05:1 against a 3.0 floor on the tightest seed) and the
lighter background consumed it: four of the nineteen seeded chapter accents dropped below, meaning
keyboard users on those chapters would have had no conforming indicator.

The ring moved to `--accent-text` (accent-11), whose worst seed is 8.48:1. The guard was not
loosened; the token moved up the scale. Details in `apps/web/components/ui/focus.ts`.

### One duplicate removed

`apps/web/components/onboarding/chapter-wizard.tsx` carried a bare `#F2B72E` literal as its default
accent. It now imports `HOUSE_SEED`. That literal was exactly the kind that would have silently
desynced on this change.

---

## 2. Open locks

Unresolved. Each needs the framework artifact in [`reference/`](reference/README.md), a decision, or
its own issue. **A lane that trips over one of these should resolve it here, not in passing.**

### L-01 — The ladder is not artifact-backed

The values above came from the bullet in #2143, not from a committed reference. The repo's own rule
([`../README.md`](../README.md)) is that committed HTML beats written docs, and there is no
committed HTML for this ladder. If the framework board disagrees with these four hexes, the board
wins and this lands again.

### L-02 — Chapter palettes need recomputing

`deriveSignetPalette` generates from `GENERATOR_PARAMS.background`, which moved with the ladder.
Every chapter's palette is **persisted** in `chapters.theme_palette` (written by `buildChapterPalette`
at onboarding, config PATCH and Settings accent save), so existing rows still carry values derived
against `#0E0D0B`. `useChapterTheme` applies a stored palette over the CSS defaults all-or-nothing,
so a stale row wins over `signet.css`.

**Accessibility is not at risk, and that was measured rather than assumed:** deriving all 19 seeds
against the old background and measuring the result against the *new* one, every seed still clears
4.5:1 (worst `#BF0A30` at 8.48, down from 8.80), and no seed flips the mobile fallback decision.
Nothing in `supabase/` bakes in a derived palette either — the directory seed stores raw seeds, and
grepping the old derived hexes across `supabase/` returns nothing.

**What is wrong is cosmetic and visible:** a chapter that never picked an accent has a row derived
from `#F2B72E`, so it renders `--primary: #F2B72E` beside a mark drawn in `#DDB844` and a Settings
hex placeholder that now reads `#DDB844` — two nearly-but-not-quite matching golds on one screen,
indefinitely, until something rewrites the row. A backfill was already outstanding for rows written
before the map existed; this widens it.

A SQL backfill cannot regenerate these (the derivation is TypeScript, via the vendored Radix
generator), so the options are a recompute pass through the API or clearing the Signet keys on rows
that never carried a custom accent so they fall through to the CSS defaults. Precedent for the
shape: `supabase/migrations/20260814120000_backfill_chapter_accent_color_from_branding.sql`.

### L-03 — Danger text on `--popover`

Solid `--destructive` now measures 4.482:1 on `--popover`, just under the gate (it was 4.717). The
call sites that land on a dialog, sheet, popover or menu have been migrated to `--destructive-text`
in this lane; the remainder sit on `--background`, `--surface-1` or `--card`, where the solid still
clears. Count the rest with `grep -rn 'text-destructive\b' apps/web --include='*.tsx' | grep -v spec`
rather than trusting a number written here. The rule is stated in
[`foundations.md`](../design-system/foundations.md) §5 and pinned in
`apps/web/components/billing/status-contrast.spec.ts`. The call-site migration is **not** done and
is too broad for this lane.

### L-04 — Directory naming

The epic names the commit target `spec/ui/web-shell/`; this is `web-greenfield/`. One of the two
should win. See [`README.md`](README.md) §3.

### L-05 — The `gold-ask-*` family may lose its only consumer

If lane 3 or 7 removes the Ask pill, five tokens go with it. Tracked on the
[deletion checklist](deletion-checklist.md) §4 rather than pre-emptively removed here.

---

### L-06 — The ladder is pitched unevenly, and its tightest rung got tighter

The re-pitch was not uniform. Adjacent-step contrast, old to new:

| Rung | Was | Now |
| ---- | --- | --- |
| `--surface-1` on `--background` | 1.0660 | 1.0751 |
| `--card` on `--surface-1` | 1.0624 | **1.0486** |
| `--popover` on `--card` | 1.0847 | 1.1046 |

Pinning `--surface-1` to the mark's field `#1A1A1A` is what costs the middle rung: it is the only
achromatic value in an otherwise warm ladder, so it does not sit on the same curve as its
neighbours. §10's rule is that elevation **is** luminance, and 1.0486:1 is under the 1.15 the
contrast fixture treats as "reads as the same colour" — so a `Card` placed in a `--surface-1` region
has no perceptible elevation.

Nothing guards a **minimum** adjacent-step ratio; the washout guards are `toBeLessThan` pins
recording that two surfaces alias, so they cannot catch a rung getting tighter.

One live call site was affected and is fixed at the call site rather than by moving a token
(`chapter-switcher.tsx`, whose row hover now skips to `--popover`). The ladder itself is left as
[#2143](https://github.com/pdcarlson/Frapp/issues/2143) specified, because re-pitching it is a
design decision for the framework, not a review fix. For reference, `--card` at `#232019` would give
1.0709 / 1.0817 — better balanced than either the old or the new ladder — if the framework wants it.

### L-07 — `FOCUS_RING` is unguarded and non-conforming on several seeds

The lane fixed `FOCUS_RING_OFFSET`. The **other** recipe, `FOCUS_RING` — which
[`components.md`](../design-system/components.md) §2 applies to every focusable control — was not
touched and is not guarded by anything. Measured across the 19 seeds: its diluted ring is
1.14–1.31:1 (0 of 76 seed × surface pairs clear 3:1), and the solid `accent-9` border that is
supposed to carry the indicator ranges 1.50–18.71:1, failing 3:1 on 7 of 19 seeds over `--card` and
9 of 19 over `--popover`.

This predates the greenfield and the ladder made it slightly worse. `focus-contrast.spec.ts`
asserts only that the recipe *string* contains `border-primary`; there is no contrast assertion on
`FOCUS_RING`, `FOCUS_RING_ALWAYS` or `FOCUS_RING_WITHIN` anywhere. Fixing it means choosing a
conforming token for the bordered recipe too, which is the same decision lane 1 made for the offset
recipe and should be made deliberately rather than folded into a token PR.

## 3. What this lane deliberately did not do

- **No component or screen was restyled.** The ladder moved under the existing UI; every surface
  picked up the new values through the tokens it already consumed.
- **No new token was invented for a value the spec did not already carry**, except the scrollbar
  family, which is recorded as a new section rather than slipped in.
- **No guard was loosened to make the change pass.** Where a measurement moved, the pin moved with
  it and says why. Where a floor was genuinely breached, the implementation changed instead. The one
  threshold that was raised, `INDISTINGUISHABLE` in `apps/web/tests/signet-contrast.ts`, is a
  perceptibility heuristic rather than a gate, and it replaced three scattered literals that all had
  to move together.
