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
constants in `signet.ts` for mobile. They had **no CSS custom properties**, so web chrome restated
sizes and spacing per component. They do now: `--text-*`, `--space-*`, `--touch-*`.

Scrollbars are genuinely new. Nothing specified them before; they are now
[`foundations.md`](../design-system/foundations.md) §12, with `--scrollbar-*` tokens and a
`.signet-scroll` opt-in class. Lane 2 consumes them.

### Two AA text lifts

The lighter ladder pushed two solid semantics under the 4.5:1 gate on the surfaces their badges sit
on. `--destructive-text` already existed; `--info-text` is new. Both are CSS-only and are not new
semantics. [`foundations.md`](../design-system/foundations.md) §5 carries the rule and the
measurements.

### One accessibility fix the ladder forced

`FOCUS_RING_OFFSET` drew its ring in `--ring` (accent-8). That recipe is used by `Switch` and
`TabsTrigger`, where the ring is the **entire** focus indicator, so it has to clear the 3:1 non-text
floor unaided. Its margin was always thin (3.05:1 against a 3.0 floor on the tightest seed) and the
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
Every chapter's palette is **persisted** in `chapters.theme_palette`, so existing rows still carry
values derived against `#0E0D0B`. They are not wrong enough to break anything — all 19 seeded
accents still clear the engine's §8 gate on the new background, and a save or recompute refreshes a
row — but until a backfill runs, chapters are painted from a slightly stale derivation. A backfill
was already outstanding for rows written before the map existed; this widens it rather than creating
it.

### L-03 — Danger text on `--popover`

Solid `--destructive` now measures 4.48:1 on `--popover`, just under the gate. There are 38
`text-destructive` call sites in `apps/web`; the ones that land on a dialog, sheet, or menu should
take `--destructive-text` instead. The rule is stated in
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
