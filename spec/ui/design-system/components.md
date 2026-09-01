# Components

> Concrete component specs — variants, sizes, radii, token roles, and interaction states — derived from the committed reference board ([signet-design-system.dc.html](reference/signet-design-system.dc.html), panels 4d, 4e, 4f, and the sheet in 4g) and the locked chat/Ask screens of [canvas-screens.dc.html](reference/canvas-screens.dc.html). Tokens, the radius map, and elevation rules live in [foundations.md](foundations.md); the per-chapter accent scale and its role mapping in [accent-engine.md](accent-engine.md).

---

## 1. Reading the reference

The reference board is the committed visual truth, with two locked corrections:

- **Radii.** Panels 4d/4h draw controls at radius 14 and panel 4e draws chat bubbles at radius 20 — drawings that predate the lock. Where a drawing and the canonical map differ, **the map wins**; the map and its deviation note are owned by [foundations.md](foundations.md) §8.
- **Type sizes and spacing, same rule.** The tables below quote sizes measured off the board — 15 and 14.5 for button labels (§3), 16.5 for card and state titles (§8, §10), a 22px tab gap and 11px tab padding (§6). The board draws seventeen distinct font sizes; [foundations.md](foundations.md) §7 locks six and says outright that an off-scale size is a defect, and §9 locks a 4px spacing grid. **The maps win here too**, exactly as they do for radius: an implementation rounds a drawn measurement onto the adjacent scale step (15 → the `label` role's 14, 16.5 → `body` 16 at the weight the drawing distinguishes by, 22 → 24, 11 → 12) rather than reproducing it. Only the weights and the relationships between sizes are transcribed literally.
- **Text tones that miss the contrast gate get lifted one step.** §5 already grants this for badge text on a tint ("implementations MAY lift the text tone for AA contrast, but the hue is the fixed semantic"), and the reference itself does it (`#4BC262`, `#4C93F8`). It generalises: where a *drawn* tone measures below the 4.5:1 text floor [README.md](README.md) §6 sets as a release gate, the implementation moves it one step up the [foundations.md](foundations.md) §4 text ladder — or, for a semantic, to a lifted tone of the same hue — and the surrounding relationships move with it. Measured cases the web implementation carries: `--muted` on the surface ladder is 3.3–4.0:1, so tab labels and input placeholders take `--muted-foreground` (the hover lift moves up to `--foreground` with them); `#f85149` on its own 13% tint is 4.39:1 over card and 4.04:1 over the elevated step, so danger text on a danger tint takes the lifted `#FF7B72`. Fills, borders and the hue itself are unchanged — only text moves.

The `--muted` case generalises further than "placeholders and tab labels": it measures **4.04:1 on `--background`** and lower on every step above it, so it does not clear the gate as text *anywhere* on the ladder. The chat slice therefore lifted every caption it owns — message meta lines, delivery state, rail section headings — to `--muted-foreground`, and separates the sender's name from the timestamp by **weight** rather than by a second tone, which is what `canvas-screens.dc.html` s05 draws anyway (one tone for the whole meta line). Treat `--muted` as a token for non-text roles until a Signet pass revisits the ladder.

**One pair cannot be lifted, and is a recorded exception rather than a defect.** Mention/DM white-on-`#E5484D` measures **3.91:1**. The text is already white, so §1's remedy is unavailable, and the fill is fixed and semantic — [foundations.md](foundations.md) §5 forbids replacing it, s04 draws it, and mobile ships it, so a web-only hue change would break the one guarantee the token exists for. It ships as drawn, is pinned to its measured value by `apps/web/components/chat/chat-contrast.test.ts`, and is tracked for a system-level fix in #1190.
- **Tab bar.** Panel 4g's 5-tab bar (with a Home tab) is stale. Four tabs — Chat, Events, Tasks, More — are locked; see [navigation.md](../mobile/navigation.md). Panel 4g's *sheet* drawing remains authoritative and is specced in §9.

Colors below are given by **token role** (`accent-N` per [accent-engine.md](accent-engine.md)). The only literal hexes are the fixed neutral and semantic values, which never vary by tenant. Chat bubbles and the AI sourced-answer card (panel 4e) are the two signature surfaces; they are specced in §11.

- **Transcribe the reference, never lift it.** The board is a *picture* of the design, not an implementation: read its source text — do not render it in a browser or screenshot it — and rebuild what it draws in the target stack. The `x-dc` wrapper and the `dv-*` viewer chrome (`dv-turn`, `dv-thd`, `dv-card`) are export scaffolding, and their geometry is board layout rather than component spec — the `dv-card` panels are pinned to 440px/940px on a `#0E0D0B` ground, and panel content is inline-hex styled throughout. Specs are transcribed by token role; the export's own markup and inline values MUST NOT be copied into product code.
- **The exports are not runnable.** Both files load `./support.js`, and `canvas-screens.dc.html` mounts each of its 23 screens through an `x-import` element sourced `from="./ios-frame.jsx"`; neither support file is committed to the repo. Opened in a browser the custom elements never upgrade, so the iOS device frames and panel 4e's accent-seed / bubble-radius controls do not render and the inline-styled screen markup paints unframed. The committed exports are authoritative as **source text**; a browser render is partial, so specs are transcribed from the markup and never from a rendered screenshot.

## 2. Shared rules

- **Touch targets MUST be ≥ 44px** on touch surfaces. Compact 38px controls (§7) are web/pointer-only.
- **No drop shadows.** Elevation is a lighter surface fill ([foundations.md](foundations.md)).
- **No pill shapes** except the toggle track (§4) and the proportion meter (§12). The "Ask pill" is a rounded rectangle, not a capsule.
- **Borders are neutral hairlines or tokens** — `rgba(255,255,255,.08)` structural, `rgba(255,255,255,.14)` on inputs, `accent-7` on accent-tinted chrome, low-opacity semantic on status surfaces (§10). Never a fixed grey hex.
- **Focus (keyboard/input):** border swaps to `accent-9` plus a 3px ring of `accent-8` at ~25% opacity. Applies to every focusable control.
  - **The border swap is the half that carries it.** `accent-8` at 25% composites to ~1.3:1 against every step of the surface ladder — under the 3:1 non-text floor [README.md](README.md) §6 sets — so the ring is the halo and the solid border is the signal. A control that drops the border swap has no focus indicator, whatever the ring looks like.
  - **Where the border already means something, move the accent into an offset ring instead.** The toggle's border carries on/off (§4) and a tab's bottom border *is* the selected indicator (§6); repainting either on focus loses the state, or — worse, on tabs — draws the exact visual that means "selected" onto a merely-focused item. Those controls keep their border and take a 2px `accent-8` ring, at full opacity, offset from the control by a 2px band of `--background`.
  - **The two recipes use different accent steps, and the reason is which half carries the indicator.** The bordered recipe dilutes its ring to 25% because the solid `accent-9` border is the signal. The offset recipe has no border to swap — that is why a control lands on it — so its ring is the *entire* indicator and must clear the 3:1 floor unaided. `accent-9` cannot: measured against `--background` across all 19 seeded chapter accents it fails on five (`#800000` 1.77:1, `#8B0000` 1.94, `#1F4E79` 2.24, `#006400` 2.61, `#8B4513` 2.74), so those chapters shipped no conforming indicator on any control using it. `accent-8` at full opacity clears all nineteen, tightest at 3.05:1. Pinned by `apps/web/components/ui/focus-contrast.test.ts`.
  - **The offset band is load-bearing.** The ring's inner edge abuts a band of `--background`, which is the surface the measurement above assumes. Its outer edge abuts whatever the control sits on, and against the deeper ladder steps `accent-8` does *not* clear 3:1 (worst seed 2.86 on surface-1, 2.69 on card, 2.48 on popover). Removing the offset would put the ring back at the mercy of its host surface.
- **Semantic colors are status-only** (success `#3fb950`, warning `#e5a000`, danger `#f85149`, info `#2f81f7`) — never decorative.
- **Raw chapter hex never paints.** Every accent role resolves through the generated scale ([accent-engine.md](accent-engine.md)).
- Undrawn primitives (select, radio, dropdown menu, popover) MUST compose from the same tokens: elevated `#26221C` fill, hairline border, radius 12, `accent-8` ring.
- **A hairline's alpha is not a free parameter.** `--border` is `rgba(255,255,255,.08)` and a diluted `border-border/70` composites to 1.169:1 on `--card` against the token's 1.253:1. Neither clears §6's 3:1 non-text floor and at this ladder neither can, which is exactly why the remaining margin is not available to spend: once elevation is ~1.12:1 the hairline is the only edge there is. Five Chapter Ops row lists had invented that value; [README.md](README.md) §3 rule 4 already bans one-offing a token value at the call site, and this is what it costs.
- **A bubble cannot sit on its own fill.** §11 paints the incoming bubble `--card` with a hairline, which means the surface *hosting* a thread must be a different step — the web dashboard's chat panes are `--background` for the thread and `--surface-1` for the rails, because wrapping the thread in a card made the specified bubble `#1E1B17` on `#1E1B17`. Note what carries the edge once they differ: one ladder step is ~1.12:1 and the composited hairline reaches ~1.4:1, both under the 3:1 non-text floor, so the **hairline is load-bearing** — an incoming bubble that drops its border is delineated by 1.12:1 and effectively has no edge.
- **A highlighted row inside one of those primitives takes the accent tint, never a surface step.** The elevated fill above is the *top* of the surface ladder ([foundations.md](foundations.md) §2), so there is no step above it to highlight with — and `--accent`, the neutral highlight for a control sitting on a lower surface, holds that same `#26221C`. A menu that highlights with it paints the hovered row in its own background. Selection and hover inside menus, command palettes, selects and table rows therefore use the §5 accent-tint recipe (`accent-3` fill, `accent-11` text), which separates by hue: the ladder's own steps are ~1.1:1 apart and cannot carry "this one" on luminance alone.
  - **The tint separates by hue, and only by hue — do not read it as a contrast remedy.** Measured across the seeded chapter directory, `accent-3` sits **1.032–1.143:1** from `--card` — a range that *straddles* the neutral highlight's 1.085:1 rather than beating it. **13 of the 19 seeds land at or below neutral** (the four dark reds worst, at 1.032), and the best reaches only 1.143, so luminance separation is not something the tint can be relied on to provide. What it does buy is chroma — 7–86 points of channel spread from the surface, against the neutral step's 3, holding even for the achromatic seeds. So a surface that needs to distinguish *two* row states cannot get the second one from the tint alone. A table row does: hover takes `accent-3`, and **selection takes `accent-4` plus `accent-11` text** — the one-step lift §3's state table already uses for tinted controls (1.178–1.358:1 on `--card`, and 1.108–1.193:1 above the hover fill, for every seed), with the text tone at 6.33–8.68:1 doing the work the fill cannot. None of these fills clears the 3:1 non-text floor and at this ladder none can, so a state that carries *information* rather than pointer feedback must be redundant with something that is not a fill — the row's own checkbox, a text tone, a summary bar. Measured in [`apps/web/components/shared/table-contrast.test.ts`](../../../apps/web/components/shared/table-contrast.test.ts).

## 3. Buttons

### Variants

| Variant | Fill | Border | Text | Weight |
| ------- | ---- | ------ | ---- | ------ |
| Primary | `accent-9` | none | `accent-contrast` | 700 |
| Secondary | card `#1E1B17` | 1px `rgba(255,255,255,.14)` | `#EDEAE3` | 600 |
| Tinted | `accent-3` | 1px `accent-7` | `accent-11` | 700 |
| Ghost | transparent | none | `accent-11` | 600 |
| Destructive | danger @ 14% alpha | none | `#f85149` | 700 |

Tinted is the accent-soft variant: empty-state CTAs (§10). The Ask entry (§7) borrows its *geometry* only — it is painted in the pinned house-gold tints, never the chapter accent (§11). Destructive is tint-style, never a solid red fill.

### States

| Variant | Hover | Pressed | Disabled (all variants) |
| ------- | ----- | ------- | ----------------------- |
| Primary | fill `accent-10` | fill `accent-10` + 8% black overlay | fill card `#1E1B17`, border `rgba(255,255,255,.08)`, text `#57534C` |
| Secondary | fill elevated `#26221C` | as hover | 〃 |
| Tinted / Ghost | fill `accent-3` (ghost gains it; tinted lifts one step to `accent-4`) | as hover | 〃 |
| Destructive | tint deepens to ~20% alpha | as hover | 〃 |

- **Loading:** the button disables, keeps its width, and shows a spinner in place of (or before) the label. Double-submit locking per [resilience.md](../resilience.md).
- Hover states are pointer-only; mobile uses pressed feedback.

### Sizes

| Size | Height | Radius | Label | Use |
| ---- | ------ | ------ | ----- | --- |
| Default | 46–48px | 12 | 15px | standalone actions, forms, sheet primary |
| Inline | 44px | 12 | 14.5px | action rows inside cards |
| Compact | 38px | 12 | 14px | web app bar only (pointer) |

## 4. Inputs and selection

**Dashboard filter toolbars take the Inline height (44), not the default field height (48).** That is a carve-out for filter chrome specifically, and reading it as "the height for a native `<select>`" reproduces the same defect one context over — the event editor put two filter-height selects in a `sm:grid-cols-2` beside 48px `Input`s, so a *form* row rendered at two heights. `apps/web/components/shared/table-controls.ts` therefore writes the paint once and exports two heights, `dashboardFilterSelectClassName` (44) and `dashboardFormSelectClassName` (48). A filter row is secondary chrome sitting above the thing it filters, and mixing §4's 48px field with §3's 44px Inline button in one row renders two visibly different heights — which is what `/members`, `/events`, `/polls` and `/roles` all did. Inline is also the touch floor (§2), so nothing in the row can go under it, and it is what `dashboardFilterSelectClassName` already ships. This settles the second half of #1187 once rather than per family: the Directory & Finance slice applies it to its own screens, and each remaining #920 slice applies it to theirs.

### Text input

| State | Fill | Border | Text |
| ----- | ---- | ------ | ---- |
| Rest | surface `#171512` | 1px `rgba(255,255,255,.14)` | value `#EDEAE3`, placeholder `#78716A` |
| Focus | surface `#171512` | 1px `accent-9` + 3px ring `accent-8` @ ~25% | caret 2px `accent-9` |
| Error | surface `#171512` | 1px `#f85149` + 3px ring danger @ ~25% | caption 12.5 `#f85149` below |
| Disabled | surface `#171512` | 1px `rgba(255,255,255,.08)` | `#57534C` |

Default height 48px, radius 12, padding-x 14, text 15.5px. The fill SHOULD sit one layer below the input's container (surface inside cards/sheets; bg `#0E0D0B` inside the surface-level app bar).

In the Error state the caption MUST be wired to the field, not merely placed under it: `aria-describedby` on the input references the caption's id, and `aria-invalid` marks the input while the error stands.

### Checkbox

24×24px, radius 7. Unchecked: transparent fill, 1.5px border `rgba(255,255,255,.25)`. Checked: fill `accent-9`, check glyph in `accent-contrast` at 2.2px stroke, round caps/joins. The row hit area MUST be ≥ 44px.

### Toggle

Track 50×30px, full-round — one of the two sanctioned pills (the other is the §12 meter; [foundations.md](foundations.md) §8 holds the list). On: track `accent-9`, thumb 24px `accent-contrast`, right. Off: track elevated `#26221C` with 1px `rgba(255,255,255,.14)` border, thumb `#78716A`, left.

## 5. Badges and chips

Height 26–28px, radius 8–10, padding-x 10–12, text 12.5px / 600.

| Kind | Fill | Border | Text | Use |
| ---- | ---- | ------ | ---- | --- |
| Accent | `accent-3` | 1px `accent-7` | `accent-11` | accent-worthy stats: points, active filters |
| Neutral | `rgba(255,255,255,.14)` | none | `#EDEAE3` | counts and unread markers ([foundations.md](foundations.md) §5) |
| Hairline | transparent | 1px `rgba(255,255,255,.08)` | `#A9A399` | quiet metadata that must not read as a status |
| Semantic | status color @ 13% alpha | none | status color | Paid / Overdue / status only — never decorative |
| Mention / DM | mention/DM red | none | white | unread mentions and DMs only |

- The mention/DM red value, its fixed-and-semantic rule, and the treatment of channel unread markers are owned by [foundations.md](foundations.md) §5; this section specs only the badge geometry. Placement in nav: [navigation.md](../mobile/navigation.md).
- The reference lifts success/info badge text slightly for contrast on the tint (`#4BC262`, `#4C93F8`); implementations MAY lift the text tone for AA contrast, but the hue is the fixed semantic.
- **The Semantic kind ships three hues, and only danger needs the lift.** Measured on its own 13% tint across the whole surface ladder: success **5.02–6.46:1** and warning **5.57–7.15:1** both clear §6's 4.5:1 gate unlifted, so they render in the semantic hue itself; danger is **4.04–4.39:1** on `--popover` and `--card`, which is what `--destructive-text` exists for. Info would need one too (3.65:1 on `--popover`) and deliberately has no kind, because it has no call site. The lift applies **on the tint only** — on a plain ladder surface the solid danger measures 4.72–5.79:1 and is the correct tone; reaching for the lifted one there over-applies §1. Measured in [`apps/web/components/billing/status-contrast.test.ts`](../../../apps/web/components/billing/status-contrast.test.ts).
- **A status badge is never the chapter accent.** Under a green-seeded chapter an accent badge is indistinguishable from the success badge (1.08:1) and under a red-seeded one from the danger badge (1.13:1) — so a chapter whose brand is red reads `PAID` as overdue. [`writing.md`](writing.md) §5 owns the rule; this is the measurement behind it.
- **The rule is about the whole vocabulary, not one badge.** #1202 reported a single accent-painted status; the Chapter Ops slice found five, across four files, in three spellings — two mappers, two inline ternaries and a bare literal. The same sweep found the mirror error: §5's **Neutral** kind is "counts and unread markers", and it was carrying `LATE`, `PENDING` and `ACTIVE`, i.e. a status rendered in the count badge. So a family is checked by enumerating every state its screens can render, not by grepping for the accent. Web mappers, one per domain vocabulary: [`apps/web/components/events/attendance-status.ts`](../../../apps/web/components/events/attendance-status.ts), [`apps/web/components/service/service-status.ts`](../../../apps/web/components/service/service-status.ts), [`apps/web/components/study/study-status.ts`](../../../apps/web/components/study/study-status.ts), [`apps/web/components/geofences/geofence-status.ts`](../../../apps/web/components/geofences/geofence-status.ts), and [`apps/web/components/billing/invoice-status.ts`](../../../apps/web/components/billing/invoice-status.ts). The shared invariant is asserted in [`apps/web/components/shared/status-kind.test.ts`](../../../apps/web/components/shared/status-kind.test.ts). A mapper whose input is a derived boolean rather than a server token — `geofenceStatusKind`, [`pollStatusKind`](../../../apps/web/components/polls/poll-status.ts) — joins that file's `BOOLEAN_MAPPERS` table instead: the accent and Neutral invariants apply unchanged, and the "unmapped status falls back to Hairline" one has no meaning when there is no third value for the server to add.
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

Height 40px, radius 10, padding-x 12, icon 17px per the duotone recipe ([iconography.md](iconography.md)), gap 10.

- Active: fill `accent-3`, text + icon `accent-11`, 14.5px / 600.
- Inactive: transparent, text + icon `#A9A399`, 14.5px / 400; hover fill card `#1E1B17`.

### App bar chips

Container: height 58px, surface `#171512`, 1px hairline, radius 14. Contents:

| Element | Spec |
| ------- | ---- |
| Mark | 30px "S" rounded square (radius 9), house gold — never retints ([brand-identity.md](../brand-identity.md)) |
| Search | compact input, height 38, radius 12, fill bg `#0E0D0B` |
| Ask entry | Tinted **geometry**, house-gold **paint**: height 38, radius 11, ✦ glyph + "Ask", 700 — rounded rect, not a capsule. Fill `gold.askFill`, 1px `gold.askBorder`, text `gold.askText` (§11), never `accent-3/7/11` — the design-system reference's TOP NAV panel draws it gold, and so does the mobile pill |
| Avatar | 32px circle, elevated `#26221C` fill, initials 12.5px / 700 `#A9A399` |

Where Search (or any chip) opens the command menu, its `aria-label` MUST spell the shortcut out in words — "Command K" — rather than leaning on the visible ⌘K glyph, which assistive tech does not announce.

## 8. Cards

- Fill card `#1E1B17`, 1px border `rgba(255,255,255,.08)`, radius 16 (14 for dense/small cards), padding 16.
- Title 16.5px / 700 `#EDEAE3`; metadata line 14.5px `#A9A399`; a trailing badge (§5) MAY sit in the title row.
- Action rows use Inline buttons (44px, radius 12), gap 8, 13px above.
- Cards never carry shadows; a raised card is a lighter surface ([foundations.md](foundations.md)).

## 9. Sheets and dialogs

### Bottom sheet (mobile)

- Fill elevated `#26221C`; top corners radius 20, bottom square; 1px hairline on top/sides, no bottom border.
- Grabber: 40×4.5px, full-round, `rgba(255,255,255,.18)`, centered, 10px from the top edge, 14px above the header.
- Header row: title 19px / 700 `#EDEAE3`, "Cancel" text control 14.5px `#78716A` right-aligned — **where the reference draws one**. s19, s20, s21 and s23 do; **s17 does not**: its header is the ✦ glyph + "Ask Signet" in gold with a trailing caption where Cancel would sit, and the grabber plus the scrim are the dismissal. Reference wins, so a Cancel MUST NOT be added there.
- Scrim: `rgba(0,0,0,.55)` behind a presented sheet, fading in at the first detent and gone at dismissal. Mobile mechanics (`BottomSheetBackdrop`, snap points, sheet-aware scrollables): [patterns.md](../mobile/patterns.md).
- Body: standard controls (§3–§4) at default sizes, padding-x 18.
- Primary action: full-width Primary button, 48px, pinned last.
- **Sheet chrome MUST NOT be styled through NativeWind** (locked ban) — grabber, container, and header use the platform styling path. Mobile usage patterns: [patterns.md](../mobile/patterns.md).

### Dialogs (web)

Elevated `#26221C` fill, radius 20 (sheet family), 1px hairline. **`window.confirm` is banned** — destructive confirmation is always a dialog (web) or sheet (mobile) pairing a Destructive button with a Secondary cancel.

Web implementation: [`apps/web/components/shared/confirm-dialog.tsx`](../../../apps/web/components/shared/confirm-dialog.tsx). Two rules it carries, both learned by converting six call sites at once:

- **The confirm button names its action** — "Delete study zone", never "Confirm" or a bare "Delete". That is [writing.md](writing.md) §2's CTA rule, and it also keeps a screen's own suite unambiguous: these pages already query their row controls by `/^delete$/i` and `/reject/i`.
- **Cancel and an empty answer are different answers.** The ban covers "other browser-chrome dialogs", so `window.prompt` goes with `window.confirm` — and `prompt` returns `null` for cancel but `""` for OK-with-nothing-typed. Two Chapter Ops flows branch on exactly that difference before sending a comment to the server, so a replacement that collapses them rejects a task or a service entry at the moment someone meant to abandon the rejection.

## 10. State family — skeleton / empty / error

This section specs the **anatomy** of the three visual variants — one family, clearly distinct at a glance. *Which* states a surface MUST ship is owned by [README.md](README.md) §4 and is not restated here. Connection banners and retry/backoff behavior are owned by [resilience.md](../resilience.md); state copy voice by [writing.md](writing.md).

### Skeleton (loading)

- **Content-shaped:** the skeleton mirrors the layout it becomes — same blocks, same radii. No spinner-in-a-box.
- Shimmer: linear gradient 90°, elevated `#26221C` at 25%/75% and highlight `#332E26` at 50%; background-size 260px; sweep 1.4s linear infinite, phase-shared across blocks.
- Shapes: text lines 13px tall, radius 6, varied widths (~45–70%); avatars stay circles; control-sized blocks 44px, radius 12.
- Skeletons are neutral only — never accent, never semantic.
- Show on first load only; background refetches keep stale content in place ([resilience.md](../resilience.md)).

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
| Icon tile | 44px, radius 14, fill danger @ 13%, "!" glyph `#f85149` |
| Title | 16.5px / 700 `#EDEAE3` (what failed) |
| Body | 14.5px `#A9A399` (actionable hint) |
| Retry | Secondary button, 44px, radius 12 — wiring per [resilience.md](../resilience.md) |

Error surfaces MUST NOT use the chapter accent. Field-level validation errors use the input error state (§4), not this surface.

### Nested inside a card

A state that replaces a whole screen paints `--card`, as the tables above spec. A state rendered **inside a container it cannot rise above** MUST drop that fill. The obvious case is a `<CardContent>`, where `--card` on `--card` is 1.00:1 and the region disappears outright. The Chapter Ops slice found the other one: a panel inside a `SheetContent` (`--popover`, the **top** of the ladder) painting `--card` is 1.085:1 in the *wrong direction*, so it reads as a hole rather than as elevation, and there is no higher step to raise the sheet to instead. Dropping the fill is not a compromise in either case — measured on `--popover`, the hairline over the container separates at 1.275:1 where the card's own hairline managed 1.155:1, so removing the fill **improves** the boundary while removing the inversion. It keeps everything else — the hairline (which is the load-bearing edge once the fill is gone, §2), the icon tile, the title, the body, the CTA, and the error's sanctioned semantic border — because this family is required to differ **in colour rather than in shape**, and bordering some variants and not others would break exactly that. Web implementation: [`apps/web/components/shared/nested-states.tsx`](../../../apps/web/components/shared/nested-states.tsx), which carries **four** members — the three above plus the offline state, whose glyph is `WifiOff` rather than the danger triangle exactly as the top-level `OfflineState`'s is. It stopped at three until `/documents` and `/backwork` needed one, and the first two screens to render an offline state inside a card had reached for the error variant, telling a member with a dropped connection that something had failed.

Two of the nested family's compromises assume a nested state is *one of several*: the live region is left to the top-level `LoadingState` that owns the screen, and the title is a `<p>` rather than an `<h2>` because `/billing` renders two from one query and produced two identical headings. Neither holds where the nested state is a page's **only** async state — there the page is silent to a screen reader mid-load, and its error and empty states have no heading at all, since `CardTitle` is a `<div>`. The `sole` prop says which case a call site is; it defaults off, so it changes nothing for the consumers the module was written for.

**The offline state has a third container, and it is not a region at all.** The two above assume the state stands in for a *layout* — a screen (`OfflineState`, painting `--card`) or a card's contents (`NestedOffline`, dropping the fill). `<Can>` produced the third: a gate standing in for a **single control**, an Upload button in a toolbar or a row action in a table cell. Eighteen of the gate's twenty-three call sites are that shape, and there a 208px card is not a smaller version of the right answer — it is the wrong object, three of them stacked on `/documents` alone. `PermissionsOffline` ([`apps/web/components/shared/async-states.tsx`](../../../apps/web/components/shared/async-states.tsx)) is the same family at control scale: same `WifiOff`, same tone, same Retry, one inline row. It carries **no fill and no border** — the hairline is the load-bearing edge of a region (§2), and this is not one; a bordered chip where a button was reads as a disabled button rather than as a statement about the network. What it may not drop is the **colour**: this family differs in colour rather than in shape, and the first cut painted the whole row `--muted-foreground`, which made it indistinguishable from an ordinary permission-denied stand-in like the attendance sheet's "View only" — the exact conflation of "denied" and "could not check" the gate rule exists to end. The glyph carries the tone and the caption stays neutral, because the caption is a sentence rather than a status. It takes the **solid** `--destructive`, not `--destructive-text`: §5's lift is for a hue on its own 13% tint, and on a plain ladder surface the solid measures 4.717–5.795:1 across all four steps. The glyph is 16px, [iconography.md](iconography.md) §2's inline-metadata size, which is what `offline-banner.tsx` already draws for the same condition; 14 is the badge-companion carve-out and this glyph leads a notice rather than trailing a badge. Its surface-scale twin `PermissionsOfflineSurface` is a thin wrapper over `OfflineState` that exists to hold the shared half of the copy: eight gates render it, the title is `writing.md` §7's "(global)" row while the descriptions are per-surface, and eight retyped copies of one title is a tone pass away from forking — invisibly, since each is ~30 tokens against `check:duplication`'s 50-token floor.

## 11. Signature surfaces

Two surfaces carry Signet's identity and are built from the primitives above rather than reusing them wholesale: the **chat message bubble** and the **AI sourced-answer card**. Panel 4e is the system drawing; the Canvas chat thread (s05) and Ask sheet (s17) are later and win where they differ.

Logic is owned elsewhere and only referenced here: message send/reactions/read receipts by [chat/README.md](../../behavior/chat/README.md), answer and citation behavior by [ai.md](../../behavior/ai.md), screen composition and routes by [screens.md](../mobile/screens.md).

### Chat message bubbles

Bubbles take the locked bubble radius — **18 with the tail corner at 6** ([foundations.md](foundations.md) §8). The tail is the bubble's bottom corner on the sender's side: `18 18 18 6` incoming, `18 18 6 18` self.

| Variant | Fill | Border | Text | Placement |
| ------- | ---- | ------ | ---- | --------- |
| Incoming (other) | card `#1E1B17` | 1px `rgba(255,255,255,.08)` | `#EDEAE3` | left, avatar leading |
| Self | `accent-9` | none | `accent-contrast` | right, no avatar |

- Padding 11px vertical / 14px horizontal, text 16px / 23px line height. Max width **86%** of the thread column on both sides; the bubble hugs its content below that. Message rows sit 16px apart, avatar-to-bubble gap 10px, thread padding 20px.
- The self bubble is the one place a message takes the chapter accent — `accent-9` fill with `accent-contrast` text ([accent-engine.md](accent-engine.md)). Incoming bubbles stay neutral in every chapter, so "mine vs theirs" survives any accent. (s05 draws the self bubble's text at weight 500, outside the locked 400/600/700 set in [foundations.md](foundations.md); it renders at the body weight.)
- **Avatar** (incoming only): 32px circle, elevated `#26221C` fill, initials 12.5px / 700 `#A9A399`, top-aligned with the meta line.
- **Meta line.** Incoming: `Name · time`, caption 12.5px `#78716A`, *above* the bubble, indented 4px. Self: `time`, caption right-aligned *below* the bubble, and it carries the delivery state when there is one ("5:16 PM · read"). Receipt semantics: [chat/README.md](../../behavior/chat/README.md).
- **Day divider:** centered caption 12.5px / 600 `#78716A`.
- **Reactions** attach to the bubble, 6px below and indented 4px, gap 6: the reacted chip is the Accent badge recipe (§5) at height 26 / radius 9 carrying emoji + count, and the add-reaction chip is the same geometry in elevated `#26221C` with no border and a `#A9A399` "+". Both MUST take a ≥ 44px hit area (§2) despite the 26px chip.
- **Mention/DM red applies unchanged in chat**, including in accent-tinted chapters; the value and its rule are owned by [foundations.md](foundations.md) §5. Badge recipe and placement: §5 and [navigation.md](../mobile/navigation.md).
- **Sided layout is for bubbles, not for the whole row.** A rich card in the flow (poll, task, event, audit, the AI answer card) keeps the incoming shape whoever sent it — panel 4e draws its card in the flow rather than sided, and §11 specs bubbles. A deleted message keeps the side it had, since a row that jumps columns the moment its sender deletes it reflows the thread around the one row nobody should be reading.
- **The chip's 44px hit area grows vertically, not on every side.** Chips sit 6px apart, so a hit area overhanging 9px all round has each chip's overlay covering ~3px of the *visible* chip before it, and the later sibling wins the overlap — a control whose right edge cannot be clicked is a worse defect than the one it fixes. The vertical overhang lands in the row's own padding, where there is no sibling to swallow.
- **TODO-DESIGN:** consecutive messages from the same sender are not drawn — s05 draws two adjacent incoming messages from *different* senders, each with full avatar + meta chrome. Mobile renders that full chrome per message, which is the safe reading of an undrawn case.
  - **The web dashboard groups, deliberately, and that is not a violation.** `apps/web/components/chat/message-timeline.tsx` collapses the avatar and meta line on a follow-on message from the same sender within five minutes. The reference draws no grouped run to contradict, so there is nothing here to disagree with — and on a dashboard feed, repeating an avatar and a name on every line of a burst is noise, not fidelity. A grouped row still renders its bubble, its reactions and its delivery state; only the chrome that would repeat is suppressed, and a **day divider always restarts it** so a run cannot inherit the previous day's author line. If grouping is ever drawn, this is the behaviour to draw against.
- **TODO-DESIGN:** no pending or failed-send affordance is drawn anywhere in the reference, though sends are optimistic and a failure rolls back ([chat/README.md](../../behavior/chat/README.md)). Nearest pattern used: the self-bubble meta line (which already carries "read"), with the failed state taking danger `#f85149` and a retry path per [resilience.md](../resilience.md).
- **TODO-DESIGN:** an in-bubble mention highlight (the "you were addressed" treatment *inside* a message body) is not drawn — the reference only draws mention red as a list badge and a notification dot. Nearest pattern used: the Mention/DM badge in §5.
- **Per-message actions reach a coarse pointer by tap, not by drawing a second geometry.** The quick-reaction cluster and Reply are `:hover`/`:focus-within`-revealed, which a touch device can never trigger — the reference draws no touch affordance for this either, since these actions live in a long-press sheet on mobile that the web dashboard has no equivalent of (#1193). The web treatment is tap-to-reveal: tapping a row toggles that row's cluster, and tapping a second row closes the first's — one reveal id per list (`apps/web/components/chat/message-timeline.tsx`, `thread-panel.tsx`), never a `useState` per row, or two rows could sit open at once. The toggle is a plain `onClick`, not a touch/press handler, so a scroll gesture cannot trigger it, and it checks `window.getSelection()` first so finishing a text selection inside the bubble does not also flip the cluster open (`apps/web/components/chat/message-item.tsx`).

### AI sourced-answer card

The one deliberately distinct surface in the system, and the only one that **never retints**.

| Slot | Spec |
| ---- | ---- |
| Container | radius 20, surface `#171512`, 1px border `rgba(239,182,59,.35)` (house gold @ 35%), padding 16 |
| Header | ✦ glyph + "Ask Signet" 13px / 700 `#F4CB63`, trailing caption 12.5px `#78716A` |
| Answer | 16px / 24px `#EDEAE3`; the answer's key figure bolded in `#F4CB63`, any secondary emphasis bold in `#EDEAE3` |
| Sources | wrapping chip row, gap 7, 12px above; chips per §5 geometry (height 27–28, radius 9), fill `#251E0E`, 1px `#6B5619`, text 12.5px / 600 `#F4CB63`, leading duotone source glyph ([iconography.md](iconography.md)) |
| Footer | caption 12.5px `#78716A` |

- **Never retints — the card is always house gold** (`#EFB63B` family, [brand-identity.md](../brand-identity.md)), never the chapter accent. Panel 4e retints live across four chapter seeds and the bubbles follow the accent while this card stays gold; its caption states the rule outright. In a house-gold chapter the card is indistinguishable from the accent tint family, which is exactly the intent — the answer surface speaks in Signet's voice, not the chapter's.
- **Source chips are the citation UI.** Each cited source renders as one tappable chip (document, minutes, or channel), opening the source in-app; hit area ≥ 44px (§2). The citation contract itself — every answer cites, citations arrive as structured spans the UI renders as links, low confidence refuses rather than fabricates — is owned by [ai.md](../../behavior/ai.md) and MUST NOT be restated in UI specs. Header and footer copy: [writing.md](writing.md).
- **Nested variant.** Presented inside the Ask sheet (s17), the answer block steps down to card `#1E1B17` at radius 16 — one ladder step below the sheet it sits in — and the ✦ header moves up to the sheet header. Sheet chrome, grabber, and dismissal are §9.
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
- **The obvious fix was also wrong, and only the second relationship shows it.** A meter has two: fill-against-track and track-against-container. The chat slice shipped `bg-input`, which is a real 1.540:1 groove against `--card` — and collides with the fill at **1.017:1 under `#800000`**, because a white wash at 14% lands almost exactly where a maroon `accent-9` lands. A chapter branded maroon shipped a bar whose fill was invisible against its own groove. Worst-case fill-against-track by candidate: `bg-input` 1.015, `bg-border` 1.133, `bg-popover` 1.444, accent tint 1.512, **`--background` 1.774**.
- **The bar is never the only signal.** Even at 1.774:1 the fill is under [README.md](README.md) §6's 3:1 non-text floor for the darkest seeds, and at this ladder nothing can clear it — the same concession §2 makes for row states. The count and percentage therefore render as text beside the bar, and the bar is `aria-hidden`. Removing that text on the grounds that the bar shows it is a defect.
- **The fill is the chapter accent and that is sanctioned.** The reference draws both its meters in `accent-9`, and a tally is an accent-worthy *stat* under §5, not a status — so "a status badge is never the chapter accent" does not reach it.
- Measured in [`apps/web/components/shared/meter-contrast.test.ts`](../../../apps/web/components/shared/meter-contrast.test.ts), including the rejected candidates, so a later "simplify to the surface ladder" fails loudly rather than reintroducing an invisible track.
