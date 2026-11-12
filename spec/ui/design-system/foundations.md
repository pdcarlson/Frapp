# Design Foundations

> The Signet token foundation — fixed neutral and semantic colors, typography, radius, spacing, and elevation — transcribed from the written token spec (panel 4h) of the committed design reference, with the one recorded supersession (radius) called out below.

---

## 1. Sources & Scope

- **Visual truth:** [`reference/signet-design-system.dc.html`](reference/signet-design-system.dc.html). Panel 4h is the written token spec this file transcribes; panels 4a–4g render the same tokens. [`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) is the screen-level reference. Where the Canvas header and panel 4h disagree, **the Canvas header wins** — the only such case is radius (§8).
- **Scope:** these tokens govern **Signet surfaces** — the mobile app and the web dashboard (`apps/web` ships them via `packages/theme/src/signet.css` since the #920 shell cutover), plus the landing site. The landing's token cutover has **merged** ([#2366](https://github.com/pdcarlson/Frapp/issues/2366), a slice of [#2364](https://github.com/pdcarlson/Frapp/issues/2364)): `apps/landing` imports `packages/theme/src/signet.css` and the legacy bone/bronze/ink tokens are off every shipping surface. The composition followed in slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) and the polish in slice 3 ([#2368](https://github.com/pdcarlson/Frapp/issues/2368)), so that epic's build slices are all merged and what is left of it is owner decisions rather than work. The two systems MUST NOT mix on one surface, and there is no longer a surface on the other one.
- **Naming:** "Signet" is this design system's internal name; the product is Frapp. The binding rule is [`brand-identity.md` § 1](../brand-identity.md#1-identity).
- Brand identity (house gold, the mark, direction) is owned by [`brand-identity.md`](../brand-identity.md). Per-chapter accent generation is owned by [`accent-engine.md`](accent-engine.md). Component-level application of these tokens is owned by [`components.md`](components.md).

---

## 2. Surface Ladder (Neutrals)

Fixed for every chapter — only the accent varies per tenant.

| Token | Value | Role |
|-------|-------|------|
| `--background` | `#0A0A0A` | App background, base of the ladder |
| `--surface-1` | `#111111` | Raised surface — nav bars, input fills, other-party chat context |
| `--card` | `#171717` | Cards and list rows |
| `--popover` | `#1E1E1E` | Elevated surface — sheets, popovers, menus (the "elevated" step) |

Rationale: a pure neutral graphite ladder with no hue in any step, so nothing on a surface competes with the chapter's accent and every chapter's accent sits on it the same way. Each step is an even notch lighter than the one below it (OKLCH lightness 0.145 / 0.178 / 0.205 / 0.235), which is what carries elevation (§10). `--card-hover` (`#2C2C2C`, `--popover` lifted 6% toward white) and the skeleton highlight (`#2B2B2B`) sit above the ladder and are neutral for the same reason.

**The ladder went dark and neutral on 2026-11-05, at the owner's request.** The owner found the warm yellowish surfaces did not fit the darker, simpler look the app had moved to. The old ladder was `#131211` / `#1A1A1A` / `#211E1A` / `#2A2621`, and it was uneven twice over: the base and `--surface-1` were neutral while `--card` and `--popover` leaned brown, and `--card` sat barely above `--surface-1`. The owner picked the neutral option over a faintly blue "ink" ladder at the same lightness. Before and after: <https://claude.ai/artifact/7hhDN6nptq1B5EmzGWDdUV>. What moved with it:

- **Text contrast only rose.** Body text on `--popover` went from 12.5:1 to 14.0:1, and `--muted` on `--popover` from 3.1:1 to 3.5:1.
- **The accent engine's ladder and generator background moved too**, so its version went to 2 and stored palettes are recomputed ([`accent-engine.md`](accent-engine.md) §4). The house seed paints the same fill; `accent-subtle` moved one 8-bit step (`#282314` to `#272213`). Some dark directory seeds lift differently on the darker surfaces: `#003087` no longer needs a lift, and `#1F4E79` and `#800000` now get one.
- **`--surface-1` is no longer the mark's field.** The mark keeps `#1A1A1A` ([`../brand-identity.md`](../brand-identity.md) §2), so the 404 and error pages, which draw the opaque crest raster, moved from `--surface-1` to `--card` (`#171717`, 1.03:1 off the field) to keep the tile edge from showing.

**Before that, the ladder was re-pitched for the web greenfield** ([#2143](https://github.com/pdcarlson/Frapp/issues/2143)). The history below is kept as it was written.

It previously ran `#0E0D0B` / `#171512` / `#1E1B17` / `#26221C`. Two things moved with it, and both are deliberate:

- `--surface-1` is now `#1A1A1A`, stated at the time as the **mark's own field** ([`../brand-identity.md`](../brand-identity.md) §2), so locked emblem B would sit flush on the raised surface instead of on a warmer neighbour. **That rationale did not survive measurement at the time:** the committed mark's field measured `#151515` and its gold `#DDA220`, so `#1A1A1A` was close to but not the mark's field, and the emblem did not sit flush. [#2153](https://github.com/pdcarlson/Frapp/issues/2153) closed the gap by re-exporting the mark at the spec'd pair rather than by moving this rung, so the rationale now holds and the value never changed — see [`../web-dashboard/tokens.md`](../web-dashboard/tokens.md) L-08 for the measurements and the history.
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
| `--foreground` | `#F5F5F5` | Primary text |
| `--muted-foreground` | `#C4C4C4` | Secondary text |
| `--muted` | `#9E9E9E` | Muted text — placeholders, timestamps, metadata |
| `--disabled` | `#6B6B6B` | Disabled text |

Token names follow panel 4h (ShadCN-style); panel 4a labels the same values text / secondary / muted. All four are neutral, matching the surface ladder: cream text on the graphite ladder reads yellow. Until 2026-11-05 they were warm-tinted (`#EDEAE3` / `#A9A399` / `#78716A` / `#57534C`) to match the warm ladder (§2).

**Every text tone clears its floor on every surface** (2026-11-09, at the owner's request, [#3826](https://github.com/pdcarlson/Frapp/issues/3826): "it looks very dim… you have to squint… it's not even white, the letters", and worse on an external monitor than on a laptop). `--foreground` and `--muted-foreground` clear 7:1 and `--muted` clears 4.5:1 against all four ladder steps, as the table shows. Until then the ladder was `#EBEBEB` / `#A3A3A3` / `#737373` / `#525252`. `--muted-foreground`, the secondary tone on about 540 web call sites (event lines, nav labels, section eyebrows), measured 6.6–7.9:1, and `--muted` (about 30 sites: timestamps, placeholders) 3.5–4.2:1, under the 4.5:1 gate ([`README.md`](README.md) §6) on every step. Lifting those two is most of the fix for "the dashboard looks dim"; the surface ladder's own imperceptible steps are the rest, tracked in [#2399](https://github.com/pdcarlson/Frapp/issues/2399). `--disabled` is deliberately under AA (WCAG exempts disabled controls) and stays a clear step under `--muted`.

| Text tone, on: | Background | Surface 1 | Card | Popover |
| --- | --- | --- | --- | --- |
| Foreground | 18.16 | 17.32 | 16.44 | 15.29 |
| Muted foreground | 11.35 | 10.83 | 10.28 | 9.56 |
| Muted | 7.39 | 7.05 | 6.69 | 6.22 |
| Disabled | 3.72 | 3.54 | 3.36 | 3.13 |

Was, for comparison: foreground 16.61 / 15.84 / 15.04 / 13.98; muted foreground 7.85 / 7.49 / 7.11 / 6.61; muted 4.18 / 3.98 / 3.78 / 3.52; disabled 2.53 / 2.42 / 2.29 / 2.13.

---

## 5. Semantic Colors

Status-only, never decorative. A semantic hue states a fact ("paid", "overdue"); it never tints chrome, headings, or illustration.

*Changed in #3921 by Shawn (via `pdcarlson`), 2026-11-11; pending Paul:* an **Important** chat message tints its whole row with `--destructive-tint` and a `--destructive` bar ([components.md § A flagged row](components.md#a-flagged-row)). It is read as a status the message carries ("needs attention", the way Microsoft Teams marks Important in red), not decoration, but it is the one place a semantic hue fills a whole row.

| Token | Value | Use |
|-------|-------|-----|
| `--success` | `#3fb950` | Paid, confirmed, checked-in, inside-zone |
| `--warning` | `#e5a000` | Pending, at-risk, degraded |
| `--destructive` | `#f85149` | Errors, overdue, destructive actions |
| `--info` | `#2f81f7` | Informational status only — never a brand or accent color |
| Mention/DM red | `#E5484D` | "You were addressed" — mention badges and DM indicators |
| `--mention-chip` | `#2D2617` | Fill of the `@Name` chip *inside* a message body — recipe in [components.md](components.md) § In-body mention chip |
| `--mention-chip-text` | `#EED7A8` | The handle drawn on that fill |
| `--success-tint` | `rgba(63, 185, 80, 0.13)` | The success tint fill: `--success` at 13% alpha (below) |
| `--warning-tint` | `rgba(229, 160, 0, 0.13)` | The warning tint fill, same recipe |
| `--destructive-tint` | `rgba(248, 81, 73, 0.13)` | The danger tint fill, same recipe. Its text is `--destructive-text` |
| `--destructive-tint-hover` | `rgba(248, 81, 73, 0.2)` | A danger tint's hover (the destructive button): `--destructive` at 20% |

- **Mention/DM red is fixed and semantic.** `#E5484D` states exactly one fact — *you were addressed*: an @-mention or a direct message. It MUST NOT be replaced by the chapter accent under any seed, and MUST NOT stand in for any other status, so "you were addressed" reads identically in every chapter. Its foreground is white. (This row is not in panel 4h; it is locked by the Canvas header and screens.)
  - *Changed in #4346 (asked by Shawn, built by the `pdcarlson` session), 2026-11-12; pending Paul's review.* The notifications list marks a notice that mentions you with an **@ badge on the sender's picture in the mention chip's fixed gold** (`--mention-chip-text` fill, `--mention-chip` ink), not this red: Shawn asked for mentions there to be "gold in the same way" chat paints an `@Name`. It is a kind marker beside a person, not a count, and like this red it is fixed, never the chapter accent, so it reads alike in every chapter. The count badge stays red.
  - **White on this red measures 3.91:1**, under the 4.5:1 text floor [README.md](README.md) §6 sets, and it is the one drawn tone [components.md](components.md) §1's lift cannot rescue — the text is already white, and the fill is the fixed semantic. Both shipping surfaces render it as drawn; the miss is real, is pinned to its measured value by `apps/web/components/chat/chat-contrast.spec.ts`, and needs a system-level decision (darken the fill for both platforms, or grant the badge an explicit exemption) rather than a per-surface patch — tracked in #1190.
- **Channel unread is neutral — never red, never accent, and carries no number.** Red is reserved for direct address, so an unread channel signals itself without it: the row itself emphasized, a bold (700) title in `--foreground` and a short `--foreground` pip on the row's leading edge, as Discord draws it. *(Pip and the grey read title, owner direction 2026-11-08 after a tester: "it needs to be clearer that you have unread messages", shipped 2026-11-11 in [#4147](https://github.com/pdcarlson/Frapp/issues/4147). This reverses the 2026-11-09 parity fix, [#3777](https://github.com/pdcarlson/Frapp/issues/3777), which made both surfaces draw read titles bright so unread differed by weight alone; both surfaces now draw read titles grey, so they still agree.)* *(Corrected 2026-11-07, owner direction after a tester asked "do I care how many messages got sent": a plain unread channel no longer draws a count badge, as on Discord. Only what addresses the member carries a number, a mention or a direct message, in the badge below; a folded section over plain unread draws its heading in `--foreground` bold instead. The app icon badge counts the same way, `spec/behavior/notifications.md` § Badge Count. It was a neutral count badge filled `rgba(255,255,255,.14)`, the `--input` value from §3, which ran up on every busy channel.)* A read row drops to a title in `--muted-foreground` over a `--muted` preview and carries no badge at all, only its timestamp. A muted channel's row drops to `--muted`, with no pip, unless it addresses the member ([`components.md`](components.md#sidebar-item) § Sidebar item, "Mobile channel rows", which web follows too). The mention/DM badge is the one count badge: fill `#E5484D`, white text, geometry owned by [`components.md`](components.md).
- On dark surfaces, semantic fills are tints, not solids: ~13% opacity of the hue as background with a lightened step of the same hue as text (see panels 4a/4d). Chip and badge recipes are specified in [`components.md`](components.md).
  - **The tint is a token, never an alpha utility** (decided 2026-09-25, #2376). `bg-success/[.13]` renders the recipe in a current browser, but Tailwind v4 compiles it to a `color-mix()` behind `@supports`, with the **solid hue** as the fallback. Below the `color-mix` floor (Chrome 111, Safari 16.2, Firefox 113) the fill therefore became the text's own colour, and every status label read 1.00:1: invisible. So the recipe lives in the four `--*-tint` tokens (table above), each the fixed hue as an `rgba()` at 13% alpha (20% for the danger hover). `rgba()` has no browser floor, so every engine paints the composite a current one painted for the utility, over whatever surface the fill sits on, and there is no fallback path left to degrade. The channels restate the hue, and `packages/theme/src/signet.css.spec.ts` holds them to it.
  - Three alternatives were weighed and rejected. **An opaque literal** (the recipe resolved over `--card`, as `--mention-chip` does) gives one contrast figure on every surface, but one fill can't stay distinct from every ladder step: the danger tint came out 1.06:1 against `--popover`, so a destructive button in a dialog lost its edge. `--mention-chip` can be a literal because it always sits in a message body; a status tint sits anywhere. **A `color-mix()` token** (`color-mix(in oklab, var(--destructive) 13%, transparent)`) avoids restating the hue, but below the floor it degrades to no fill at all, which leaves the borderless tints (the destructive button, the error icon tile) with no shape. **Keeping the alpha utility and documenting the band** would leave text invisible on a stated floor rather than degrading it.
  - **A tint over something other than a ladder step takes an opaque base.** The tint is 87% see-through, so it is only as legible as what is under it. The destructive toast floats over page content, so it paints `--popover` as its background colour and the tint over it as a one-colour gradient image. Anything inside it that paints its own tint hover repaints that base too, rather than stacking 20% on the toast's 13%, which measures 3.94:1 over `--popover`.
  - **Danger text on the danger tint is always `--destructive-text`.** Solid `--destructive` measures 3.82–4.85:1 on its tint across the ladder. `apps/web`'s `status-tint-call-sites.spec.ts` fails on a `bg-<semantic>/<alpha>` fill anywhere in the Next surfaces and on unlifted danger text over the tint, and `status-tint-contrast.spec.ts` measures every shipped pair on every step, reading the alpha from the tokens. The tokens are CSS-only: `signetDarkTokens` is what `apps/mobile` reads, and React Native has no `color-mix` fallback to avoid.
- **A lifted text tone is not a second semantic.** [`components.md`](components.md) §5 lets an implementation raise the *text* tone of a semantic for AA while the hue stays fixed; the solid token remains the fill and the border. The greenfield ladder (§2) made two of these load-bearing, because solid `--destructive` and solid `--info` fell under 4.5:1 on the surfaces their badges sat on. On the neutral ladder (2026-11-05) the plain-surface miss is down to solid `--info` on `--popover`, but both lifts stay: the danger tint still needs its lift (below), and one rule for "hue as text" is simpler than a per-surface one. Measured on the neutral ladder, greenfield figures in brackets:

  | Text token | Value | Lifts | Measured on `--card` / `--popover` |
  |---|---|---|---|
  | `--destructive-text` | `#FF7B72` | `--destructive` (5.35 / 4.97 solid; was 4.95 / 4.48) | 7.11 / 6.61 (was 6.58 / 5.96) |
  | `--info-text` | `#4C93F8` | `--info` (4.78 / 4.45 solid; was 4.43 / 4.01) | 5.84 / 5.43 (was 5.40 / 4.89) |

  Neither is a new semantic. `--info-text` is CSS-only (`packages/theme/src/signet.css`). `--destructive-text` is also `signetDarkTokens.color.semantic.destructiveText`, so mobile's `StatusChip` can draw danger text on its tint at the same lift (added 2026-11-05). Use the lifted token wherever the hue is **text**, and the solid wherever it is a fill or a border.

  **On the tint recipe both lifts now clear on every step.** On the §5 *tint* recipe (13% of the hue as fill, the hue as text) the neutral ladder measures `--destructive-text` at 5.67–6.96:1 and `--info-text` at 4.66–5.74:1 across the four steps, so both clear, with `--info-text` on a `--popover`-seated tint the thinnest margin (4.66). On the greenfield ladder `--info-text` failed there (4.08) and an info badge in a dialog needed a further lift; that is no longer true (2026-11-05). Solid `--destructive` on its own tint still misses on `--popover` (4.26), which is why danger text on a tint is always the lift.
- **Mention red did not get a lifted tone, and the reason matters.** On the neutral ladder `#E5484D` measures 5.06 / 4.82 / 4.58 / 4.26:1 from `--background` to `--popover`, so it is under the text floor on `--popover` only (on the greenfield ladder it missed on every step except `--background`). It is exempt from the lift above because it is not drawn as text: it is a badge fill carrying white text (the separate, tracked 3.91:1 miss above) and an avatar dot, and a dot is non-text UI held to §6's 3:1 floor, which it clears on every step. A future surface that renders mention red **as text** needs a lifted tone first; it does not have one today — which is why the in-body mention chip takes its own amber pair rather than this red.
- **The in-body mention chip is a second fixed family, not a lift of the red.** `--mention-chip` / `--mention-chip-text` are their own hue rather than a lifted `#E5484D`, so they sit in the table above rather than in the lift table below, and they are locked out of the accent engine exactly as the red and the gold family are (`packages/theme/src/signet.css.spec.ts`'s `FIXED` list). Both ship in `signetDarkTokens` as `semantic.mentionChip` / `semantic.mentionChipText` since mobile started drawing the chip (2026-11-06); until then they were CSS-only, since no mobile screen drew an in-body mention. The pair's fill is **opaque** where this section's tint recipe would use 13% alpha, so one contrast figure covers the row at rest and hovered (it was first argued from the per-chapter `--primary` self bubble, which the compact chat layout removed on 2026-09-29); the geometry, the reasoning and the guards are owned by [components.md](components.md) § In-body mention chip.

---

## 6. Accent Slot (Per Tenant)

The tokens above are fixed; the accent family — `--primary`, `--primary-hover`, `--primary-foreground`, `--ring`, `--accent-subtle`, `--accent-border`, `--accent-text` — is resolved per chapter from a single seed hex by the accent engine. Components read these roles, never the seed hex. Pipeline, scale-step mapping, caching, and the default house-gold seed are owned by [`accent-engine.md`](accent-engine.md).

### Where the accent goes (2026-11-05)

The accent is a signal, so it goes only where a member has to act or notice. The owner's call, after an audit found it on names, labels, icons, hovers, numbers and spinners on both apps, where it made the gold the loudest thing on every screen and the one action that mattered no louder than the rest. The rule is the same on web and mobile.

**The accent marks only:**

1. **The one primary action** of a screen, sheet or card: Primary's fill, and Tinted for an empty state's call to action ([`components.md`](components.md) §3).
2. **A control the member has switched on:** a checked checkbox, a switch that is on, a selected radio or option card, an active filter, a permission they can toggle that is granted, their own reaction, the poll option they voted for.
3. **Focus**, through `--ring` and the focus recipe (§10).
4. **A link in running text**, through Button's `link` variant or an inline anchor.
5. **The chapter's own mark:** its letters, crest or chosen color where the chapter is the subject (the accent picker, the chapter card).
6. **Where the member is:** the active row of a navigation list (the sidebar, the channel list, the Settings rail, the mobile tab bar) and the open item of a list-and-detail page (the folder you are in, the role you are editing). Only the active one; its neighbours' hover is neutral.
7. **A message that addresses the member:** a chat row whose server-resolved mentions include them wears the accent-subtle fill with a 2px accent bar ([`components.md`](components.md) §11, "A row that mentions you"). *(Added 2026-11-06, owner direction "do what discord does".)* It is the one row tint in chat, and it marks being addressed, not unread: the channel list's badges stay §5's red.

**Everything else is neutral**, from the text ladder (§4) and the surface ladder (§2):

- Names (your own included), labels, eyebrows, card kind labels and metadata: `--foreground`, `--muted-foreground` or `--muted`.
- Icons that label a row, a card or a field, and icon-only controls: `--muted-foreground` (`--muted` for a glyph that sits beside its own text label, as on mobile's More hub and Up next strip), `--foreground` on hover.
- Hover, pressed and keyboard-highlight fills, in menus, tables, lists and rails alike: `--card-hover`, never an accent tint. It is the one step above the whole surface ladder, so it reads on `--popover` (1.194:1) where the ladder's own ~1.1:1 steps do not ([`components.md`](components.md) §2).
- Numbers and stats (points, hours, counts, timers): `--foreground`.
- Spinners: a neutral text step, `--muted` on mobile as every mobile spinner already is.
- Done states (a completed task, a past event): a muted fill or check, never the accent; finished work is the quietest thing on a list.
- Selection that is not a control the member switched on: a selected table or list row takes `--popover` with `--foreground` text, a step under the `--card-hover` hover so a control inside it still lifts, and its checked checkbox carries the selection; the "N selected" bar above it is `--popover` with `--foreground` text.
- People's avatars, borders, dividers and decorative frames.

Unread and mentions keep their own rule above (§5): neutral for unread, red for direct address.

### A signature moment's accent (2026-11-06)

A signature moment ([`README.md`](README.md) §7 § Signature moments) may carry the accent for its length: a band of `--accent-subtle` passing once behind the content it celebrates, as the Discord import landing sweeps across its figures. It sits under the text, never over it, and leaves nothing behind, so at rest everything above holds: the numbers it passed are `--foreground`. Nothing else may use the accent in motion; a hover, a spinner or a loading state is still neutral.

**Kept on the owner's call (2026-11-06).** The `+N pts` reward chip ([`components.md`](components.md) §5) keeps the accent: a reward is something the member needs to notice. The active nav row and channel keep it too, under item 6 above.

**Still accent, waiting on the owner's call.** Four uses that other docs sanction predate this rule and were left as they are: the meter fill ([`components.md`](components.md) §12), the PRO chip ([`web-dashboard/README.md`](../web-dashboard/README.md)), the empty-state icon tile (§10 of `components.md`, which the empty-states redesign owns) and mobile's back arrow and inline text actions ([`navigation.md`](../mobile/navigation.md)). Each is either an item above or the next thing to take neutral; until the owner decides, they stay. Where the accent's own text step (`--accent-text`) is used, it is for items 1 to 6, never to make a label stand out.

---

## 7. Typography

**Family: Figtree** — weights **400 / 600 / 700 only**. (Panel 4b shows three candidates and panel 4h says "candidate pending pick"; the pick is locked: Figtree.)

Italic is a style, not a fourth weight, and it appears in chat only: markdown emphasis (`*italic*`, `***bold italic***`) and the italic placeholders, such as a deleted message's. Which font files carry it on each platform: [`packages/theme/README.md` § Fonts](../../../packages/theme/README.md#fonts).

| Style | Size / line | Weight |
|-------|-------------|--------|
| display | 32 | 700 |
| headline | 24 | 700 |
| title | 18 | 600 |
| body | 16 / 25 | 400 |
| label | 14 | 600 |
| caption | 12.5 | 400 |

Body text MUST NOT render below 16. Label and caption are for controls and metadata, never paragraphs — this is a consumer app read at arm's length, not a dense dashboard.

**Monospace is a separate role with its own family, not a Figtree weight.** Reserve it for numeric, status, and code-like strings where fixed-width character alignment matters — invite tokens, permission keys, user ids, points-table cells, and the Join-code row of the settings screen in the Canvas reference. Its family is the `--font-mono` system stack (`packages/theme/src/signet.css`, exposed as the Tailwind `mono` family by `packages/theme/src/tailwind.config.ts`); the family decision — a system stack, never a bundled webfont — is owned by [`../../architecture/README.md`](../../architecture/README.md) §15. Mono carries no size of its own: it takes the size of the role it sits in.

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

### Aligning a row (2026-11-06)

Paul's bar is that nothing in a row reads as sitting higher or lower than its neighbours. Which alignment gets there depends on what the row holds.

- **A row with an icon in it centers every item**: `items-center` on web, `alignItems: "center"` on mobile. That includes a row whose first item is a box that starts with an icon. An icon has no text baseline, so a baseline row reads the icon's bottom edge instead and drops the text after it. That was the web channel header on every private, role-gated and direct-message channel and the audit channel until 2026-11-06: the description sat about 4px below the name ([`channel-header-title.tsx`](../../../apps/web/components/chat/channel-header-title.tsx)).
- **A text-only row aligns baselines**, such as the chat author line (the name in `label`, then the time as a caption). Baseline is what makes two sizes of type read as one line.
- **Centering two type roles is only close to a shared baseline when their sizes are close.** Figtree's cap height sits in the middle of its line box, so a centered item's baseline lands 0.35 × its font size below the row's middle. Label beside caption is 0.5px apart, which is why the channel header can center them; title (18) beside caption is about 2px apart and display beside anything is worse. When an icon row also needs two roles that far apart, wrap the text in its own baseline row and center that row with the icon.
- **A control glyph is drawn, never typed.** A character such as `‹` sits on the font's x-height rather than the line's middle, so it lands low in a centered row and changes size with the type role. Use the platform's glyph (on mobile, `apps/mobile/components/control-glyphs.tsx`, [iconography.md](iconography.md) §6.1.5). Sites still typing one: [#3628](https://github.com/pdcarlson/Frapp/issues/3628).
- **A dot separator stays type.** The `•` between a name and its description is a character in the description's role, centered with it, not a drawn circle.

### Amendment: the three marketing type roles (landing only)

The six roles above are the **product** scale and bind every product surface. A storefront headline is not a product heading, and the largest locked role — `display`, 32 — is not a hero. So the landing surface carries three additional roles **above** the scale, added with the token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) and drawn on the reskin's System sheet ([`../landing/reference/canvas/System.dc.html`](../landing/reference/canvas/System.dc.html)).

| Role | Desktop | Phone | Used by |
| --- | --- | --- | --- |
| `--text-hero` | 72 / 74 · 700 · tracking `-0.02em` | 40 / 44 | The hero H1. On phone only, also the pricing figures — see the note below |
| `--text-display-lg` | 48 / 52 · 700 · tracking `-0.02em` | 32 / 37 (the locked `display` role) | Section H2s, and the pricing figures on desktop only |
| `--text-lead` | 20 / 30 · 400 | 18 / 27 | Hero and closing paragraphs, and nothing else |

**This does not widen the scale for anyone else, and the rule above is unchanged.** Three things keep it that way:

1. **They are named tokens, not literals.** The off-scale defect the paragraph above describes is a size invented *at a call site*. These are declared once, as roles, with an owner — which is precisely the remedy [`README.md`](README.md) §3 rule 4 prescribes for a missing role.
2. **They live on the surface that owns them**, in `apps/landing/app/globals.css`, bound as utilities by `apps/landing/tailwind.config.ts`. They are deliberately **not** in `packages/theme/src/signet.css`: that stylesheet is pinned to `signet.ts`, which is the token source `apps/mobile` reads, so a 72px marketing headline declared there would sit one import away from every product screen on two surfaces where the six roles are the whole scale.
3. **Using one outside `apps/landing` is a defect**, exactly as an off-scale literal is. A product surface that believes it needs a fourth size above `display` is asking for an amendment to the table above, not for a marketing role.

**The one place a role crosses over.** On phone a pricing figure takes `--text-hero` (40 / 44) rather than `--text-display-lg` (32 / 37) — capped at the H1's size, so a price never outweighs it, but not shrunk to the section-heading step either. That is the System sheet's rule ([`../landing/reference/canvas/System.dc.html`](../landing/reference/canvas/System.dc.html)) and it is the only sanctioned use of `--text-hero` outside the hero H1. Desktop is unaffected: there the figures are `--text-display-lg` and the H1 is already the larger role.

Type inside the landing's product frames is transcribed from the design-system and web framework boards and is deliberately **not** on either scale. Do not "correct" it.

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
`title`, `label` and `caption` are emitted as Tailwind `fontSize` keys in the shared preset
`packages/theme/src/tailwind.config.ts` (app-local until [#2371](https://github.com/pdcarlson/Frapp/issues/2371)), and each pairs its size and weight (both read from the custom
properties above) with a **literal** ratio — `1.15`, `1.2`, `1.3`, `1.3`, `1.35` — chosen when those
utilities landed rather than derived from anything here. So a screen written against this section and
a screen written against `text-title` can disagree, with nothing to arbitrate. Either promote the
five into this table as real tokens, or record here that the non-body roles take a ratio owned at the
utility layer. Tracked as L-09 in [`../web-dashboard/tokens.md`](../web-dashboard/tokens.md).

---

## 8. Radius

Canonical map (locked; supersedes panel 4h — see deviation note):

| Surface | Radius |
|---------|--------|
| Controls, inputs, buttons | 12 |
| Cards | 14 standard · 16 large |
| Sheets + AI answer card | 20 |
| Badges / chips | 8–10 |
| Sidebar / nav item | 10 |
| Avatars | 50% (circle) |

- Radii MUST come from this map. Inventing an off-map radius in screen code is a defect, exactly as a raw hex value is.
- **No pill shapes** (`border-radius: 999px` on rectangles) except toggle tracks and **proportion meters** — a meter's track and its fill are both full-round. The reference draws them that way ([`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) s10 and s22 both render an 8px track and its fill at `999px`), and references beat docs on visuals, so the exception is recorded here rather than left as a standing conflict. The recipe is [`apps/web/components/shared/meter.ts`](../../../apps/web/components/shared/meter.ts).
- The graduated map is intentional: small elements take small radii, elevated surfaces take the largest, so roundness itself signals what kind of surface you are on. Sheets and the AI card share the 20 ceiling because both are "special" surfaces.
- *(Corrected 2026-09-29: the map had a "Chat bubbles: 18, tail corner 6" row, the radius the §11 chat bubble took. The owner replaced the bubble with a compact, bubble-free chat layout ([#2873](https://github.com/pdcarlson/Frapp/issues/2873), [components.md](components.md) §11), so the row and its `radius.bubble` / `radius.bubbleTail` tokens were deleted with it.)*

> **Deviation note — panel 4h predates the radius lock.** 4h reads `control/card: 14 · card-lg: 16 · bubble/AI/sheet: 20 · badge/chip: 8`, and panel 4e renders bubbles at r20. The Canvas header ([`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html)) locks the map above — controls 12, bubbles 18 (tail 6), a value retired with the bubble on 2026-09-29 — and wins. This is the only place the reference HTML is not truth for tokens. (Panel 4g's 5-tab bar is the equivalent stale artifact for navigation; see the mobile spec.)

---

## 9. Spacing & Touch Targets

- **4px grid.** Steps: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Dominant rhythm is **8 / 16 / 24**: 8 inside a component, 16 between components, 24 between sections.
- Touch targets MUST be ≥ 44px. Buttons run 44–48px tall. Tab bar items are 50px tall, inside the 62px floating bar (§15).

### Control size scale

*(Added 2026-11-05, owner direction: the old system was "flawed" and "all the bubbles just feel way too big".)* Every control, row and chip takes a step from this table, and new work never invents a height off it. It is the rule the sizing, icon-button, chrome and dialog passes all build on, so a component spec names its step rather than restating a number. The shipped surfaces still off the scale are listed in [#3511](https://github.com/pdcarlson/Frapp/issues/3511) until they move.

| Step | Mouse (web, fine pointer) | Touch (web coarse pointer, and mobile) | Takes it |
|------|------|------|------|
| Chip | 24 | 24 drawn, 44 hit area through padding or `hitSlop` | badges, status chips, counts. Mobile's filter chips draw 32 |
| Row | 32 | 44 | menu, select and command rows; a checkbox row inside a form |
| Small | 36 | 44 | toolbar controls, Inline (`sm`) and icon buttons, tabs, a table header, a dense list row, a sheet's fields and footer buttons |
| Field | 40 | 44 | text fields, select triggers, Default buttons, the color picker |
| Primary | (web: Field) | 48 | mobile only: a full-width button that ends a sheet or a flow step (the sheet CTA, the dues Pay button, onboarding's buttons). A web full-width primary is a Default button, 44 on touch |

- **Mouse and touch are one rule, not two designs.** Web reads `pointer-coarse` for the touch column (Tailwind's `pointer-coarse:` variant), so a laptop gets the dense column and a phone or tablet browser the 44 floor. Mobile is touch-only and reads the touch column alone. The web sidebar (34) and app bar (34) are older pointer-only geometry and stay as [components.md](components.md) §7 draws them.
- **Labels stay 14, values stay 16.** Button, tab and table-header labels are 14px at every height. A menu or select row's label is 14px on a mouse and 16px on touch. A typed value is 16px at every height, because §7's body floor binds on text a member types.
- **Padding does not split by pointer.** Field padding-x is 12, a Default button's 16, a Small one's 12, on every pointer. Only heights split: on web a `pointer-coarse:` padding class survives a caller's plain `pl-9` or `px-0` (tailwind-merge merges only classes with the same variant), which put search glyphs on top of typed text.
- **Two lines grow a row, not the scale.** A row whose meta line wraps under its name takes the Row floor as a `min-height` and grows with its content.
- **The toggle has its own two sizes**: a 36×22 track with an 18px thumb on a mouse, and 50×30 with a 24px thumb on touch ([components.md](components.md) §4).

Tokens: `touch.minimum` (44) is every touch step's floor, `touch.button` (44) the touch Default, and `touch.buttonLarge` (48) the touch Primary.

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
| `--touch-button` | `44px` | standard button height on touch (46 until 2026-11-05) |

---

## 10. Elevation & Focus

- **Elevation is a lighter surface, never a shadow.** Higher surfaces use higher ladder steps (§2); drop shadows are banned. Shadows on warm dark charcoal read as smudges; luminance difference is what the eye actually uses.
- **Focus ring:** a 3px spread of the accent ring color (`--ring`, accent step 8) at ~25% opacity, with the control border switching to the accent text step (`--accent-text`, accent step 11). One recipe everywhere — inputs, buttons, and focus-visible keyboard navigation. [components.md](components.md) §2 owns the recipe, its measurements, and the offset variant for controls whose border encodes state.

---

## 11. Motion

Panel 4h defines no motion tokens, so **no Signet motion values are locked yet (TODO-DESIGN)**. What that does and does not put in question:

- **Settled — the discipline.** The three-class taxonomy (micro-feedback, standard transition, context shift), the budget each class is held to, and the requirements that motion stay subtle, functional, and reduced-motion-compatible bind every surface today. They are owned by [`README.md`](README.md) §7 and are not restated here. *Corrected 2026-11-06:* the taxonomy has four classes now, and "subtle, functional" binds every surface outside a signature moment; reduced-motion compatibility still binds all four.
- **Provisional — the numbers only.** The durations and easing curves in use are carried forward from the legacy `@repo/theme` system, now in `packages/theme/src/motion.ts` (`duration` / `easing`) and are listed in README §7. Implementations SHOULD keep using them so motion stays consistent across the app, but they are placeholders, not Signet canon: a Signet motion spec MAY replace every value without changing any rule above.
- **A fourth class, added 2026-11-06: signature.** The owner asked for a few deliberate, fun moments that set Frapp apart (#3493), so the taxonomy gained a `signature` class beside the three, with its own triggers, budget, reduced-motion rule and catalog, all owned by [`README.md`](README.md) §7 § Signature moments. Its numbers (`motion.duration.signature` = 520, `motion.easing.settle`, and the 1.8s whole-moment budget in `packages/theme/src/signature.ts`) are as provisional as the other three: chosen for the first moment, the Discord import landing, not Signet canon.

---

## 12. Scrollbars

A scroll region on a Signet surface draws its own scrollbar. The browser default is a light-mode artifact on this ladder: it renders as a pale gutter that reads as a seam between panes.

| Token | Value | Role |
|-------|-------|------|
| `--scrollbar-width` | `6px` | gutter width, and height for a horizontal bar |
| `--scrollbar-thumb` | `rgba(255,255,255,0.12)` | the thumb at rest |
| `--scrollbar-thumb-hover` | `rgba(255,255,255,0.22)` | the thumb under the pointer |
| `--scrollbar-track` | `rgba(0,0,0,0)` | the track, which paints nothing |

The thumb is inset 1px inside its gutter and rounded with `--radius-xs` (which clamps to a full round at this size), so the visible bar is 4px wide.

Three rules, each for a reason the token values alone do not carry:

- **The bar is neutral and never retints.** A scrollbar is quiet chrome, not an accent role and not brand. The chapter accent engine must not reach it, and it carries no hue of its own. The thumb is a low-alpha white, the same idea as the hairline family (§3), so it reads as a slightly lighter step of whatever surface it sits on.
- **The track is clear, and the bar is never hidden.** A scroll region always shows where it is, but the bar does not draw a strip of its own between panes.
- **Styling is global, not opt-in per region.** The web implementation is a rule on `*` (`packages/theme/src/signet.css`), not a class. The previous `.signet-scroll` opt-in was retired by the greenfield shell lane ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)); it had zero call sites. A low-alpha thumb on a clear track would vanish on a light surface, which is acceptable only because every Signet surface is dark; a light surface that scrolls would need its own track.

**Why the gold bar was retired (2026-11-05).** From lane 2 until this date the bar was the framework board's option `3a`: an 8px mark-gold thumb (`#DDB844`, hover `#F0CD5E`) on an opaque `#1A1A1A` track, held at gold by the brand lock and drawn as a persistent part of how the surface reads. In use it was the loudest element on the chat screen: two tall gold bars beside the channel list and the timeline pulled the eye away from the content. The owner asked for it to blend in, so the bar went back to a neutral thumb on a clear track, close to the pre-board `.signet-scroll` values (`rgba(255,255,255,0.14)` on `transparent`, 10px) but thinner.

**Contrast exception.** The gold measured 9.13:1 on its track. The neutral thumb composites to about 1.4:1 on the ladder at rest and about 2:1 under the pointer, under the 3:1 non-text floor in [README §6](README.md#6-accessibility-baseline-release-gate). That is a recorded exception, the owner's call on 2026-11-05, and it holds only for the scrollbar: the bar repeats information the content already shows (where you are in a region moves with the content itself), and wheel, trackpad, touch and keyboard scrolling do not depend on finding it. No other control may cite it. The thumb stays visible (alpha above 0) and quiet (alpha at most 0.3, gutter at most 8px); `signet.css.spec.ts` pins both bounds.

**Engine split, and why the board's own CSS is not copied verbatim.** The standard properties (`scrollbar-width` / `scrollbar-color`) and the WebKit pseudo-elements are mutually exclusive: since Chromium 121, a non-`auto` value for either standard property makes that element's `::-webkit-scrollbar-*` rules ignored outright. The board declares both together, which in Chrome and Edge silently discards the width, the rounding and the thumb inset. So the standard properties are scoped to `@supports not selector(::-webkit-scrollbar)` (true only in Firefox) and every other engine gets the pseudo-elements. Firefox has no width finer than `thin`, so only the two colors reach it.

---

## 13. Text selection

A Signet surface paints its own `::selection`. Before the web greenfield's lane 7
([#2147](https://github.com/pdcarlson/Frapp/issues/2147)) nothing specified it, so dragging across
any text produced the user agent's default highlight, which on this ladder is a system blue that
belongs to neither the neutral scale nor the chapter.

| Property | Value | Role |
|----------|-------|------|
| `background-color` | `var(--foreground)` | the highlight behind selected text |
| `color` | `var(--background)` | selected text itself |

**It is neutral, and the accent is the wrong answer here for a measured reason.** The obvious wiring
is `--primary` over `--primary-foreground`: it retints per chapter for free and it is the one pair
the accent engine measures ([accent-engine.md](accent-engine.md) §8). It is also invisible on the
surfaces the accent already paints. `apps/web/components/chat/renderers/text-renderer.tsx` drew the
viewer's own chat bubble `bg-primary text-primary-foreground` — the identical pair — so selecting
your own message to copy it would have changed nothing on screen; the same collision hits every
default `Button` label and the selected calendar day. *(Corrected 2026-09-29: the compact chat layout,
[#2873](https://github.com/pdcarlson/Frapp/issues/2873), removed the self bubble, so chat no longer
paints this pair. The Button and calendar collisions still do, so the decision stands.)* Stepping the accent does not rescue it: `--accent-text`
is accent-11 against the fill's accent-9, which on the house seed measures `#E7C86B` on `#DDB844`,
about 1.18:1 — under the 1.2 §10's fixture treats as imperceptible — while the text would move
between two near-blacks.

So selection takes the two ends of the neutral ladder, which are ~15:1 apart and which the accent
engine never writes. Against the gold accent fill the highlight still measures about 1.6:1, clearly
perceptible, and the text pair under it goes from near-black-on-gold to near-black-on-near-white.

**This is §12's rule again, for a different reason.** The scrollbar is chrome that looks like it
should carry the chapter and must not, because it is meant to blend in. Selection is
chrome that looks like it should carry the chapter and must not, because the chapter's own colour is
what it would have to be legible against.

**The framework board takes no position on this.** Option `3a`'s token sheet does not mention
selection, so this is an extension beyond what the board draws rather than a transcription of it;
[`../web-dashboard/tokens.md`](../web-dashboard/tokens.md) records that as the lane note.
`::-moz-selection` is deliberately not duplicated: Firefox has supported unprefixed `::selection`
since 62, and an invalid prefixed selector in the same rule list would drop the rule in every engine.

---

## 14. Native controls

A Signet web surface declares `color-scheme: dark` on `:root` (`packages/theme/src/signet.css`), so
the controls the browser draws itself render on the dark ladder: radios, the calendar and clock
glyphs in date and time fields, native `<select>` popups, file inputs, number spinners and
autofill. Until 2026-11-05 nothing declared it, and every one of them kept light-scheme chrome: a
white box per row on each list with a checkbox column (`/events`, `/points`, `/members`, `/billing`)
and a black calendar glyph that vanished into every date field. The checkbox, which the scheme alone
did not fix, is now drawn by hand (below).

It is `dark` alone, never `light dark`: Signet has one appearance (§1), so handing the choice back to
the operating system would draw light controls on a dark page for anyone whose OS is in light mode.
`signet.css.spec.ts` pins the single declaration.

The scheme gets a browser's dark control, not Signet's, so the web checkbox is drawn by hand: a
native input with `appearance: none`, painted as [components.md](components.md) § Checkbox by
`.signet-checkbox` in `apps/web/app/globals.css`. Chromium's dark checkbox is a solid grey square
with a light rim, which matches neither the spec's transparent fill nor its border, and border and
radius utilities do nothing to a control the browser paints itself (#3186, 2026-11-05).
`table-controls.spec.ts` pins the rule.

---

## 15. Glass

Owner pick 2026-11-05 ("Floating bar, no glow"). The recipe is `signetGlass` in `packages/theme/src/glass.ts`. Mobile reads it through `GlassSurface`; web's dialog and sheet scrims spell the scrim blur as a Tailwind class (`backdrop-blur-[6px]`), so a change to `scrimBlur` moves both.

**Glass is chrome only.** It is for what floats over content: the mobile tab bar and its quick-actions + and panel, back capsules, the floating create button, and the blur under a sheet or dialog scrim. Never a sheet, a card or an input. Those stay solid steps on the ladder (§2) so their text keeps the contrast measured against a known fill.

| Part | Value |
| ---- | ----- |
| Fill | `surface-1` at 56% over a blur, so colour shows through (`glassFill`). Where nothing blurs behind it, 92% |
| Blur | 26px backdrop blur |
| Edge | 1px (a hairline on mobile) of white at 10%, a step brighter than §3's 8% hairline so the shape reads over any content |
| Sheen | white at 7% at the top, gone by 46% of the height |
| Scrim | a 6px blur under the existing 55% black, on web's dialogs and sheets. Mobile's sheet scrim has none yet ([#3545](https://github.com/pdcarlson/Frapp/issues/3545)) |

The fill moves with the ladder because it is `surface-1`, never a hex of its own. Elevation stays luminance (§10): the edge and the sheen are light, and glass casts no shadow.

**How each device draws it** (`GlassSurface`, `apps/mobile/components/glass-surface.tsx`):

- **iOS 26:** the system's own Liquid Glass (`expo-glass-effect`), which brings its own refraction and press response, so nothing is layered on top.
- **iOS before 26, and web:** the blur (`expo-blur`; CSS `backdrop-filter` on web) under the 56% fill, the edge and the sheen.
- **Android:** the 92% fill with the edge and sheen, no blur, until each screen is wrapped in the blur target Android's blur needs ([#3545](https://github.com/pdcarlson/Frapp/issues/3545)).
- **Reduce Transparency on:** plain `surface-1` and §3's hairline, nothing see-through. Web reads `prefers-reduced-transparency`.

`glass-surface.spec.tsx` pins the modes and `glass.spec.ts` the recipe.

