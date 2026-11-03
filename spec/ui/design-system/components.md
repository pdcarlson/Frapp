# Components

> Concrete component specs — variants, sizes, radii, token roles, and interaction states — derived from the committed reference board ([signet-design-system.dc.html](reference/signet-design-system.dc.html), panels 4d, 4e, 4f, and the sheet in 4g) and the locked chat/Ask screens of [canvas-screens.dc.html](reference/canvas-screens.dc.html). Tokens, the radius map, and elevation rules live in [foundations.md](foundations.md); the per-chapter accent scale and its role mapping in [accent-engine.md](accent-engine.md).

---

## 1. Reading the reference

The reference board is the committed visual truth, with two locked corrections:

- **Radii.** Panels 4d/4h draw controls at radius 14 and panel 4e draws chat bubbles at radius 20 — drawings that predate the lock. Where a drawing and the canonical map differ, **the map wins**; the map and its deviation note are owned by [foundations.md](foundations.md) §8.
- **Type sizes and spacing, same rule.** The tables below quote sizes measured off the board — 15 and 14.5 for button labels (§3), 16.5 for card and state titles (§8, §10), a 22px tab gap and 11px tab padding (§6). The board draws seventeen distinct font sizes; [foundations.md](foundations.md) §7 locks six and says outright that an off-scale size is a defect, and §9 locks a 4px spacing grid. **The maps win here too**, exactly as they do for radius: an implementation rounds a drawn measurement onto the adjacent scale step (15 → the `label` role's 14, 16.5 → `body` 16 at the weight the drawing distinguishes by, 22 → 24, 11 → 12) rather than reproducing it. Only the weights and the relationships between sizes are transcribed literally.
- **Text tones that miss the contrast gate get lifted one step.** §5 already grants this for badge text on a tint ("implementations MAY lift the text tone for AA contrast, but the hue is the fixed semantic"), and the reference itself does it (`#4BC262`, `#4C93F8`). It generalises: where a *drawn* tone measures below the 4.5:1 text floor [README.md](README.md) §6 sets as a release gate, the implementation moves it one step up the [foundations.md](foundations.md) §4 text ladder — or, for a semantic, to a lifted tone of the same hue — and the surrounding relationships move with it. Measured cases the web implementation carries: `--muted` on the surface ladder is 3.3–4.0:1, so tab labels and input placeholders take `--muted-foreground` (the hover lift moves up to `--foreground` with them); `#f85149` on its own 13% tint is 4.22:1 over card and 3.82:1 over the elevated step, so danger text on a danger tint takes the lifted `#FF7B72`. Fills, borders and the hue itself are unchanged — only text moves.

The `--muted` case generalises further than "placeholders and tab labels": it measures **4.04:1 on `--background`** and lower on every step above it, so it does not clear the gate as text *anywhere* on the ladder. The chat slice therefore lifted every caption it owns — the author line's time, delivery state, rail section headings — to `--muted-foreground`. *(Corrected 2026-09-29: this used to say the sender's name and the time share one tone and differ by weight, as s05 draws. The compact layout ([#2873](https://github.com/pdcarlson/Frapp/issues/2873), §11) sets the name in `--foreground` at 600 and the time in `--muted-foreground`, two tones, so the name reads first on a row with no bubble to frame it.)* Treat `--muted` as a token for non-text roles until a Signet pass revisits the ladder.

**One pair cannot be lifted, and is a recorded exception rather than a defect.** Mention/DM white-on-`#E5484D` measures **3.91:1**. The text is already white, so §1's remedy is unavailable, and the fill is fixed and semantic — [foundations.md](foundations.md) §5 forbids replacing it, s04 draws it, and mobile ships it, so a web-only hue change would break the one guarantee the token exists for. It ships as drawn, is pinned to its measured value by `apps/web/components/chat/chat-contrast.spec.ts`, and is tracked for a system-level fix in #1190.
- **Tab bar.** Panel 4g's 5-tab bar (with a Home tab) is stale. Four tabs — Chat, Events, Tasks, More — are locked; see [navigation.md](../mobile/navigation.md). Panel 4g's *sheet* drawing remains authoritative and is specced in §9.

Colors below are given by **token role** (`accent-N` per [accent-engine.md](accent-engine.md)). The only literal hexes are the fixed neutral and semantic values, which never vary by tenant. The chat message row and the AI sourced-answer card (panel 4e) are the two signature surfaces; they are specced in §11. (Panel 4e and s05 draw chat as bubbles; the owner replaced those with a compact, bubble-free layout on 2026-09-29, recorded in §11, which overrides the drawings for chat.)

- **Transcribe the reference, never lift it.** The board is a *picture* of the design, not an implementation: read its source text — do not render it in a browser or screenshot it — and rebuild what it draws in the target stack. The `x-dc` wrapper and the `dv-*` viewer chrome (`dv-turn`, `dv-thd`, `dv-card`) are export scaffolding, and their geometry is board layout rather than component spec — the `dv-card` panels are pinned to 440px/940px on a `#131211` ground, and panel content is inline-hex styled throughout. Specs are transcribed by token role; the export's own markup and inline values MUST NOT be copied into product code.
- **The exports are not runnable.** Both files load `./support.js`, and `canvas-screens.dc.html` mounts each of its 23 screens through an `x-import` element sourced `from="./ios-frame.jsx"`; neither support file is committed to the repo. Opened in a browser the custom elements never upgrade, so the iOS device frames and panel 4e's accent-seed / bubble-radius controls do not render and the inline-styled screen markup paints unframed. The committed exports are authoritative as **source text**; a browser render is partial, so specs are transcribed from the markup and never from a rendered screenshot.

## 2. Shared rules

- **Touch targets MUST be ≥ 44px** on touch surfaces. Compact 34px controls (§7) are web/pointer-only.
- **No drop shadows.** Elevation is a lighter surface fill ([foundations.md](foundations.md)).
- **No pill shapes** except the toggle track (§4) and the proportion meter (§12). The "Ask pill" is a rounded rectangle, not a capsule.
- **Borders are neutral hairlines or tokens** — `rgba(255,255,255,.08)` structural, `rgba(255,255,255,.14)` on inputs, `accent-7` on accent-tinted chrome, low-opacity semantic on status surfaces (§10). Never a fixed grey hex.
- **Focus (keyboard/input):** border swaps to `accent-11` plus a 3px ring of `accent-8` at ~25% opacity. Applies to every focusable control.
  - **The border swap is the half that carries it.** `accent-8` at 25% composites to 1.18–1.31:1 against the step it sits on — 0 of the 19 seeds × 4 steps clear the 3:1 non-text floor [README.md](README.md) §6 sets — so the ring is the halo and the solid border is the signal. A control that drops the border swap has no focus indicator, whatever the ring looks like.
    - **The border is `accent-11`, not `accent-9` (owner decision 2026-09-18, shipped 2026-09-30, [#2398](https://github.com/pdcarlson/Frapp/issues/2398)).** `accent-11` against the step behind it is 6.81:1 at the worst of the 19 seeds × 4 steps. `accent-9`, which the framework board draws ("gold border"), was the token until then. It failed 3:1 on 9 of 19 seeds over `--popover` until the engine began holding it to the floor ([accent-engine.md](accent-engine.md) §8, [#2541](https://github.com/pdcarlson/Frapp/issues/2541)), and even then it had no headroom (3.78:1 at the worst). It also drew nothing on a primary button: the fill is `accent-9`, so a border swapped to `accent-9` was the fill's own colour.
    - **A filled control over a transparent border clips its fill to the padding box** (`bg-clip-padding`, on the primary button). By default the fill paints under the border, so focus would only move that 1px from `accent-9` to `accent-11`, 1.09–2.07:1 across the seeds. Clipped, the border shows the surface at rest and `accent-11` on focus. Pinned by `apps/web/components/ui/focus-contrast.spec.ts`, across all three bordered recipes (`FOCUS_RING`, `FOCUS_RING_ALWAYS`, `FOCUS_RING_WITHIN`).
    - **The swap needs a border to swap.** A control with no border class gets the 25% ring alone, which is no indicator. Reserve one (`border border-transparent`), as the button does. [#2965](https://github.com/pdcarlson/Frapp/issues/2965) tracks the controls that still don't, including the shell chrome's ring-only `FOCUS_RING_SHELL`.
  - **Where the border already means something, move the accent into an offset ring instead.** The toggle's border carries on/off (§4) and a tab's bottom border *is* the selected indicator (§6); repainting either on focus loses the state, or — worse, on tabs — draws the exact visual that means "selected" onto a merely-focused item. Those controls keep their border and take a 2px **`accent-11`** ring, at full opacity, offset from the control by a 2px band of `--background`.
  - **Both recipes draw their signal in `accent-11`, and they differ in which half carries it.** The bordered recipe dilutes its ring to 25% because the solid `accent-11` border is the signal. The offset recipe has no border to swap — that is why a control lands on it — so its ring is the *entire* indicator and must clear the 3:1 floor unaided. Measured against `--background` across all 19 seeded chapter accents:

    | Step | Worst seed | Clears 3:1 |
    | --- | --- | --- |
    | `accent-9` | 4.70:1 (`#800000`) | yes, but with none of `accent-11`'s headroom: the engine's floor guarantees 3:1 and no more, and the worst, `#800000`'s generated `#F42F22`, is a fill it leaves alone, at 3.78:1 on `--popover` |
    | `accent-8` | 2.98:1 (`#000000`) | no — fails on 3 (`#000000` / `#C0C0C0` / `#FFFFFF`, which all derive the same ring) |
    | `accent-11` | 8.48:1 (`#BF0A30`) | yes — all 19 |

    Before [#2541](https://github.com/pdcarlson/Frapp/issues/2541)'s fill floor, `accent-9` failed on 4 seeds (worst 1.87:1, `#8B0000`) and `accent-8` on 4 (`#4B0082` too). `accent-8` held this role until the greenfield ladder ([foundations.md](foundations.md) §2) lifted `--background` to `#131211`; its margin was 3.05:1 against a 3.0 floor and the lighter base consumed it. `accent-11` is the engine's text role, gated at 4.5:1 as text ([accent-engine.md](accent-engine.md) §8), so it has real headroom as non-text UI. Pinned by `apps/web/components/ui/focus-contrast.spec.ts`.
  - **The offset band fixes the surface the measurement assumes.** The ring's inner edge abuts a band of `--background`, which is what the table above measures against; its outer edge abuts whatever the control sits on. While the ring drew in `accent-8` this was load-bearing for conformance — that step fails 3:1 on every deeper rung (worst 2.77 on `--surface-1`, 2.64 on `--card`, 2.39 on `--popover`). On `accent-11` it no longer is: the ring clears 3:1 on every rung by itself (worst 7.89 / 7.52 / 6.81). Keep the offset anyway — it fixes one comparison surface instead of letting conformance vary by host, and keeps the ring off the control — but the margin is what makes the recipe robust, not a budget to spend.
> **The hexes in this document are transcriptions, not the source.** Every ladder and text value here is owned by [foundations.md](foundations.md) §§2–5; they appear inline because the component recipes were written that way. When a token value moves, this file has to move with it — the greenfield ladder ([#2143](https://github.com/pdcarlson/Frapp/issues/2143)) is the case in point. Prefer naming the token over pasting its value in anything new here.

- **Semantic colors are status-only** (success `#3fb950`, warning `#e5a000`, danger `#f85149`, info `#2f81f7`) — never decorative.
- **No component references the chapter hex.** Every accent role resolves through the generated scale ([accent-engine.md](accent-engine.md) §1; §8 says which roles are contrast-gated).
- Undrawn primitives (select, radio, dropdown menu, popover) MUST compose from the same tokens: elevated `#2A2621` fill, hairline border, radius 12, `accent-8` ring.
- **A hairline's alpha is not a free parameter.** `--border` is `rgba(255,255,255,.08)` and a diluted `border-border/70` composites to 1.169:1 on `--card` against the token's 1.253:1. Neither clears §6's 3:1 non-text floor and at this ladder neither can, which is exactly why the remaining margin is not available to spend: once elevation is ~1.12:1 the hairline is the only edge there is. Five Chapter Ops row lists had invented that value; [README.md](README.md) §3 rule 4 already bans one-offing a token value at the call site, and this is what it costs.
- **The chat thread is `--background`, and a card in it is `--card`.** The web dashboard's chat panes are `--background` for the thread and `--surface-1` for the rails, and a hovered message row fills `--surface-1` (§11). A card posted into the thread (poll, task, event) is `--card` with a hairline, and there **the hairline is load-bearing**: one ladder step is ~1.12:1 and the composited hairline reaches ~1.4:1, both under the 3:1 non-text floor, so a card that drops its border is delineated by 1.12:1 and effectively has no edge. *(Corrected 2026-09-29: this rule was written for the incoming chat bubble, which painted `--card` with a hairline, so wrapping the thread in a card made the bubble `#211E1A` on `#211E1A`. The compact layout ([#2873](https://github.com/pdcarlson/Frapp/issues/2873)) removed the bubble; the reasoning carries over to the cards.)*
- **A highlighted row inside one of those primitives takes the accent tint, never a surface step.** The elevated fill above is the *top* of the surface ladder ([foundations.md](foundations.md) §2), so there is no ladder step above it to highlight with. The ShadCN scaffold's `--accent` held that same `#2A2621`, so a menu that highlighted with it painted the hovered row in its own background. It and `--secondary` (an alias of `--card`) are deleted ([#3036](https://github.com/pdcarlson/Frapp/issues/3036)), along with their `-foreground` pairs and the Tailwind `secondary` and `accent` colour keys. [`apps/web/components/shared/elevation-call-sites.spec.ts`](../../../apps/web/components/shared/elevation-call-sites.spec.ts) still bans both names across the two Next apps, because with the variables gone `hover:bg-accent` compiles to nothing, which is the silent no-colour failure of [#1145](https://github.com/pdcarlson/Frapp/issues/1145). It scans each spelling its fixtures list (utilities, `var()` reads, Tailwind shorthands, config keys, `theme()`). A rest fill names its ladder step instead, and a hover takes a state above it. What the bullet below calls the *neutral highlight* is that step-up, `--popover` on `--card`. `--card-hover` sits above the ladder, but it's a card-filled control's hover (§3), and a menu row needs the hue below to carry selection. Selection and hover inside menus, command palettes, selects and table rows therefore use the §5 accent-tint recipe (`accent-3` fill, `accent-11` text), which separates by hue: the ladder's own steps are ~1.1:1 apart and cannot carry "this one" on luminance alone.
  - **The tint separates by hue, and only by hue — do not read it as a contrast remedy.** Measured across the seeded chapter directory, `accent-3` sits **1.008–1.107:1** from `--card`, which barely reaches the neutral highlight's 1.105:1 and never beats it by a visible margin. **17 of the 19 seeds land at or below neutral** (the four reds worst, at 1.008–1.027), and the best reaches only 1.107, so luminance separation is not something the tint can be relied on to provide. What it does buy is chroma: 6–66 points of channel spread from the surface, against the neutral step's 2, holding even for the achromatic seeds. So a surface that needs to distinguish *two* row states cannot get the second one from the tint alone. A table row does: hover takes `accent-3`, and **selection takes `accent-4` plus `accent-11` text** — the one-step lift §3's state table already uses for tinted controls (1.155–1.316:1 on `--card`, and 1.110–1.191:1 above the hover fill, for every seed), with the text tone at 6.170–8.383:1 doing the work the fill cannot. None of these fills clears the 3:1 non-text floor and at this ladder none can, so a state that carries *information* rather than pointer feedback must be redundant with something that is not a fill — the row's own checkbox, a text tone, a summary bar. Measured in [`apps/web/components/shared/table-contrast.spec.ts`](../../../apps/web/components/shared/table-contrast.spec.ts). *(Figures re-measured 2026-10-01 at the greenfield ladder and the current engine; they were 1.032–1.143, 13 of 19, 1.085 neutral, 7–86 spread, 1.178–1.358, 1.108–1.193 and 6.33–8.68. The argument is unchanged and stronger. [#3043](https://github.com/pdcarlson/Frapp/issues/3043) carries the same correction into `ui/table.tsx` and `table-contrast.spec.ts`.)*

## 3. Buttons

### Variants

| Variant | Fill | Border | Text | Weight |
| ------- | ---- | ------ | ---- | ------ |
| Primary | `accent-9` | none | `accent-contrast` | 700 |
| Secondary | card `#211E1A` | 1px `rgba(255,255,255,.14)` | `#EDEAE3` | 600 |
| Tinted | `accent-3` | 1px `accent-7` | `accent-11` | 700 |
| Ghost | transparent | none | `accent-11` | 600 |
| Destructive | `--destructive-tint` (danger @ 13%) | none | `#f85149` | 700 |

Tinted is the accent-soft variant: empty-state CTAs (§10). The Ask entry (§7) borrows its *geometry* only — it is painted in the pinned house-gold tints, never the chapter accent (§11). Destructive is tint-style, never a solid red fill.

### States

| Variant | Hover | Pressed | Disabled (all variants) |
| ------- | ----- | ------- | ----------------------- |
| Primary | fill `accent-10` | fill `accent-10` + 8% black overlay | fill card `#211E1A`, border `rgba(255,255,255,.08)`, text `#57534C` |
| Secondary | fill `--card-hover` (`#37332E`) | as hover | 〃 |
| Tinted / Ghost | fill `accent-3` (ghost gains it; tinted lifts one step to `accent-4`) | as hover | 〃 |
| Destructive | `--destructive-tint-hover` (danger @ 20%) | as hover | 〃 |

- **Secondary's hover sits above the ladder, not on it** (corrected 2026-10-01, [#1220](https://github.com/pdcarlson/Frapp/issues/1220)). It was the elevated step, which is `--popover`, so a Secondary button inside a dialog or sheet hovered to its container's own colour: 1.000:1, no feedback at all. `--card-hover` is `--popover` lifted 6% toward white. Being above every step, it reads as a state wherever the button sits: 1.199:1 on `--popover`, 1.324:1 on `--card` (the rest fill), 1.493:1 on `--background`. It's an opaque literal, so it has no `color-mix` floor. It's neutral, so it holds on the error surfaces §10 bars the chapter accent from. It's a hover, never a resting surface. Any card-filled control takes it (the web notification drawer's read rows do). A row that is transparent over a menu or table still takes §2's tint. Measured in [`apps/web/components/shared/elevation-contrast.spec.ts`](../../../apps/web/components/shared/elevation-contrast.spec.ts), which also derives the value from `--popover`.
- **Loading:** the button disables, keeps its width, and shows a spinner in place of (or before) the label. Double-submit locking per [resilience](../resilience/README.md).
- Hover states are pointer-only; mobile uses pressed feedback.
- **Primary's pressed fill is momentary, never a state.** In every palette written since [#2586](https://github.com/pdcarlson/Frapp/issues/2586) ([accent-engine.md](accent-engine.md) §4 covers stored ones) the engine holds `accent-9` and `accent-10` to 3:1 on every ladder step, and the label to 4.5:1 on both. It does not hold the pressed overlay, where on a dark chapter the fill can sit under 3:1 and the label under 4.5:1 ([accent-engine.md](accent-engine.md) §8, [#2604](https://github.com/pdcarlson/Frapp/issues/2604)). A control that stays on (toggled, selected, voted) paints `accent-9`, never the pressed shade.

### Sizes

| Size | Height | Radius | Label | Use |
| ---- | ------ | ------ | ----- | --- |
| Default | 46–48px | 12 | 15px | standalone actions, forms, sheet primary |
| Inline | 44px | 12 | 14.5px | action rows inside cards |
| Compact | 34px | 10 | 13.5px | web app bar only (pointer) |

## 4. Inputs and selection

**Dashboard filter toolbars take the Inline height (44), not the default field height (48).** That is a carve-out for filter chrome specifically, and reading it as "the height for a native `<select>`" reproduces the same defect one context over — the event editor put two filter-height selects in a `sm:grid-cols-2` beside 48px `Input`s, so a *form* row rendered at two heights. `apps/web/components/shared/table-controls.ts` therefore writes the paint once and exports two heights, `dashboardFilterSelectClassName` (44) and `dashboardFormSelectClassName` (48). A filter row is secondary chrome sitting above the thing it filters, and mixing §4's 48px field with §3's 44px Inline button in one row renders two visibly different heights — which is what `/members`, `/events`, `/polls` and `/roles` all did. Inline is also the touch floor (§2), so nothing in the row can go under it, and it is what `dashboardFilterSelectClassName` already ships. This settles the second half of #1187 once rather than per family: the Directory & Finance slice applies it to its own screens, and each remaining #920 slice applies it to theirs.

### Text input

| State | Fill | Border | Text |
| ----- | ---- | ------ | ---- |
| Rest | surface `#1A1A1A` | 1px `rgba(255,255,255,.14)` | value `#EDEAE3`, placeholder `#78716A` |
| Focus | surface `#1A1A1A` | 1px `accent-11` + 3px ring `accent-8` @ ~25% (§2) | caret 2px `accent-9` |
| Error | surface `#1A1A1A` | 1px `#f85149` + 3px ring danger @ ~25% | caption 12.5 `#f85149` below |
| Disabled | surface `#1A1A1A` | 1px `rgba(255,255,255,.08)` | `#57534C` |

Default height 48px, radius 12, padding-x 14, text 15.5px. The fill SHOULD sit one layer below the input's container (surface inside cards/sheets; bg `#131211` inside the surface-level app bar).

In the Error state the caption MUST be wired to the field, not merely placed under it: `aria-describedby` on the input references the caption's id, and `aria-invalid` marks the input while the error stands.

### Checkbox

24×24px, radius 7. Unchecked: transparent fill, 1.5px border `rgba(255,255,255,.25)`. Checked: fill `accent-9`, check glyph in `accent-contrast` at 2.2px stroke, round caps/joins. The row hit area MUST be ≥ 44px.

### Toggle

Track 50×30px, full-round — one of the two sanctioned pills (the other is the §12 meter; [foundations.md](foundations.md) §8 holds the list). On: track `accent-9`, thumb 24px `accent-contrast`, right. Off: track elevated `#2A2621` with 1px `rgba(255,255,255,.14)` border, thumb `#78716A`, left.

## 5. Badges and chips

Height 26–28px, radius 8–10, padding-x 10–12, text 12.5px / 600.

| Kind | Fill | Border | Text | Use |
| ---- | ---- | ------ | ---- | --- |
| Accent | `accent-3` | 1px `accent-7` | `accent-11` | accent-worthy stats: points, active filters |
| Neutral | `rgba(255,255,255,.14)` | none | `#EDEAE3` | counts and unread markers ([foundations.md](foundations.md) §5) |
| Hairline | transparent | 1px `rgba(255,255,255,.08)` | `#A9A399` | quiet metadata that must not read as a status |
| Semantic | `--*-tint`: the status color @ 13%, as a token rather than an alpha utility ([foundations.md](foundations.md) §5) | none | status color | Paid / Overdue / status only — never decorative |
| Mention / DM | mention/DM red | none | white | unread mentions and DMs only |

- The mention/DM red value, its fixed-and-semantic rule, and the treatment of channel unread markers are owned by [foundations.md](foundations.md) §5; this section specs only the badge geometry. Placement in nav: [navigation.md](../mobile/navigation.md).
- The reference lifts success/info badge text slightly for contrast on the tint (`#4BC262`, `#4C93F8`); implementations MAY lift the text tone for AA contrast, but the hue is the fixed semantic.
- **The Semantic kind ships three hues, and only danger needs the lift.** Measured on its own 13% tint across the whole surface ladder: success **4.79–6.08:1** and warning **5.27–6.81:1** both clear §6's 4.5:1 gate unlifted, so they render in the semantic hue itself; danger is **3.82–4.85:1**, under the gate from `--surface-1` up, which is what `--destructive-text` (**5.07–6.45:1**) exists for. The tint is an `rgba()` token, so these figures hold in every browser (foundations.md §5). Info would need a lift too (3.45:1 on `--popover`) and deliberately has no kind, because it has no call site. The lift is about the tint: on a plain ladder surface the solid danger measures 4.95–5.58:1 up to `--card` and is the correct tone there, but 4.48:1 on `--popover`, so danger text in a dialog takes the lift even untinted. Measured in [`apps/web/components/billing/status-contrast.spec.ts`](../../../apps/web/components/billing/status-contrast.spec.ts) and, reading the alpha from the tokens, [`apps/web/components/shared/status-tint-contrast.spec.ts`](../../../apps/web/components/shared/status-tint-contrast.spec.ts).
- **A status badge is never the chapter accent.** Under a green-seeded chapter an accent badge is indistinguishable from the success badge (1.08:1) and under a red-seeded one from the danger badge (1.13:1) — so a chapter whose brand is red reads `PAID` as overdue. [`writing.md`](writing.md) §5 owns the rule; this is the measurement behind it.
- **The rule is about the whole vocabulary, not one badge.** #1202 reported a single accent-painted status; the Chapter Ops slice found five, across four files, in three spellings — two mappers, two inline ternaries and a bare literal. The same sweep found the mirror error: §5's **Neutral** kind is "counts and unread markers", and it was carrying `LATE`, `PENDING` and `ACTIVE`, i.e. a status rendered in the count badge. So a family is checked by enumerating every state its screens can render, not by grepping for the accent. Web mappers, one per domain vocabulary: [`apps/web/components/events/attendance-status.ts`](../../../apps/web/components/events/attendance-status.ts), [`apps/web/components/service/service-status.ts`](../../../apps/web/components/service/service-status.ts), [`apps/web/components/study/study-status.ts`](../../../apps/web/components/study/study-status.ts), [`apps/web/components/geofences/geofence-status.ts`](../../../apps/web/components/geofences/geofence-status.ts), and [`apps/web/components/billing/invoice-status.ts`](../../../apps/web/components/billing/invoice-status.ts). The shared invariant is asserted in [`apps/web/components/shared/status-kind.spec.ts`](../../../apps/web/components/shared/status-kind.spec.ts). A mapper whose input is a derived boolean rather than a server token — `geofenceStatusKind`, [`pollStatusKind`](../../../apps/web/components/polls/poll-status.ts) — joins that file's `BOOLEAN_MAPPERS` table instead: the accent and Neutral invariants apply unchanged, and the "unmapped status falls back to Hairline" one has no meaning when there is no third value for the server to add.
- **The Accent kind's other half is a live instruction, not decoration.** §5 names two accent-worthy things and the accent sweeps keep finding only the first. Chapter Ops took the accent off five statuses and had to *give* it to the one badge that deserved it (the `+N pts` chip). The second is **active filters**, and the Resources & Reporting slice found the mirror shape: `/documents` painted its selected folder `bg-primary/10 text-primary` — a raw opacity wash of the chapter accent, which README §2 bans outright as "raw chapter hex painting UI", on a control whose *intent* was correct all along. The recipe is §2's two row states, not §7's sidebar item — §7 defines one active fill (`accent-3`) and a hover that falls back to the card, which a rail already sitting *on* a card cannot use. A filter rail needs two states that are both distinguishable on a card, so it takes the table recipe: hover `accent-3`, active `accent-4` plus `accent-11` text; its geometry is a dense rail inside a card rather than §7's 40px sidebar row. So an accent sweep asks both questions — what is wearing the accent that should not, and what should be wearing it that is not — and the answer to the second is spelled in tokens, never in an opacity wash.

## 6. Tabs

Underline style only — no segmented pill controls.

- Row: 1px bottom hairline `rgba(255,255,255,.08)`; items gap 22px, padding 11px vertical.
- Active: 15px / 600 `#EDEAE3`, 2px bottom underline `accent-9`.
- Inactive: 15px / 400 `#78716A`; hover lifts text to `#A9A399`.
- On touch surfaces the item hit area MUST be ≥ 44px tall.

## 7. Navigation items (web)

Composition of the sidebar and app bar belongs to [web-dashboard/README.md](../web-dashboard/README.md); the item-level specs are:

### Sidebar item

**Web geometry moved with the greenfield shell** ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)), which transcribed it from the framework board (option `1b`, pin 2). Mobile is unchanged.

Height 34px, radius 10, padding-x 10, icon 18px per the duotone recipe ([iconography.md](iconography.md)), gap 10, 2px between rows. Label 14px. (Was 40 / 12 / 17 / 14.5px.)

- Active: fill `accent-3`, text + icon `accent-11`, 14px / 600.
- Inactive: transparent, text + icon `#A9A399`, 14px / 400; hover fill card `#211E1A`.

**No left accent bar.** The board offers a gold active bar only as an unadopted "spice" treatment (`4f` A) and prices it at 56px of nav height. The active state is the tinted fill and the weight bump, nothing else.

**Collapsed rail.** The web nav collapses to a 56px icon rail as a remembered user preference, not a breakpoint. In the rail the row is 34x34, the label carries as the accessible name rather than visible text, and section headings are replaced by hairline dividers between groups (`1c` pin 1). The preference is read from a cookie server-side so the first paint is already the right width.

### App bar chips

**Web geometry moved with the greenfield shell** ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)), transcribed from the framework board (`1b`). Mobile is unchanged.

Container: height 48px (was 58), surface `#1A1A1A`, 1px hairline, no radius — the bar is flush to the viewport edges. Contents:

| Element | Spec |
| ------- | ---- |
| Mark | 30px "S" rounded square (radius 9), house gold — never retints ([brand-identity.md](../brand-identity.md)). **Not in the web top bar**: the chapter identity lives in the nav's 40px chapter row instead, whose 28px tile draws the chapter mark ([`branding.md` § Chapter mark](../../behavior/branding.md#chapter-mark)) |
| Find | wide input, height 34, radius 10, max width 520, fill `--card`, 1px `--input`. The container owns the focus ring on the input's behalf (`FOCUS_RING_WITHIN`) |
| Ask entry | Tinted **geometry**, house-gold **paint**: height 34, radius 10, ✦ glyph + "Ask", 700 — rounded rect, not a capsule. Fill `gold.askFill`, 1px `gold.askBorder`, text `gold.askText` (§11), never `accent-3/7/11`. The board draws Ask in the same values as the chapter accent tints **because its demo tenant is the house tenant** — they coincide there and nowhere else, so merging the two families is the house-tenant trap, not a simplification |
| Notification badge | Fixed `--gold-house` on the bell, never `--primary`. A count is not direct address, so it takes neither the chapter accent nor the mention red (§5) |
| Avatar | 30px circle, elevated `--popover` fill, 1px `--border`, initials 11px / 600 |

**Any control that exists only below `lg`** — the drawer trigger, and every nav row inside the drawer — is on the touch tier by construction and takes the 44px floor (§2, foundations §9), not the 34px pointer geometry above.

There is no command menu and no ⌘K. The find field binds Cmd/Ctrl+F and advertises `⌘F` in the field itself, which is legitimate only because the binding is wired: no keybinding hint, visible or in an `aria-label`, may name a shortcut the surface does not bind. *(Corrected 2026-10-01: this sentence used to attribute the ban on unwired hints to §5, which is Badges and chips and has no such rule. It is stated here now, beside the `aria-label` half this paragraph already carried.)*

## 8. Cards

- Fill card `#211E1A`, 1px border `rgba(255,255,255,.08)`, radius 16 (14 for dense/small cards), padding 16.
- Title 16.5px / 700 `#EDEAE3`; metadata line 14.5px `#A9A399`; a trailing badge (§5) MAY sit in the title row.
- Action rows use Inline buttons (44px, radius 12), gap 8, 13px above.
- Cards never carry shadows; a raised card is a lighter surface ([foundations.md](foundations.md)).

## 9. Sheets and dialogs

### Bottom sheet (mobile)

- Fill elevated `#2A2621`; top corners radius 20, bottom square; 1px hairline on top/sides, no bottom border.
- Grabber: 40×4.5px, full-round, `rgba(255,255,255,.18)`, centered, 10px from the top edge, 14px above the header.
- Header row: title 19px / 700 `#EDEAE3`, "Cancel" text control 14.5px `#78716A` right-aligned — **where the reference draws one**. s19, s20, s21 and s23 do; **s17 does not**: its header is the ✦ glyph + "Ask Frapp" in gold with a trailing caption where Cancel would sit, and the grabber plus the scrim are the dismissal. Reference wins, so a Cancel MUST NOT be added there.
- Scrim: `rgba(0,0,0,.55)` behind a presented sheet, fading in at the first detent and gone at dismissal. Mobile mechanics (`BottomSheetBackdrop`, snap points, sheet-aware scrollables): [patterns.md](../mobile/patterns.md).
- Body: standard controls (§3–§4) at default sizes, padding-x 18.
- Primary action: full-width Primary button, 48px, pinned last.
- **Sheet chrome MUST NOT be styled through NativeWind** (locked ban) — grabber, container, and header use the platform styling path. Mobile usage patterns: [patterns.md](../mobile/patterns.md).

### Dialogs (web)

Elevated `#2A2621` fill, radius 20 (sheet family), 1px hairline. **`window.confirm` is banned** — destructive confirmation is always a dialog (web) or sheet (mobile) pairing a Destructive button with a Secondary cancel.

Web implementation: [`apps/web/components/shared/confirm-dialog.tsx`](../../../apps/web/components/shared/confirm-dialog.tsx). Two rules it carries, both learned by converting six call sites at once:

- **The confirm button names its action** — "Delete study zone", never "Confirm" or a bare "Delete". That is [writing.md](writing.md) §2's CTA rule, and it also keeps a screen's own suite unambiguous: these pages already query their row controls by `/^delete$/i` and `/reject/i`.
- **Cancel and an empty answer are different answers.** The ban covers "other browser-chrome dialogs", so `window.prompt` goes with `window.confirm` — and `prompt` returns `null` for cancel but `""` for OK-with-nothing-typed. Two Chapter Ops flows branch on exactly that difference before sending a comment to the server, so a replacement that collapses them rejects a task or a service entry at the moment someone meant to abandon the rejection.

## 10. State family — skeleton / empty / error

This section specs the **anatomy** of the three visual variants — one family, clearly distinct at a glance. *Which* states a surface MUST ship is owned by [README.md](README.md) §4 and is not restated here. Connection banners and retry/backoff behavior are owned by [resilience](../resilience/README.md); state copy voice by [writing.md](writing.md).

### Skeleton (loading)

- **Content-shaped:** the skeleton mirrors the layout it becomes — same blocks, same radii. No spinner-in-a-box.
- Shimmer: linear gradient 90°, elevated `#2A2621` at 25%/75% and highlight `#332E26` at 50%; background-size 260px; sweep 1.4s linear infinite, phase-shared across blocks. The highlight moved from `#38312A` with the greenfield shell ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)) to match the framework board. **Mobile transcribes this value by hand** (`apps/mobile/components/state-block.tsx`) rather than reading `--skeleton-highlight`, so the two drift unless both move together. The amplitude cost that change carries is measured in [`../web-dashboard/tokens.md`](../web-dashboard/tokens.md) L-01.
- Shapes: text lines 13px tall, radius 6, varied widths (~45–70%); avatars stay circles; control-sized blocks 44px, radius 12.
- Skeletons are neutral only — never accent, never semantic.
- Show on first load only; background refetches keep stale content in place ([resilience](../resilience/README.md)).

### Empty

Standard card chrome (card fill, neutral hairline), centered stack:

| Slot | Spec |
| ---- | ---- |
| Icon tile | 44px, radius 14, fill `accent-3`, feature glyph in `accent-11` ([iconography.md](iconography.md)) |
| Title | 16.5px / 700 `#EDEAE3`, 12px below tile |
| Body | one line, 14.5px `#A9A399`, max-width ~220px |
| CTA (optional) | Tinted button, 44px, radius 12, 14px below |

Empty is inviting, never alarming: accent + neutral only, no semantic color, no blame in copy ([writing.md](writing.md)).

### Error

Same anatomy as empty, recolored semantic:

| Slot | Spec |
| ---- | ---- |
| Card border | 1px `rgba(248,81,73,.28)` — the sanctioned semantic border |
| Icon tile | 44px, radius 14, fill `--destructive-tint` (danger @ 13%), "!" glyph `#f85149` |
| Title | 16.5px / 700 `#EDEAE3` (what failed) |
| Body | 14.5px `#A9A399` (actionable hint) |
| Action | Secondary button, 44px, radius 12 — wiring per [resilience](../resilience/README.md). Labelled `Retry` unless the surface's remedy is genuinely something else: [#2175](https://github.com/pdcarlson/Frapp/issues/2175)'s degraded segment says `Reload` for a stale chunk, because `React.lazy` memoises the rejection for the life of the document, so only replacing the document revives the control that failed (not because retrying does nothing — see writing.md §7). It stays **one** button either way — this family differs in colour rather than in shape, so a second action beside it is the defect, not a second label. `ErrorState`'s `actionLabel` carries this; the strings are [writing.md](writing.md) §7's |

Error surfaces MUST NOT use the chapter accent. Field-level validation errors use the input error state (§4), not this surface.

### Nested inside a card

A state that replaces a whole screen paints `--card`, as the tables above spec. A state rendered **inside a container it cannot rise above** MUST drop that fill. The obvious case is a `<CardContent>`, where `--card` on `--card` is 1.00:1 and the region disappears outright. The Chapter Ops slice found the other one: a panel inside a `SheetContent` (`--popover`, the **top** of the ladder) painting `--card` is 1.085:1 in the *wrong direction*, so it reads as a hole rather than as elevation, and there is no higher step to raise the sheet to instead. Dropping the fill is not a compromise in either case — measured on `--popover`, the hairline over the container separates at 1.275:1 where the card's own hairline managed 1.155:1, so removing the fill **improves** the boundary while removing the inversion. It keeps everything else — the hairline (which is the load-bearing edge once the fill is gone, §2), the icon tile, the title, the body, the CTA, and the error's sanctioned semantic border — because this family is required to differ **in colour rather than in shape**, and bordering some variants and not others would break exactly that. Web implementation: [`apps/web/components/shared/nested-states.tsx`](../../../apps/web/components/shared/nested-states.tsx), which carries **four** members — the three above plus the offline state, whose glyph is `WifiOff` rather than the danger triangle exactly as the top-level `OfflineState`'s is. It stopped at three until `/documents` and `/backwork` needed one, and the first two screens to render an offline state inside a card had reached for the error variant, telling a member with a dropped connection that something had failed.

Two of the nested family's compromises assume a nested state is *one of several*: the live region is left to the top-level `LoadingState` that owns the screen, and the title is a `<p>` rather than an `<h2>` because `/billing` renders two from one query and produced two identical headings. Neither holds where the nested state is a page's **only** async state — there the page is silent to a screen reader mid-load, and its error and empty states have no heading at all, since `CardTitle` is a `<div>`. The `sole` prop says which case a call site is; it defaults off, so it changes nothing for the consumers the module was written for.

**The offline state has a third container, and it is not a region at all.** The two above assume the state stands in for a *layout* — a screen (`OfflineState`, painting `--card`) or a card's contents (`NestedOffline`, dropping the fill). `<Can>` produced the third: a gate standing in for a **single control**, an Upload button in a toolbar or a row action in a table cell. Most of the gate's call sites are that shape (`CONSUMERS` in [`apps/web/components/shared/can-fallback.spec.tsx`](../../../apps/web/components/shared/can-fallback.spec.tsx) lists every file that mounts one), and there a 208px card is not a smaller version of the right answer — it is the wrong object, three of them stacked on `/documents` alone. `PermissionsOffline` ([`apps/web/components/shared/async-states.tsx`](../../../apps/web/components/shared/async-states.tsx)) is the same family at control scale: same `WifiOff`, same tone, same Retry, one inline row. It carries **no fill and no border** — the hairline is the load-bearing edge of a region (§2), and this is not one; a bordered chip where a button was reads as a disabled button rather than as a statement about the network. What it may not drop is the **colour**: this family differs in colour rather than in shape, and the first cut painted the whole row `--muted-foreground`, which made it indistinguishable from an ordinary permission-denied stand-in like the attendance sheet's "View only" — the exact conflation of "denied" and "could not check" the gate rule exists to end. The glyph carries the tone and the caption stays neutral, because the caption is a sentence rather than a status. It takes the **solid** `--destructive`, not `--destructive-text`: §5's lift is for a hue on its own 13% tint, and on a plain ladder surface the solid measures 4.717–5.795:1 across all four steps. The glyph is 16px, [iconography.md](iconography.md) §2's inline-metadata size, which is what `offline-banner.tsx` already draws for the same condition; 14 is the badge-companion carve-out and this glyph leads a notice rather than trailing a badge. Its surface-scale twin `PermissionsOfflineSurface` is a thin wrapper over `OfflineState` that exists to hold the shared half of the copy: every screen- or card-scale gate renders it (the `SURFACE_GATES` ledger in [`can-fallback.spec.tsx`](../../../apps/web/components/shared/can-fallback.spec.tsx) lists them, and fails on one that stops), the title is `writing.md` §7's "(global)" row while the descriptions are per-surface, and a retyped copy of one title per gate is a tone pass away from forking — invisibly, since each is ~30 tokens against `check:duplication`'s 50-token floor.

## 11. Signature surfaces

Two surfaces carry Signet's identity and are built from the primitives above rather than reusing them wholesale: the **chat message row** and the **AI sourced-answer card**. Panel 4e is the system drawing; the Canvas chat thread (s05) and Ask sheet (s17) are later and win where they differ, except where the owner decision below overrides them for chat.

*(Corrected 2026-09-29: the first of these was the chat message **bubble** until the compact layout below replaced it on web and mobile, #2873.)*

Logic is owned elsewhere and only referenced here: message send/reactions/read receipts by [chat/README.md](../../behavior/chat/README.md), answer and citation behavior by [ai.md](../../behavior/ai.md), screen composition and routes by [screens.md](../mobile/screens.md).

### Chat messages (compact layout)

> **Owner decision, 2026-09-29 (Paul, [#2873](https://github.com/pdcarlson/Frapp/issues/2873)).** Chat is a compact, bubble-free timeline on web and mobile: no bubbles; a sender's messages within five minutes collapse into one **run** under a single author line; the author line shows the time only; the date appears only in a divider where a new day starts. He approved the layout on a design review page before it was built, including three choices that page put to him: the viewer's own messages sit on the left like everyone else's, the web action bar goes icon-only, and the grouping window stays five minutes. This supersedes s05's and panel 4e's bubble drawings for chat, and the web framework board's ([`web-framework.dc.html`](../web-dashboard/reference/web-framework.dc.html): the `#general` thread, the pending self bubble, the skeleton's "r18 bubbles" and the token sheet's "Bubbles r18 · tail 6"), although that board is rank 1 for web; they remain truth for everything else they draw.

**Why.** The chapter is moving its daily chat off Discord ([#2558](https://github.com/pdcarlson/Frapp/issues/2558), cutover [#2776](https://github.com/pdcarlson/Frapp/issues/2776)), and members will judge Frapp against Discord's density. Staging, loaded with imported Tau Nu history, showed what the bubble cost. A one-line message took a 55px bubble (12 + 25 + 12 of padding and line box, two hairlines, a 4px gap) where its text needs 25. Mobile repeated the full avatar and author line on every message, because the board draws no grouped run. And an attachment-only message painted an empty bubble above its image.

**What it replaced, and why the bubble lost.** The bubble is kept here as the rejected alternative, because its reasons were real:

- **Mine versus theirs by side and fill.** The self bubble was right-aligned in `accent-9` with `accent-contrast` text, the one place a message took the chapter accent; incoming bubbles were left-aligned in neutral `--card` with a hairline, so "mine vs theirs" survived any accent.
- **Each message was an object with an edge.** The incoming bubble's hairline was load-bearing, since one ladder step is ~1.12:1.
- **The board drew it.** s05 and panel 4e both draw bubbles at the locked radius, 18 with the tail corner at 6.

What outweighed them:

- **Density, first.** Grouping alone, which web already did, still left a bubble per message at roughly twice the height of its text.
- **The sided layout was a tax on everything built beside it.** The action cluster needed a zero-height `rtl` flex track to hug a shrink-wrapped bubble, the inline editor needed conditional width rules because a `<textarea>` inside a hugging block sizes itself circularly, a deleted message had to keep the side it had, and a rich card needed an exception to the sided rule.
- **The per-tenant self fill was a contrast problem.** The in-bubble mention chip had to be opaque because an alpha tint over `--primary` measured 1.03:1 at worst across the seed corpus. Text selection had to avoid the accent because it vanished on the self bubble.

Alternatives weighed and rejected:

- **Bubbles, grouped.** This is what web shipped until this decision. It keeps every cost above except the repeated author line.
- **Bubbles on mobile only.** Two layouts would have to be kept in step, and the Discord comparison happens on phones first.
- **Own messages right-aligned without a fill.** A right-aligned run with no fill to anchor it reads as a layout bug. The owner chose the left.
- **A density toggle.** Per-user density is [#2252](https://github.com/pdcarlson/Frapp/issues/2252), parked; the compact layout is the only one.

#### Row anatomy

| Part | Spec |
| ---- | ---- |
| Thread surface | `--background`. Rows run the full width of the thread column with no fill at rest. |
| Row padding | 20px horizontal on web, 16pt on mobile (the composer's inset). A row that starts a run sits 16 below the row above; a follow-on sits 2 below. |
| Avatar | On the first row of a run only: 32px circle, elevated `--popover` fill, initials caption / 700 in `--muted-foreground`. A photo, where the author has one, takes the circle in place of the initials; which photo, and on which surface, is the [chat README's](../../behavior/chat/README.md#hot-path-client-behavior) to say. The 32px gutter is held open on every row, and the body sits 12 to its right. |
| Author line | On the first row of a run only, baseline-aligned, 8 apart: the name in the `label` role (14 / 600) `--foreground`, then the time as a caption (12.5) in `--muted-foreground`. **Time only** (`formatTimeOfDay` from `@repo/formatting`, on both surfaces), never a date; `formatClock` prints one and is for the popovers, not the thread. |
| Your own name | Reads "You" (`resolveAuthorLabel`) in `--accent-text` (accent-11). It replaced the self bubble's accent fill as how a member spots their own run. It is not the row's only accent: the Pinned marker (§ What rides the row) takes `--accent-text` on anyone's row, and the viewer's reacted chip is the Accent badge recipe. accent-11 is gated at 4.5:1 as text on the neutral ladder ([accent-engine.md](accent-engine.md) §8), which covers both `--background` at rest and `--surface-1` under hover. |
| Body | The `body` role, 16 / 25, `--foreground`. No fill, no border, no padding, no width cap below the column. |
| Follow-on time | Web: the follow-on's own time as a caption in the avatar gutter, revealed with the row's hover, focus and tap state. Hours and minutes with no day period while the run's author line above already says AM or PM, and the full time once the run has crossed noon (`formatTimeOfDayShort` against the run's first message), since a run is measured row to row and can. Mobile has no hover, so a follow-on shows no time; long-press opens the actions sheet, whose header reads `Name · Today at 5:16 PM`. |

**Delineation without a bubble.** Rows are told apart by the author line and the run spacing, not by an edge. Under a pointer hover, keyboard focus inside the row, or a tap reveal, the whole row fills `--surface-1`. That fill is pointer feedback, not information, so its ~1.1:1 step is acceptable under §2's rule for fills: nothing is lost if a member cannot see it. The day divider's hairline is the only rule drawn inside the thread.

#### Grouping

A row **starts a run** (and draws the avatar and author line) when any of these holds; otherwise it joins the run above:

| Condition | Why |
| --- | --- |
| It is the first row, or the row above has a different author | Authors compare by `authorGroupingKey`, which namespaces a Frapp user id apart from an imported source id and name, so twenty Discord authors with no Frapp account never merge into one run. A linked imported row groups as its member (#2878); an unlinked one by its source id and name together, since a Discord webhook or bridge posts every persona under one id. |
| Five minutes or more since the row above | A pause reads as a new thought. Five minutes is the window web shipped before this decision. |
| The row above is on another local calendar day | The day divider sits between them, and a run must not inherit the previous day's author line. |
| The row is a reply | The quote needs the author line under it to say who is answering. |
| The row, or the row above, is a card (poll, task, event, audit, and the rest of `CARD_KINDS`) | A card is its own object in the channel, and its author line says who ran the command. |
| The row above is deleted, or a blocked member's tombstone | Neither shows an author, so the next row has to. |

The window is measured from the previous row, not from the run's first row. The rules live once, in `@repo/chat-core/grouping` (`GROUPING_WINDOW_MS`, `decorateThread`), which web and mobile both call, so the two surfaces cannot drift. Rows the viewer's block list holds back are not drawn, so they neither join nor break a run.

**Day divider.** A hairline (`--border`) on both sides of a centered caption, 12.5 / 600 in `--muted-foreground`: `Today`, `Yesterday`, then the weekday, month and day (`Sunday, Sep 28`), with the year added when it is not the current one (`Tuesday, Mar 3, 2025`: an imported archive spans years, and the divider is the only date there is), by the viewer's local calendar day. It is the only place a date appears in the thread, and it always starts a run. Mobile draws it too; before this decision mobile drew no divider at all.

#### What rides the row

- **Trailing markers.** `(edited)` and a pinned marker (`Pinned` in `--accent-text`, with the pin glyph on web; mobile has no pin glyph yet) trail the body's last line as captions in `--muted-foreground`, on every row, grouped or not. A card has no text line to trail, so its markers go on a line under the card, on both surfaces. This is what fixed [#2872](https://github.com/pdcarlson/Frapp/issues/2872): the marker used to live on the author line, which a grouped row does not draw. Neither marker shows on a deleted message. Where the body's last block is a list, a quote or a code block, the markers drop to their own line under it rather than breaking that block. A heading reads as a line of text in a message, since the allowlist unwraps it, so the markers trail it as they trail a paragraph. A divider or an image draws nothing and doesn't count as the last block.
- **Reply.** The quote sits above the author line, starting in the avatar gutter with a 2px `--popover` elbow that points down into the avatar: the parent's author at 600 in `--foreground`, then a one-line preview in `--muted-foreground`, as a caption. Activating it scrolls to the parent. A reply always starts a run, so the author line is always under its quote.
- **Attachments** render under the body. An attachment-only message draws **no text row**: the image or file sits directly under the author line (or directly in a follow-on row). Its trailing markers go on a line of their own under the attachment, as a card's go under the card.
- **Reactions** sit under the body, left-aligned, 6px below, gap 6. A deleted message draws none. The reacted chip is the Accent badge recipe (§5) at height 26 / radius 9 carrying emoji + count, and the add-reaction chip is the same geometry in elevated `--popover` with no border and a `--muted-foreground` "+". Both MUST take a ≥ 44px hit area (§2) despite the 26px chip.
  - **The chip's 44px hit area grows vertically, not on every side.** Chips sit 6px apart, so a hit area overhanging 9px all round has each chip's overlay covering ~3px of the *visible* chip before it, and the later sibling wins the overlap. A control whose right edge cannot be clicked is a worse defect than the one it fixes. The vertical overhang lands in the row's own padding, where there is no sibling to swallow it.
- **Delivery state.** This resolves the TODO-DESIGN that asked where the undrawn pending and failed states go. A pending row draws its body in `--muted-foreground` with a `Sending…` caption under it. A failed row draws its body in `--muted-foreground` and, under it, the error as a caption in `--destructive-text` (the lifted danger tone, §1) with Retry and Discard (mobile has no lifted danger token yet and draws the solid `--destructive`, which still clears 4.5:1 on the plain row, §5), per [resilience](../resilience/README.md). An `unconfirmed` or `recorded` heavy-command row keeps its muted note and never offers Discard. The status region is mounted empty and only speaks when it has something to say.
- **Cards** (poll, task, event, audit, loading, and the rest) start a run and keep their card surface in the body column: `--card` with a hairline at radius 14. A card is a thing posted into the channel, so it still gets a frame. The frame belongs to the card, not to the message.
- **A deleted message** draws the placeholder in the body's place, italic, in `--muted-foreground`, with no reactions, quote or attachments. It keeps its author line if it started a run.
- **A blocked member's tombstone** is one muted line in the body column. It names no author, so the row after it always starts a run.
- **Mention/DM red applies unchanged in chat**, including in accent-tinted chapters; the value and its rule are owned by [foundations.md](foundations.md) §5. Badge recipe and placement: §5 and [navigation.md](../mobile/navigation.md).

#### In-body mention chip

`@Name` inside a message body takes a soft amber chip on the **handle alone**: fill `--mention-chip` `#4C3A1A`, text `--mention-chip-text` `#FAA81A`, radius 5, inline padding, weight 600. The row around it is **never** retinted: a message that mentions you is still the sender's message. (This was a TODO-DESIGN: the reference draws mention red only as a list badge and a notification dot, and drew nothing for the in-body case.)

- **It is not mention red, and that is [foundations.md](foundations.md) §5's own rule, not a departure from it.** Mention red is a badge fill carrying white text, and §5 states outright that a surface rendering that hue *as text* needs a lifted tone which does not exist. This surface renders as text.
- **The fill is opaque where §5's tint recipe would use 13% alpha.** The chip now always sits on `--background`, or on `--surface-1` while its row is hovered, and the opaque pair measures **5.54:1** on either, so one figure covers every chapter and every row state. *(Corrected 2026-09-29: the opacity was first argued from the self bubble. The chip could land on the per-chapter `--primary` fill, where a 13% tint measured 1.94:1 at best and 1.03:1 at worst across the seed corpus. That surface is gone. Opacity stays because hover changes what is under the chip, and an alpha tint would give it two figures.)* The figures are asserted in `apps/web/components/chat/chat-contrast.spec.ts`.
- **Which run gets the chip is the server's answer, not the renderer's, and it is answered against the server's string.** Mentions resolve server-side from plain `@token` text in the stored body ([chat/README.md](../../behavior/chat/README.md) § Mentions). The chip runs `packages/validation`'s tokenizer over **that raw body** to decide *whether* a handle was addressed, and over the rendered text only to decide *where* the chip sits. The two are different strings, because CommonMark decodes character references before a renderer sees them, and the gap is forgeable: `&#64;PresidentJane` carries no literal `@`, so the API notifies nobody, while a renderer tokenizing its own decoded text would mark her as addressed. Any member can type that, in the one UI whose job is to say who was pinged. The composer's authored mention takes the same chip, so a handle does not change colour on send.
- **Open for the Design bar:** the chip's amber sits in the same family as the pinned house gold of the ✦ Ask card below. They are separated by context and geometry today (Ask chips are 27–28px controls in a card's source row; this is an inline run inside a sentence) and by hue (`#FAA81A` against `#EFB63B`), and the Ask tokens are untouched. If the two ever read as the same thing, this is the one to move.

#### Editing (web)

The editor replaces the body **in place**, in the same row, between the same reply quote and attachment list. It is not a dialog, popover or floating card, because none of those is in place: the web board draws Edit as a control in the in-row hover bar ([web-framework.dc.html](../web-dashboard/reference/web-framework.dc.html) pin 12) and draws no separate edit surface anywhere.

- **It fills the body column.** Without a bubble the column has a definite width, so the field takes all of it. The circular-width problem the bubble editor had to solve (a `<textarea>` inside a shrink-wrapped block sizing itself from its own ~20-character default) cannot arise.
- It is the §4 text input (`--card` fill, input hairline, radius 12) drawing the same 16 / 25 body type, so a draft wraps close to where the message wrapped.
- **Height is a progressive enhancement; width is not.** Where the engine supports `field-sizing`, the field grows with the draft to the composer's cap and scrolls past it; where it does not, it keeps a fixed minimum. The cap is an absolute length, not a fraction of the viewport: the editor sits inside the timeline's scroller, which is always shorter than the viewport, so a `vh` cap can push Save and Cancel below the fold on a short window.
- **It does not yet chip `@mentions`**, because it is a plain field and the composer is a rich editor, so a handle *does* change colour on edit, against the mention-chip rule above for send. Known gap, tracked in [#2236](https://github.com/pdcarlson/Frapp/issues/2236); the stored body is unaffected either way, since both paths send plain text.

Mobile edits through the actions sheet ([screens.md](../mobile/screens.md) s05, #2775).

#### Per-message actions

- **Web: an icon-only action bar over the row's top-right corner.** Quick reactions, the emoji picker, Reply, Save, Edit and Delete, as icons in that order. Each button carries its accessible name and a native tooltip (`title`), and a toggle (Save) announces its state with `aria-pressed`. The bar sits 16px in from the row's right edge, centred on the row's top edge, with an opaque `--card` fill, a hairline and radius 10, so it can overlap text without the text showing through. It reserves no height. It wraps rather than spilling past the row's left edge: on a coarse pointer each icon is 44px, and the nine on your own message are wider than a 375px thread. At the start of history the first row's day divider sits above it, which keeps the bar's upper half on screen; a row scrolled flush with the top of the viewport still clips it until scrolled. It is revealed with the row's hover, `:focus-within` and tap state, and while hidden it takes `pointer-events: none`, since `opacity: 0` alone still hit-tests. Icon-only closed [#2247](https://github.com/pdcarlson/Frapp/issues/2247)'s action-bar item; the labelled chips were wider than a compact row.
  - *(Corrected 2026-09-29: the cluster used to attach to the bubble, not the lane. It rode a zero-height `flex-1` track beside a shrink-wrapped bubble, with `rtl` on the incoming side so `justify-end-safe` fell back to the right edge. That existed only because a sided bubble has a variable edge; a full-width row has a fixed corner.)*
- **Per-message actions reach a coarse pointer by tap, not by drawing a second geometry.** `:hover` and `:focus-within` never fire on a touch device, and the reference draws no touch affordance for this (#1193). Mobile is not a precedent to follow here: its reactions render always visible, and its Reply, Edit and Delete live in the long-press actions sheet (`spec/ui/mobile/screens.md` s05, #2775), a native bottom-sheet pattern with no hover to reveal. The web treatment below is this surface's own answer, not a port.
  - Tapping a row toggles that row's bar, and tapping a second row closes the first's. There is one reveal id per list, never a `useState` per row, or two rows could sit open at once.
  - The shared hook is `apps/web/lib/hooks/use-tap-revealed-message.ts`. Its one caller today is `apps/web/components/chat/message-timeline.tsx` (it had two until #2142 deleted the Details rail's `thread-panel.tsx`). It stays a hook so a second list cannot get this subtly wrong.
  - The toggle is a plain `onClick`, not a touch or press handler, so a scroll gesture cannot trigger it.
  - It bails out on a click whose target is inside a `button`/`a`/form control. That covers every interactive descendant (the reaction chips, the emoji-picker trigger, a card's own Vote/RSVP/checkbox controls) without each one needing its own `stopPropagation`.
  - It checks `window.getSelection()` scoped to the row's own subtree. Finishing a text selection inside the message does not also flip the bar open, and a stale selection left over from a *different* message does not block this row's tap (`apps/web/components/chat/message-item.tsx`).

### AI sourced-answer card

The one deliberately distinct surface in the system, and the only one that **never retints**.

| Slot | Spec |
| ---- | ---- |
| Container | radius 20, surface `#1A1A1A`, 1px border `rgba(239,182,59,.35)` (house gold @ 35%), padding 16 |
| Header | ✦ glyph + "Ask Frapp" 13px / 700 `#F4CB63`, trailing caption 12.5px `#78716A` |
| Answer | 16px / 24px `#EDEAE3`; the answer's key figure bolded in `#F4CB63`, any secondary emphasis bold in `#EDEAE3` |
| Sources | wrapping chip row, gap 7, 12px above; chips per §5 geometry (height 27–28, radius 9), fill `#251E0E`, 1px `#6B5619`, text 12.5px / 600 `#F4CB63`, leading duotone source glyph ([iconography.md](iconography.md)) |
| Footer | caption 12.5px `#78716A` |

- **Never retints — the card is always house gold** (`#EFB63B` family, [brand-identity.md](../brand-identity.md)), never the chapter accent. Panel 4e retints live across four chapter seeds and the bubbles follow the accent while this card stays gold; its caption states the rule outright. In a house-gold chapter the card is indistinguishable from the accent tint family, which is exactly the intent — the answer surface speaks in Signet's voice, not the chapter's.
- **Source chips are the citation UI.** Each cited source renders as one tappable chip (document, minutes, or channel), opening the source in-app; hit area ≥ 44px (§2). The citation contract itself — every answer cites, citations arrive as structured spans the UI renders as links, low confidence refuses rather than fabricates — is owned by [ai.md](../../behavior/ai.md) and MUST NOT be restated in UI specs. Header and footer copy: [writing.md](writing.md).
- **Nested variant.** Presented inside the Ask sheet (s17), the answer block steps down to card `#211E1A` at radius 16 — one ladder step below the sheet it sits in — and the ✦ header moves up to the sheet header. Sheet chrome, grabber, and dismissal are §9.
- **✦ Ask mark (claimed here).** The four-pointed sparkle ✦ is the mark of the Ask/AI affordance: a text glyph, not a duotone icon, so it is exempt from the [iconography.md](iconography.md) recipe. It renders in house gold `#F4CB63` at 15–16px in the card and Ask-sheet headers, and leads the Ask entry (§7) and the mobile Ask pill ([navigation.md](../mobile/navigation.md)). It MUST NOT mark anything that is not an Ask/AI entry point or answer.
- **The entry control is gold too — this line used to say otherwise and was wrong.** The reference draws the ✦ Ask pill on s04 and s06 in the same pinned house-gold tints as the answer card (`#251E0E` fill, `#6B5619` border, `#F4CB63` text at 36px height, radius 10 — see `canvas-screens.dc.html` s04/s06), not as an accent Tinted button, and `apps/mobile/components/chat/ask-pill.tsx` ships those tokens. The web top-nav entry is drawn the same way (`signet-design-system.dc.html`, TOP NAV panel), so §7 has been corrected too: the Ask entry takes the Tinted *geometry* and the house-gold paint. The reference wins on visuals ([`../README.md`](../README.md)); the whole Ask affordance, entry and answer alike, speaks in Signet's voice rather than the chapter's.
- **The pinned house-gold tints are named tokens.** They are the house-gold instance of the accent tint family, but this card holds them regardless of the chapter seed, so they cannot be spelled `accent-3/7/11`. They live in the `gold` group of `packages/theme/src/signet.ts`, named for the surface that owns them rather than for scale steps: `gold.askFill` (`#251E0E`), `gold.askBorder` (`#6B5619`), `gold.askText` (`#F4CB63`), alongside `gold.house` (`#EFB63B`) and `gold.onHouse` (`#2C2000`). The literal hexes in the table above are those tokens' values; implementations MUST use the token names.
- **TODO-DESIGN:** the in-flight (answer pending) state is not drawn; [README.md](README.md) §4 requires one. Nearest pattern used: the content-shaped skeleton (§10) inside the card chrome above — never a spinner-in-a-box.

---

## 12. Proportion meter

The bar behind a tally — a poll's per-option share, a progress figure. Track and fill are both full-round ([foundations.md](foundations.md) §8's second sanctioned pill); the track carries no border. Web implementation: [`apps/web/components/shared/meter.ts`](../../../apps/web/components/shared/meter.ts), which exports one paint and two heights (6px standalone, 4px in-flow inside a message card) on `table-controls.ts`'s split.

| Slot | Spec |
| ---- | ---- |
| Track | `--background` — the **floor** of the §2 ladder, so the groove recedes rather than rises |
| Fill | `accent-9`, width = the share, `denominator > 0` guarded ([`../../behavior/integrations.md`](../../behavior/integrations.md)) |
| Figure | count and percentage as text beside the bar; the bar itself is `aria-hidden` |

- **This is not the reference being overridden.** The boards draw the track at `--popover` ([`reference/canvas-screens.dc.html`](reference/canvas-screens.dc.html) s10, s22), and [`../README.md`](../README.md)'s precedence rule says references beat docs on visuals. They are not contradicted here, because they are silent on the case that breaks: the Canvas header states that the **demo tenant runs the house-gold accent**, so every meter on the board is drawn against one seed — and house gold is a light accent, where a `--popover` track works. The dark-seeded chapters the accent engine also has to serve are simply not drawn. Where the reference draws a case it wins; where it draws one seed and the engine ships nineteen, the measurement decides the other eighteen. The drawn geometry — full-round track and fill, 8px, accent-filled — is transcribed unchanged.
- **The track recedes, and that is the load-bearing decision.** A meter is the one element that can appear on any container — a card, an elevated `SheetContent`, a dialog — so a track painted with a *raised* tone runs out of ladder exactly as §10's nested states do. Measured worst case across all 19 seeds and both containers: `bg-popover` and the accent tint both wash out to **1.000:1 / 1.001:1 inside a dialog**, which is §2's alias failure in a new place. `--background` is the bottom of the ladder, so it sits below whatever it is placed on. It is also the honest reading of "elevation is luminance" — the filled part of a meter is raised, so the empty part is the floor showing through.
- **The obvious fix was also wrong, and only the second relationship shows it.** A meter has two: fill-against-track and track-against-container. The chat slice shipped `bg-input`, which is a real 1.540:1 groove against `--card` — and collided with the fill at **1.017:1 under `#800000`**, because a white wash at 14% landed almost exactly where a maroon `accent-9` did. A chapter branded maroon shipped a bar whose fill was invisible against its own groove. By [#2541](https://github.com/pdcarlson/Frapp/issues/2541) `#800000` no longer painted itself (the generator swaps in its own step 9, `#F42F22`); the dark red still colliding was `#8B0000`, at about 1.07:1, until the engine's fill floor ([accent-engine.md](accent-engine.md) §8) lifted it to `#C34437` (`#D75748` since [#2586](https://github.com/pdcarlson/Frapp/issues/2586)). The ordering held. Worst-case fill-against-track by candidate, measured after [#2586](https://github.com/pdcarlson/Frapp/issues/2586) extended the floor to hover: `bg-input` 2.681, `bg-border` 3.298, `bg-popover` 3.775, accent tint 3.847, **`--background` 4.701**.
- **The bar is never the only signal.** The fill now clears [README.md](README.md) §6's 3:1 non-text floor against the track for every seed, in palettes written since #2541 ([accent-engine.md](accent-engine.md) §4 covers stored ones), but a bar's length cannot carry the exact figure. The count and percentage therefore render as text beside the bar, and the bar is `aria-hidden`. Removing that text on the grounds that the bar shows it is a defect.
- **The fill is the chapter accent and that is sanctioned.** The reference draws both its meters in `accent-9`, and a tally is an accent-worthy *stat* under §5, not a status — so "a status badge is never the chapter accent" does not reach it.
- Measured in [`apps/web/components/shared/meter-contrast.spec.ts`](../../../apps/web/components/shared/meter-contrast.spec.ts), including the rejected candidates, so a later "simplify to the surface ladder" fails loudly rather than reintroducing an invisible track.
