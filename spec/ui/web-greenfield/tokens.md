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

> **This rationale does not hold.** The committed mark's field is `#151515` and its gold is
> `#DDA220`; `#1A1A1A` / `#DDB844` describe the superseded SVG reconstruction. The rung is left as
> shipped because correcting it is a brand decision, not a lane-1 edit. See L-08.

### Accent seed

The house default seed moved from `#F2B72E` to `#DDB844`, the value the spec calls the mark gold.

Three golds now coexist, and they are not interchangeable:

| Gold | Value | What it is |
| ---- | ----- | ---------- |
| House gold | `#EFB63B` | Signet's own brand accent. Paints the Ask and AI surface. Never retints per chapter. Unchanged. |
| Mark gold | `#DDB844` *(spec'd)* | The emblem, per [`../brand-identity.md`](../brand-identity.md) §2. Never takes the chapter accent. **The committed raster actually measures `#DDA220` — see L-08.** |
| Accent seed | `#DDB844` | The default fed to the accent engine. **Changed** to equal the *spec'd* mark gold. |

The seed being equal to the spec'd mark gold is a coincidence of value, not an identity. A chapter
that picks its own accent moves the seed and leaves both other golds where they are.

Note what L-08 does to the intent here: the seed was moved so an unthemed chapter would resolve to
"the same gold the crest is drawn in." The crest is drawn in `#DDA220`, so it does not — the seed
matches the spec's description of the mark, not the mark.

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
`chat-admin-page`, `members-directory`, `roles-page` and `documents-page` all use it
too — eight files, across nine usage sites (`documents-page` applies it twice). Nine is where the
old count came from. (`chapter-wizard` is not one of them: it imports and applies `FOCUS_RING`, and
names `FOCUS_RING_OFFSET` only inside a JSX comment. That comment cites
[#1215](https://github.com/pdcarlson/Frapp/issues/1215) in the present tense, but #1215 closed
completed on 2026-08-28 via [#1348](https://github.com/pdcarlson/Frapp/pull/1348), and lane 1 has
since moved that ring again — accent-8 to accent-11. The comment is stale twice over; L-07 owns what
is left of it.)

Do not delete the constant on the assumption that removing Switch and Tabs styling orphans it. Its
margin was always thin (3.05:1 against a 3.0 floor on the tightest seed) and the lighter background
consumed it: four of the nineteen seeded chapter accents dropped below, meaning
keyboard users on those chapters would have had no conforming indicator.

The ring moved to `--accent-text` (accent-11), whose worst seed is 8.48:1. The guard was not
loosened; the token moved up the scale. Details in `apps/web/components/ui/focus.ts`.

### One duplicate removed

`apps/web/components/onboarding/chapter-wizard.tsx` carried a bare `#F2B72E` literal as its default
accent. It now reads `signetDarkTokens.color.gold.seed` from `@repo/theme/signet`. That literal was
exactly the kind that would have silently desynced on this change.

It deliberately does **not** import `HOUSE_SEED` from `@repo/chapter-theme`, and the file says why in
place: that package's `index.ts` re-exports through a `./signet.js` specifier Turbopack cannot
resolve, so the import type-checks and passes vitest and then fails `next build`. Both constants
carry the same value. Reaching for the more obvious-looking one reintroduces a build failure.

---

## 2. Open locks

Each needs the framework artifact in [`reference/`](reference/README.md), a decision, or its own
issue. **A lane that trips over one of these should resolve it here, not in passing.**

L-01 is **closed** as of 2026-09-11 and kept in place rather than deleted: it is what the framework
board settles, three other locks cite it, and the comparison it now carries is the only record of
where the board and the theme package disagree. The rest are open.

L-08 and L-09 reach past this epic, so they carry issues —
[#2153](https://github.com/pdcarlson/Frapp/issues/2153) and
[#2154](https://github.com/pdcarlson/Frapp/issues/2154) — and outlive this directory, which is
retired when [#2140](https://github.com/pdcarlson/Frapp/issues/2140) closes. The rest are lane-1
consequences that a greenfield lane resolves here.

### L-01 — CLOSED 2026-09-11. The ladder is artifact-backed, and the board agrees

The values in §1 came from the bullet in #2143, not from a committed reference, and the repo's rule
([`../README.md`](../README.md)) is that committed HTML beats written docs. The framework board is
now committed at [`reference/web-framework.dc.html`](reference/web-framework.dc.html). Its token
sheet is option `3a`.

**It states the same four hexes and the same seed.** Nothing in §1's ladder lands again.

| Role | §1 / [#2152](https://github.com/pdcarlson/Frapp/pull/2152) | Board `3a` |
| ---- | ---- | ---- |
| `--background` | `#131211` | `#131211` |
| `--surface-1` | `#1A1A1A` | `#1A1A1A` |
| `--card` | `#211E1A` | `#211E1A` |
| `--popover` | `#2A2621` | `#2A2621` |
| Accent seed / `--primary` | `#DDB844` | `#DDB844` |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(255,255,255,.08)` |
| `--input` (interactive edge) | `rgba(255,255,255,0.14)` | `rgba(255,255,255,.14)` |
| `--foreground` / `--muted-foreground` / `--muted` / `--disabled` | `#EDEAE3` / `#A9A399` / `#78716A` / `#57534C` | the same four, and the board calls the text ladder "unchanged" |

This closes the lock as stated. It does **not** close L-06 or L-08, which the board was also hoped to
settle — see those entries, and
[`reference/README.md`](reference/README.md) § What this board settles.

#### Where the board and the theme package differ

Twelve roles. **None is a ladder or seed value, and none is actionable in a token PR** — which is why
L-01 closes rather than reopening §1. They are recorded because the board outranks this file, so a
lane that reaches one should know the board already has a position on it.

**Seven are accent-engine output, not authored values.**

| Role | Shipped | Board `3a` |
| ---- | ------- | ---------- |
| `--primary-hover` | `#D2AD37` | `#C9A63A` |
| `--primary-foreground` | `#292109` | `#2A2000` |
| `--accent-subtle` | `#282314` | `#2A2410` |
| `--accent-border` | `#5F522C` | `#6B5A24` |
| `--accent-text` | `#E7C86B` | `#F0CD5E` |
| `--gold-ask-fill` / `--gold-ask-border` / `--gold-ask-text` | `#251E0E` / `#6B5619` / `#F4CB63` | `#2A2410` / `#6B5A24` / `#F0CD5E` |

The shipped values are generated by `deriveSignetPalette` from the seed through the vendored Radix
generator. The board's are literals a design tool picked for one tenant. **Adopting them is not a
token edit — it is a change to the generator, and it moves all 19 seeds**, which is L-02's blast
radius and not something to fold into a lane. The board is not asking for that: its own header reads
"seed `#DDB844` **through the accent engine** (demo tenant = house)", so it is depicting engine
output it did not itself run.

One trap in that table. The board's Ask family is identical to its `--accent-subtle` family, and the
board also says "Ask family is fixed and never retints." Both are true **only because the demo tenant
is the house tenant**, where the seed and the house gold coincide. It is not a statement that the
fixed `--gold-ask-*` family should collapse into the retinting `--accent-*` one. A lane that merges
them on the board's authority breaks the no-retint rule on every chapter that picks an accent.

**Three are authored, and are genuine conflicts the board wins — but they are chrome, so lane 2
([#2141](https://github.com/pdcarlson/Frapp/issues/2141)) owns them, not this file.**

| Role | Shipped | Board `3a` |
| ---- | ------- | ---------- |
| `--scrollbar-width` | `10px` | `8px` |
| `--scrollbar-thumb` / `--scrollbar-track` | `rgba(255,255,255,0.14)` / `transparent` | `#DDB844` / `#1A1A1A`, with a 2px track-coloured border on the thumb |
| `--skeleton-highlight` | `#38312A` | `#332E26` |

The scrollbar rows are the larger change: the board draws a gold thumb on a `--surface-1` track and
claims 8.9:1 thumb on track, where the shipped `.signet-scroll` draws a neutral thumb on a
transparent one. The board also applies it at `:root` rather than as an opt-in class.
[`../design-system/foundations.md`](../design-system/foundations.md) §12 moves with it whenever lane
2 takes it.

**Two roles are not comparable.** The board gives `--ring` as "3px · 25%" — geometry and opacity, not
a colour — so it neither confirms nor contradicts the shipped `#796938`, and it says nothing about
`FOCUS_RING` (L-07). Its grid is stated as "4px grid" in geometry terms only, so it takes no position
on §1's decision to bind no `--space-*` utilities.

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
from `#F2B72E`, so it renders `--primary: #F2B72E` beside a mark drawn in `#DDA220` (L-08) and a
Settings hex placeholder that now reads `#DDB844` — three nearly-but-not-quite matching golds on one
screen,
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

If lane 3 or 7 removes the Ask pill, three tokens go with it — `--gold-ask-fill`, `--gold-ask-border`
and `--gold-ask-text`. Tracked on the [deletion checklist](deletion-checklist.md) §4 rather than
pre-emptively removed here.

---

### L-06 — The ladder is pitched unevenly, and its tightest rung got tighter

The re-pitch was not uniform. Adjacent-step contrast, old to new:

| Rung | Was | Now |
| ---- | --- | --- |
| `--surface-1` on `--background` | 1.0660 | 1.0751 |
| `--card` on `--surface-1` | 1.0624 | **1.0486** |
| `--popover` on `--card` | 1.0847 | 1.1046 |

Pinning `--surface-1` to `#1A1A1A` is what costs the middle rung: it is the only
achromatic value in an otherwise warm ladder, so it does not sit on the same curve as its
neighbours. §10's rule is that elevation **is** luminance, and 1.0486:1 is under the 1.15 the
contrast fixture treats as "reads as the same colour" — so a `Card` placed in a `--surface-1` region
has no perceptible elevation.

Nothing guards a **minimum** adjacent-step ratio; the washout guards are `toBeLessThan` pins
recording that two surfaces alias, so they cannot catch a rung getting tighter.

**L-08 dissolves the premise of that paragraph.** `#1A1A1A` was adopted as the mark's field and is
not it, so nothing brand-related pins this rung — moving `--surface-1` is on the table alongside the
`--card` alternative below, and a lane picking this up should not treat it as locked.

One live call site was affected and is fixed at the call site rather than by moving a token
(`chapter-switcher.tsx`, whose row hover now skips to `--popover`). The ladder itself is left as
[#2143](https://github.com/pdcarlson/Frapp/issues/2143) specified, because re-pitching it is a
design decision for the framework, not a review fix. For reference, `--card` at `#232019` would give
1.0709 / 1.0817 — better balanced than either the old or the new ladder — if the framework wants it.

**The framework has now landed and does not want it.** The board states `--card: #211E1A`, the
shipped value, and says nothing about adjacent-step pitch (L-01). So `#232019` has no artifact behind
it, and nobody should re-pitch `--card` on the strength of the paragraph above alone. **The concern
itself is untouched** — 1.0486:1 is still under the fixture's perceptibility threshold, and a `Card`
in a `--surface-1` region still has no perceptible elevation. What the board removes is the easy
remedy, not the defect. Resolving this now means either a design decision the board did not make, or
reopening it with Design.

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

### L-08 — The mark's field and gold in the spec do not match the committed mark

The ladder pinned `--surface-1` to `#1A1A1A` on the stated grounds that it is the mark's own field.
It is not, and the pair `#1A1A1A` / `#DDB844` does not describe either committed raster.

Decoded from the committed assets:

Full pixel census of both files as committed at `d43e977`, decoded 2026-09-11:

| Asset | Field | Gold | `#1A1A1A` | `#DDB844` |
| ----- | ----- | ---- | --------- | --------- |
| `signet-emblem-B-tile.png` (1024², the in-app tile) | `#151515` 41.87%, `#161616` 19.59% | `#DDA220` 9.28% | 26 px | **0 px** |
| `signet-emblem-B-locked.png` (1280×720, the named master) | `#0A0A0A` 46.53% letterbox, `#151515` 9.48% tile face | `#DDA220` 2.13% | 17 px | **0 px** |

Neither spec'd value is present in any meaningful quantity: `#DDB844` occurs in **zero** pixels of
either file, and the `#1A1A1A` counts are antialiasing noise against a million-pixel image. The gold
gap is not a rounding difference — `#DDA220` has relative luminance 0.4132 against `#DDB844`'s
0.5007.

Reproduce with a full decode, not a sample: both files are 8-bit RGB PNGs, so any zlib-inflate plus
un-filter pass will do — `python3 -c` with `zlib` and `struct` is enough, and sampling every *n*-th
pixel understates the rare-colour counts.

`#1A1A1A` / `#DDB844` are exactly the values of the superseded SVG reconstruction, which
[`../assets.md`](../assets.md) itself labels "not the shipping mark."

**The framework board does not settle this, and reads as though it might.** Its token sheet writes
the mark as "`#DDB844` on `#1A1A1A`, raster only" — the spec'd pair, restated. The board was drawn
from the same spec in the same week, so it is a fourth copy of the claim rather than independent
evidence about the raster, and rank 1 in the trust order does not make a restatement a measurement.
It also renders the real emblem PNG throughout, so the board simultaneously *shows* `#DDA220` and
*labels* it `#DDB844`. Nothing here moves [#2153](https://github.com/pdcarlson/Frapp/issues/2153).

**They did not drift apart — they never agreed.** `267dafa`
([#2121](https://github.com/pdcarlson/Frapp/pull/2121)) is the only commit that has ever touched
either raster, and it *added* them; there was no prior raster to replace. The same commit introduced
the hex rows (before it, §2 read "Placeholder mark | Rounded-square 'S' tile on house gold" with no
field or gold) and rewrote both SVGs, which had held `#0F172A` / `#60A5FA`. Raster, SVG and spec were
authored in one pass and disagreed from birth. That matters for the remedy: ignoring or deleting the
SVG does not restore a lost provenance, because the SVG was generated in the same pass and is not an
upstream the raster drifted from. **This list is the work list for whichever
direction the decision goes:** [`../brand-identity.md`](../brand-identity.md) §2,
[`../assets.md`](../assets.md) §1 and §3,
[`../design-system/accent-engine.md`](../design-system/accent-engine.md) §3 ("the same gold the crest
is drawn in"), this file's own §1 "Three golds" table and L-02, plus `signet-mark.tsx`,
`auth-screen.tsx`, `frapp-lockup.tsx`, `opengraph-image.tsx` and `apps/mobile/app.json` (field only;
it carries no gold). Tests assert the literals rather than the pixels, so they move too.

**The one entry on that list that is executable, not prose:** `scripts/rasterize-brand-assets.mjs`
declares its own `FIELD` (`#1A1A1A`) and `GOLD` (`#DDB844`) constants. `FIELD` is the `.flatten()`
background under every generated icon, and `GOLD` is the centroid of a `dr²+dg²+db² < 90²` classifier
that extracts the glyph for the Android monochrome adaptive icon. The real gold sits 42.2 units from
that centroid — inside the radius, so it works today, with roughly 48 units of unlabelled margin. A
future re-export that shifts the gold past it produces a silently **empty** monochrome icon, and
nothing catches that: the script has no test, and `check:brand-assets` only compares hashes.

Two consequences for this lane specifically:

- **The flush claim fails as written.** `#151515` on `#1A1A1A` is a slightly darker patch, not flush.
- **Nothing in the product actually reads the rung as the mark's field.** `signet-mark.tsx` sets its
  own backdrop from a local `const FIELD = "#1A1A1A"` (`:14`), not from `var(--surface-1)`, and then
  covers it entirely with the opaque raster (`fill` + `object-cover`) — though not always: the
  `<Image>` carries no `priority`, so it is lazily loaded, and during first paint or on any fetch
  failure that `#1A1A1A` backdrop *is* the rendered mark. So the token and the mark are not wired
  together at all: the rung's stated purpose is served by a hardcoded literal that is itself the
  stale value. What `--surface-1` governs is the surface the tile *abuts*, which is where
  the `#151515` vs `#1A1A1A` mismatch is actually visible — and it costs L-06's middle step to do it.

**This needs a decision, not a doc fix, and the two directions are not symmetric.**

- **Re-export the mark** at `#1A1A1A` / `#DDB844` so the spec becomes true.
  [`../assets.md`](../assets.md) §8 makes this mechanical, but it needs Design to supply a lock
  actually drawn in those values.
- **Re-measure the spec** to `#151515` / `#DDA220` — and this is the trap. **Those are not brand
  values; they are compression artifacts.** `scripts/rasterize-brand-assets.mjs` says so in its own
  docstring: "Design's upload is a 16:9 letterbox around a centered charcoal tile. **JPEG letterbox
  is not pure black (~rgb 10)**", and the file guards against "JPEG-as-png" leftovers by name. The
  evidence is in the pixels: 24,069 distinct colours in a two-colour design, 8×8 DCT block-boundary
  discontinuity, a chroma-subsampling signature, and only ~38% of gold pixels landing exactly on
  `#DDA220`. The tile is then cropped and upscaled 2.26×, so its modal colours are artifacts of
  artifacts. Writing them into the brand spec would pin the mark to JPEG noise and make the next
  clean vector export *fail* the spec it was supposed to define.

So the measured values are evidence that the spec and the asset disagree — **not** a candidate
replacement for the spec. It is a brand call, not a lane-1 correction, so this lane records it and
changes nothing. Tracked as [#2153](https://github.com/pdcarlson/Frapp/issues/2153).

Nothing enforces either direction today: `scripts/check-brand-assets.mjs` compares the master against
its synced copies by sha256 and never reads a pixel, so a re-export that misses the spec'd hexes
passes the same as one that hits them.

### L-09 — Five `--text-*` line heights are invented values

Tracked as [#2154](https://github.com/pdcarlson/Frapp/issues/2154).

§1 above presents the `--text-*` utilities as the wiring half of an already-specified scale, and §3
claimed no new value was invented. Both are true of the sizes and weights and false of the line
heights. `foundations.md` §7 states exactly one — `--text-body-line` (25px), which it calls "the only
one the scale states" — so `display`, `headline`, `title`, `label` and `caption` carry literals in
`apps/web/tailwind.config.ts` (`1.15`, `1.2`, `1.3`, …) that no spec defines. The block's own comment
claimed the values were read from the custom properties; that comment is corrected in this change.

Either promote the five into `foundations.md` §7 and `signet.css` as real tokens, or state in §7 that
the non-body roles take a ratio chosen at the utility layer. Leaving it as-is means a screen that
matches the spec and a screen that matches the utilities can disagree, with nothing to arbitrate.

---

## 3. What this lane deliberately did not do

- **No component or screen was restyled.** The ladder moved under the existing UI; every surface
  picked up the new values through the tokens it already consumed.
- **Almost no new token was invented for a value the spec did not already carry.** The scrollbar
  family is the recorded exception, added as a new section rather than slipped in. One further
  exception was *not* recorded at the time and is now L-09: five of the six `--text-*` line heights
  are literals in `apps/web/tailwind.config.ts` that the type scale never states.
- **No guard was loosened to make the change pass.** Where a measurement moved, the pin moved with
  it and says why. Where a floor was genuinely breached, the implementation changed instead. The one
  threshold that was raised, `INDISTINGUISHABLE` in `apps/web/tests/signet-contrast.ts`, is a
  perceptibility heuristic rather than a gate, and it replaced four scattered literals that all had
  to move together — one each in `table-contrast`, `elevation-contrast`, `profile-contrast` and
  `status-contrast`, as the fixture's own docstring records. (Named by file, not by line: the
  docstring's own line numbers have already drifted.)
