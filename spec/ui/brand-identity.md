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

The shipping mark is a **placeholder**: a rounded-square tile in house gold carrying a bold "S" glyph. The committed visual truth is the reference boards — [design-system/reference/signet-design-system.dc.html](design-system/reference/signet-design-system.dc.html) (identity panel) and [design-system/reference/canvas-screens.dc.html](design-system/reference/canvas-screens.dc.html) (mark in context).

| Fact             | Value                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| House gold       | `#EFB63B` — Signet's own accent. Gold/amber, never brown-bronze.                                                             |
| Accent seed      | `#F2B72E` — the default chapter accent seed; see [design-system/accent-engine.md](design-system/accent-engine.md)            |
| Placeholder mark | Rounded-square "S" tile on house gold                                                                                        |
| Final logo       | **TBD** — blocked on a USPTO trademark search for "Signet" (a human action). Do not commission or ship a final mark before it clears. |

The mark and logo **MUST NOT** take the chapter accent — ever. Chapter theming recolors product UI through the accent engine; the brand itself never retints.

### Banned logo vocabulary

Binding constraints (research-derived) for any future mark exploration:

- No blue.
- No serif.
- No checkmark.
- No literal signet ring or wax seal.
- No hexagon, swirl, or gradient — the generic-AI-startup look.

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
