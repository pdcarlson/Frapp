# Design Foundations

> The Signet token foundation — fixed neutral and semantic colors, typography, radius, spacing, and elevation — transcribed from the written token spec (panel 4h) of the committed design reference, with the one recorded supersession (radius) called out below.

---

## 1. Sources & Scope

- **Visual truth:** [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html). Panel 4h is the written token spec this file transcribes; panels 4a–4g render the same tokens. [`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) is the screen-level reference. Where the Canvas header and panel 4h disagree, **the Canvas header wins** — the only such case is radius (§8).
- **Scope:** these tokens govern **Signet surfaces** — the mobile app and the web dashboard (`apps/web` ships them via `packages/theme/src/signet.css` since the #920 shell cutover), plus the landing site when it reskins. Until then, `apps/landing` keeps shipping the legacy bone/bronze/ink tokens from `packages/theme` (`@repo/theme`). The two systems MUST NOT mix on one surface.
- **Naming:** prose says Signet; code identifiers and package names stay `frapp` / `@repo/*` until the deferred repo rename.
- Brand identity (house gold, the "S" mark, direction) is owned by [`brand-identity.md`](../brand-identity.md). Per-chapter accent generation is owned by [`accent-engine.md`](accent-engine.md). Component-level application of these tokens is owned by [`components.md`](components.md).

---

## 2. Surface Ladder (Neutrals)

Fixed for every chapter — only the accent varies per tenant.

| Token | Value | Role |
|-------|-------|------|
| `--background` | `#131211` | App background, base of the ladder |
| `--surface-1` | `#1A1A1A` | Raised surface — nav bars, input fills, other-party chat context |
| `--card` | `#211E1A` | Cards and list rows |
| `--popover` | `#2A2621` | Elevated surface — sheets, popovers, menus (the "elevated" step) |

Rationale: a warm charcoal ladder deliberately lifted off a pure `#0a0a0a` floor so the warmth reads on real screens. Each step is visibly lighter than the one below it, which is what carries elevation (§10).

**The ladder was re-pitched for the web greenfield** ([#2143](https://github.com/pdcarlson/Frapp/issues/2143)). It previously ran `#0E0D0B` / `#171512` / `#1E1B17` / `#26221C`. Two things moved with it, and both are deliberate:

- `--surface-1` is now `#1A1A1A`, stated at the time as the **mark's own field** ([`../brand-identity.md`](../brand-identity.md) §2), so locked emblem B would sit flush on the raised surface instead of on a warmer neighbour. **That rationale did not survive measurement at the time:** the committed mark's field measured `#151515` and its gold `#DDA220`, so `#1A1A1A` was close to but not the mark's field, and the emblem did not sit flush. [#2153](https://github.com/pdcarlson/Frapp/issues/2153) closed the gap by re-exporting the mark at the spec'd pair rather than by moving this rung, so the rationale now holds and the value never changed — see [`../web-greenfield/tokens.md`](../web-greenfield/tokens.md) L-08 for the measurements and the history.
- Every step is lighter than before, which lowers contrast for light text by 0.142 to 0.681 points. **Three pairs crossed** below the 4.5:1 gate in [`README.md`](README.md) §6 as a result, and are handled in §5: `--destructive` on `--popover` (4.717 → 4.482), `--info` on `--card` (4.577 → 4.429), and `--mention` on `--surface-1` (4.656 → 4.447).
- **Three more pairs are sub-AA but were already sub-AA before this ladder**, and are not this change's doing: `--info` on `--popover` (4.220 → 4.010), `--mention` on `--card` (4.383 → 4.238) and `--mention` on `--popover` (4.040 → 3.839). They are named here so the next ladder change is not reasoned from an inflated cost, and so nobody tries to "restore" contrast by darkening the ladder to fix failures that predate it.

---

## 3. Borders & Hairlines

| Token | Value | Role |
|-------|-------|------|
| `--border` | `rgba(255,255,255,.08)` | Default hairline — card edges, dividers, tab rules |
| `--input` | `rgba(255,255,255,.14)` | Input and secondary-button borders — stronger, so interactive edges read as interactive |

Borders MUST be low-opacity white. Fixed-hex border colors are banned: an opaque border tuned for one surface breaks on every other step of the ladder, while an alpha hairline tracks whatever it sits on.

---

## 4. Text Ladder

| Token | Value | Role |
|-------|-------|------|
| `--foreground` | `#EDEAE3` | Primary text |
| `--muted-foreground` | `#A9A399` | Secondary text |
| `--muted` | `#78716A` | Muted text — placeholders, timestamps, metadata |
| `--disabled` | `#57534C` | Disabled text |

Token names follow panel 4h (ShadCN-style); panel 4a labels the same values text / secondary / muted. All four are warm-tinted to match the surface ladder — pure grays look dirty on warm charcoal.

---

## 5. Semantic Colors

Status-only, never decorative. A semantic hue states a fact ("paid", "overdue"); it never tints chrome, headings, or illustration.

| Token | Value | Use |
|-------|-------|-----|
| `--success` | `#3fb950` | Paid, confirmed, checked-in, inside-zone |
| `--warning` | `#e5a000` | Pending, at-risk, degraded |
| `--destructive` | `#f85149` | Errors, overdue, destructive actions |
| `--info` | `#2f81f7` | Informational status only — never a brand or accent color |
| Mention/DM red | `#E5484D` | "You were addressed" — mention badges and DM indicators |

- **Mention/DM red is fixed and semantic.** `#E5484D` states exactly one fact — *you were addressed*: an @-mention or a direct message. It MUST NOT be replaced by the chapter accent under any seed, and MUST NOT stand in for any other status, so "you were addressed" reads identically in every chapter. Its foreground is white. (This row is not in panel 4h; it is locked by the Canvas header and screens.)
  - **White on this red measures 3.91:1**, under the 4.5:1 text floor [README.md](README.md) §6 sets, and it is the one drawn tone [components.md](components.md) §1's lift cannot rescue — the text is already white, and the fill is the fixed semantic. Both shipping surfaces render it as drawn; the miss is real, is pinned to its measured value by `apps/web/components/chat/chat-contrast.spec.ts`, and needs a system-level decision (darken the fill for both platforms, or grant the badge an explicit exemption) rather than a per-surface patch — tracked in #1190.
- **Channel unread is neutral — never red, never accent.** Red is reserved for direct address, so an unread channel signals itself without it (Canvas chat list, `s04`): a count badge filled `rgba(255,255,255,.14)` — the `--input` value from §3 — with `--foreground` text, plus the row itself emphasized, bold title in `--foreground` over a `--muted-foreground` preview. A read row drops to a lighter title in `--muted-foreground` over a `--muted` preview and carries no badge at all, only its timestamp. The mention/DM badge is that same badge with the fill swapped to `#E5484D` and the text to white — fill and text are the only difference, so badge geometry stays one recipe, owned by [`components.md`](components.md).
- On dark surfaces, semantic fills are tints, not solids: ~13% opacity of the hue as background with a lightened step of the same hue as text (see panels 4a/4d). Chip and badge recipes are specified in [`components.md`](components.md).
- **A lifted text tone is not a second semantic.** [`components.md`](components.md) §5 lets an implementation raise the *text* tone of a semantic for AA while the hue stays fixed; the solid token remains the fill and the border. The greenfield ladder (§2) made two of these load-bearing rather than optional, because solid `--destructive` and solid `--info` now fall under 4.5:1 on the surfaces their badges sit on:

  | Text token | Value | Lifts | Measured on `--card` / `--popover` |
  |---|---|---|---|
  | `--destructive-text` | `#FF7B72` | `--destructive` (4.95 / 4.48 solid) | 6.58 / 5.96 |
  | `--info-text` | `#4C93F8` | `--info` (4.43 / 4.01 solid) | 5.40 / 4.89 |

  Both are CSS-only (`packages/theme/src/signet.css`); neither is a `signetDarkTokens` entry, because neither is a new semantic. Use the lifted token wherever the hue is **text**, and the solid wherever it is a fill or a border.

  **The two lifts do not have the same reach, and `--info-text` does not cover every case.** On plain surfaces both clear throughout. On the §5 *tint* recipe (13% of the hue as fill, the hue as text) `--destructive-text` measures 4.80–6.12:1 across the four steps and clears, but `--info-text` measures 4.08–5.16:1 and **fails on a `--popover`-seated tint (4.08)**. An info badge inside a dialog, sheet or menu therefore needs a further lift or a solid fill; the token as specified does not reach it. No surface renders `--info` today, so nothing is broken by this — but the first consumer must not assume the twin is sufficient.
- **Mention red did not get a lifted tone, and the reason matters.** `#E5484D` now measures 4.45:1 on `--surface-1` and below that on `--card` and `--popover`, so it is under the text floor on every step except `--background`. It is exempt from the lift above because it is not drawn as text: it is a badge fill carrying white text (the separate, tracked 3.91:1 miss above) and an avatar dot, and a dot is non-text UI held to §6's 3:1 floor, which it clears on every step. A future surface that renders mention red **as text** needs a lifted tone first; it does not have one today.

---

## 6. Accent Slot (Per Tenant)

The tokens above are fixed; the accent family — `--primary`, `--primary-hover`, `--primary-foreground`, `--ring`, `--accent-subtle`, `--accent-border`, `--accent-text` — is resolved per chapter from a single seed hex by the accent engine. The raw seed never paints UI directly. Pipeline, scale-step mapping, caching, and the default house-gold seed are owned by [`accent-engine.md`](accent-engine.md).

---

## 7. Typography

**Family: Figtree** — weights **400 / 600 / 700 only**. (Panel 4b shows three candidates and panel 4h says "candidate pending pick"; the pick is locked: Figtree.)

| Style | Size / line | Weight |
|-------|-------------|--------|
| display | 32 | 700 |
| headline | 24 | 700 |
| title | 18 | 600 |
| body | 16 / 25 | 400 |
| label | 14 | 600 |
| caption | 12.5 | 400 |

Body text MUST NOT render below 16. Label and caption are for controls and metadata, never paragraphs — this is a consumer app read at arm's length, not a dense dashboard.

**Monospace is a separate role with its own family, not a Figtree weight.** Reserve it for numeric, status, and code-like strings where fixed-width character alignment matters — invite tokens, permission keys, user ids, points-table cells, and the Join-code row of the settings screen in the Canvas reference. Its family is the `--font-mono` system stack (`packages/theme/src/globals.css`, exposed as the Tailwind `mono` family by `packages/theme/src/tailwind.config.ts`); the family decision — a system stack, never a bundled webfont — is owned by [`../../architecture/README.md`](../../architecture/README.md) §15. Mono carries no size of its own: it takes the size of the role it sits in.

> **The mobile study timer is deliberately not on that list.** It used to be. Canvas draws s10's timer in Figtree 700 with
> `font-variant-numeric: tabular-nums`, which solves the same problem mono was
> reserved for — digits that do not jitter as they tick — while keeping the
> brand face on the largest number on the screen. The reference wins on visuals
> ([`../README.md`](../README.md)), so `apps/mobile/components/study/session-card.tsx`
> ships tabular-nums Figtree and this list no longer claims otherwise. Prefer
> the same treatment for any other live-counting numeral — the web dashboard's
> own study timer (`apps/web/components/study/study-page.tsx`) was still on
> `font-mono` until the #920 Chapter Ops slice, so "prefer" now has two
> shipped consumers rather than one and a standing exception.

**Money is a figure, not a code-like string.** Amounts are stored and
transported as integer **cents** (`financial_invoices.amount`, bounded
1–99,999,999 per [`../../behavior/billing.md`](../../behavior/billing.md); every
dues-config field is a `*_cents` non-negative integer). They render through one
helper per platform — [`apps/web/lib/currency.ts`](../../../apps/web/lib/currency.ts)
and `apps/mobile/lib/dues/invoices.ts` — as `$X,XXX.XX`, and take
`tabular-nums` so a column of amounts is comparable down the page. They do
**not** take mono: the reserved list above is ids, tokens, keys and points
cells, where the string is code-like. The `$` is a literal rather than a locale
symbol because the server mints every PaymentIntent in `usd`. This convention
shipped on both platforms before it was written down here.

Sizes MUST come from the scale above. Inventing an off-scale font size in screen code — including arithmetic on a role token, e.g. `tokens.type.section - 2` — is a defect, exactly as a raw hex value is ([`../mobile/README.md`](../mobile/README.md)).

### Type tokens

The same six roles as CSS custom properties, for web surfaces. Mobile reads the numeric source off `typography.role` in `packages/theme/src/signet.ts` instead; these are the web half of the same scale, not a second one.

| Token | Value | Role |
|-------|-------|------|
| `--text-display` | `32px` | display size |
| `--text-display-weight` | `700` | display weight |
| `--text-headline` | `24px` | headline size |
| `--text-headline-weight` | `700` | headline weight |
| `--text-title` | `18px` | title size |
| `--text-title-weight` | `600` | title weight |
| `--text-body` | `16px` | body size, the floor for paragraph text |
| `--text-body-weight` | `400` | body weight |
| `--text-body-line` | `25px` | body line height, the only one the scale states — see the note below on the other five |
| `--text-label` | `14px` | label size |
| `--text-label-weight` | `600` | label weight |
| `--text-caption` | `12.5px` | caption size |
| `--text-caption-weight` | `400` | caption weight |

**The other five roles ship a line height this scale does not define.** `display`, `headline`,
`title`, `label` and `caption` are emitted as Tailwind `fontSize` keys in
`apps/web/tailwind.config.ts`, and each pairs its size and weight (both read from the custom
properties above) with a **literal** ratio — `1.15`, `1.2`, `1.3`, `1.3`, `1.35` — chosen when those
utilities landed rather than derived from anything here. So a screen written against this section and
a screen written against `text-title` can disagree, with nothing to arbitrate. Either promote the
five into this table as real tokens, or record here that the non-body roles take a ratio owned at the
utility layer. Tracked as L-09 in [`../web-greenfield/tokens.md`](../web-greenfield/tokens.md).

---

## 8. Radius

Canonical map (locked; supersedes panel 4h — see deviation note):

| Surface | Radius |
|---------|--------|
| Controls, inputs, buttons | 12 |
| Cards | 14 standard · 16 large |
| Chat bubbles | 18, tail corner 6 |
| Sheets + AI answer card | 20 |
| Badges / chips | 8–10 |
| Sidebar / nav item | 10 |
| Avatars | 50% (circle) |

- Radii MUST come from this map. Inventing an off-map radius in screen code is a defect, exactly as a raw hex value is.
- **No pill shapes** (`border-radius: 999px` on rectangles) except toggle tracks and **proportion meters** — a meter's track and its fill are both full-round. The reference draws them that way ([`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) s10 and s22 both render an 8px track and its fill at `999px`), and references beat docs on visuals, so the exception is recorded here rather than left as a standing conflict. The recipe is [`apps/web/components/shared/meter.ts`](../../../apps/web/components/shared/meter.ts).
- The graduated map is intentional: small elements take small radii, conversational and elevated surfaces take the largest, so roundness itself signals what kind of surface you are on. Sheets and the AI card share the 20 ceiling because both are "special" surfaces.

> **Deviation note — panel 4h predates the radius lock.** 4h reads `control/card: 14 · card-lg: 16 · bubble/AI/sheet: 20 · badge/chip: 8`, and panel 4e renders bubbles at r20. The Canvas header ([`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html)) locks the map above — controls 12, bubbles 18 (tail 6) — and wins. This is the only place the reference HTML is not truth for tokens. (Panel 4g's 5-tab bar is the equivalent stale artifact for navigation; see the mobile spec.)

---

## 9. Spacing & Touch Targets

- **4px grid.** Steps: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Dominant rhythm is **8 / 16 / 24**: 8 inside a component, 16 between components, 24 between sections.
- Touch targets MUST be ≥ 44px. Buttons run 46–48px tall. Tab bar items are 56px tall.

### Spacing tokens

The grid as CSS custom properties. Every value is 4 × an integer; that is the whole rule, and a spacing value that is not on this list is a defect the same way an off-scale font size is.

| Token | Value | Role |
|-------|-------|------|
| `--space-xs` | `4px` | the grid unit |
| `--space-sm` | `8px` | inside a component |
| `--space-md` | `12px` | control padding |
| `--space-lg` | `16px` | between components |
| `--space-xl` | `24px` | between sections |
| `--space-2xl` | `32px` | major section breaks |
| `--space-3xl` | `48px` | page-level separation |
| `--touch-min` | `44px` | the touch floor, honored on web as well as mobile |
| `--touch-button` | `46px` | standard button height |

---

## 10. Elevation & Focus

- **Elevation is a lighter surface, never a shadow.** Higher surfaces use higher ladder steps (§2); drop shadows are banned. Shadows on warm dark charcoal read as smudges; luminance difference is what the eye actually uses.
- **Focus ring:** a 3px spread of the accent ring color (`--ring`, accent step 8) at ~25% opacity, with the control border switching to the accent solid. One recipe everywhere — inputs, buttons, and focus-visible keyboard navigation.

---

## 11. Motion

Panel 4h defines no motion tokens, so **no Signet motion values are locked yet (TODO-DESIGN)**. What that does and does not put in question:

- **Settled — the discipline.** The three-class taxonomy (micro-feedback, standard transition, context shift), the budget each class is held to, and the requirements that motion stay subtle, functional, and reduced-motion-compatible bind every surface today. They are owned by [`README.md`](README.md) §7 and are not restated here.
- **Provisional — the numbers only.** The durations and easing curves in use are carried forward from the legacy `@repo/theme` system (`packages/theme/src/tokens.ts`, `motion.duration` / `motion.easing`) and are listed in README §7. Implementations SHOULD keep using them so motion stays consistent across the app, but they are placeholders, not Signet canon: a Signet motion spec MAY replace every value without changing any rule above.

---

## 12. Scrollbars

A scroll region on a Signet surface draws its own scrollbar. The browser default is a light-mode artifact on this ladder: it renders as a pale gutter that reads as a seam between panes.

| Token | Value | Role |
|-------|-------|------|
| `--scrollbar-width` | `10px` | track width, and height for a horizontal bar |
| `--scrollbar-thumb` | `rgba(255,255,255,0.14)` | the thumb at rest |
| `--scrollbar-thumb-hover` | `rgba(255,255,255,0.24)` | the thumb under the pointer |
| `--scrollbar-track` | `transparent` | the track |

Three rules, each for a reason the token values alone do not carry:

- **The thumb is low-opacity white, not a ladder step.** Same rule as hairlines (§3): it tracks whatever surface it overlays, so one token works in the sidebar, on a card, and inside a sheet without a per-surface variant.
- **The track is transparent.** A scroll region that is not scrolling should gain no visible gutter. A filled track turns every scrollable pane into a bordered box.
- **Styling is opt-in per region, never global.** The web implementation is a `.signet-scroll` class (`packages/theme/src/signet.css`), not a rule on `*`. A blanket rule repaints scrollbars inside embedded and third-party content, where the surface underneath is not ours and a low-opacity thumb can land on white. Overlay scrollbars — macOS and every touch device — already render correctly and are left alone.
