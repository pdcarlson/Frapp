# Signet brand identity

> What "is Signet" at the brand level: the name, the mark, and the identity decisions every other UI spec inherits. Design tokens live in [design-system/foundations.md](design-system/foundations.md); chapter theming lives in [design-system/accent-engine.md](design-system/accent-engine.md). This doc does not restate either.

---

## 1. Identity

| Fact        | Value                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Name        | **Signet** — a rebrand of Frapp                                                                             |
| Tagline     | "Ask your chapter anything."                                                                                |
| Positioning | The AI-first operating system for Greek life — see [../product/positioning.md](../product/positioning.md)   |
| Lane        | Dark-first, warm, **consumer** (Notion / Cash App), with de-Google guardrails. Not Linear/Vercel technical. |

**Naming rule (binding).** Prose — specs, UI copy, marketing — says **Signet**. Code identifiers, package names (`@repo/*`), domains (`frapp.live`, `app.frapp.live`), and bundle ids stay **frapp** for now: the repo/package/domain rename is deferred, and any tracking for it lives in GitHub Issues, not in this spec. When citing code, cite the real current names.

---

## 2. The mark

The shipping mark is **locked emblem B**: an abstract crest with a neck break, gold on charcoal. Treat it as a crest, never as a dog, seal, or mascot in marketing copy. Canonical master is the vector in [`assets.md`](assets.md) (`packages/brand-assets/assets/signet-emblem-B.svg`); every raster renders from it. House UI accent stays `#EFB63B`; the mark itself is not that token.

| Fact             | Value                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| House gold       | `#EFB63B` — Signet's own accent. Gold/amber, never brown-bronze.                                                             |
| Accent seed      | `#DDB844` — the default chapter accent seed, equal in value to the mark gold below but a separate role; see [design-system/accent-engine.md](design-system/accent-engine.md) |
| Mark field       | `#1A1A1A` — spec'd **and** measured; the committed rasters are drawn in it                                                     |
| Mark gold        | `#DDB844` — spec'd **and** measured; the committed rasters are drawn in it                                                    |
| Shipping mark    | Locked emblem B — abstract crest, neck break, gold on charcoal                                                                |
| Mascot / extras  | Still **TBD** — the animal mascot stays blocked on the USPTO search for "Signet" (a human action). Do not commission mascot art before it clears. |

> **These two rows once described only the spec, not the pixels.** Until
> [#2153](https://github.com/pdcarlson/Frapp/issues/2153) a full census of the committed rasters
> found `#DDB844` in **zero** pixels of any file: the crest shipped as `#DDA220` on a `#151515`
> field. Raster and rows were authored in the same commit
> ([#2121](https://github.com/pdcarlson/Frapp/pull/2121)) and disagreed from birth; nothing drifted.
>
> It was closed by re-exporting the mark at the values above, **not** by writing the measured ones
> into this table — the old master was a JPEG-derived letterbox, so `#151515` and `#DDA220` were
> compression artifacts rather than brand values, and pinning the brand to them would have failed
> the next clean export against the spec it was meant to define. The source of truth is a vector
> now, and `check:brand-assets` reads pixels, so this table and the rasters cannot silently part
> again. History and the full census are in
> [`web-greenfield/tokens.md`](web-greenfield/tokens.md) L-08.

The mark and logo **MUST NOT** take the chapter accent — ever. Chapter theming recolors product UI through the accent engine; the brand itself never retints.

### Banned logo vocabulary

Binding constraints (research-derived) for any future mark exploration:

- No blue.
- No serif.
- No checkmark.
- No literal signet ring or wax seal.
- No hexagon, swirl, or gradient — the generic-AI-startup look.

### The mascot

Signet's mascot is a **seal (the animal)**. It is not a wax seal, a signet ring, or a stamp — those are banned mark vocabulary above. It is **not commissioned** and MUST NOT ship until the USPTO search that blocks the final mark clears. Do not generate or restyle assets toward this mascot piecemeal; the shipping crest is not the mascot ([assets.md](assets.md) §1).

### Platform requirements when the real mark lands

- **iOS:** Light, Dark, and Tinted app-icon variants.
- **Android:** an adaptive icon with a monochrome layer.

Asset production, storage, and sync are owned by [assets.md](assets.md).

---

## 3. Decisions recorded as of this doc

These were open questions in the research phase. This document closes them; do not reopen without a new decision record.

| Decision          | Ruling                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI typeface       | **Figtree** — humanist rounded sans, fitting the warm consumer lane. **Geist is explicitly rejected** for Signet. Weights and scale: [design-system/foundations.md](design-system/foundations.md). |
| Mobile navigation | **4 tabs: Chat (home), Events, Tasks, More.** There is no Home tab. Spec: [mobile/navigation.md](mobile/navigation.md).                                          |

Note: the design-system reference board's panel 4g draws a stale 5-tab bar; the Canvas header and all 23 screens in [design-system/reference/canvas-screens.dc.html](design-system/reference/canvas-screens.dc.html) lock 4 tabs. Four tabs win.

---

## 4. Direction map

Signet's direction is dark-first, warm, and consumer-grade. Every fact below has exactly one canonical doc — link it, never restate it:

| Topic                                                         | Canonical doc                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Neutral ladder, semantic colors, type scale, radii, spacing, elevation | [design-system/foundations.md](design-system/foundations.md)   |
| Components and skeleton/empty/error states                    | [design-system/components.md](design-system/components.md)             |
| Duotone icon recipe                                           | [design-system/iconography.md](design-system/iconography.md)           |
| Voice and UI writing                                          | [design-system/writing.md](design-system/writing.md)                   |
| Chapter accent engine (seed → 12-step scale)                  | [design-system/accent-engine.md](design-system/accent-engine.md)       |
| Mobile screens, navigation, patterns                          | [mobile/README.md](mobile/README.md)                                   |
| Design-system entry point                                     | [design-system/README.md](design-system/README.md)                     |

---

## 5. What still ships legacy

The landing site still ships the legacy Frapp **bone/bronze** look until its reskin session; its frozen README marks this — [landing/README.md](landing/README.md). The web dashboard cut over with the #920 shell slice and is Signet — [web-dashboard/README.md](web-dashboard/README.md). New Signet work MUST NOT copy visual patterns from the landing surface.
