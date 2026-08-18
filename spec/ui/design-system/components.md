# Components

> Concrete component specs — variants, sizes, radii, token roles, and interaction states — derived from the committed reference board ([signet-design-system.dc.html](reference/signet-design-system.dc.html), panels 4d, 4e, 4f, and the sheet in 4g) and the locked chat/Ask screens of [canvas-screens.dc.html](reference/canvas-screens.dc.html). Tokens, the radius map, and elevation rules live in [foundations.md](foundations.md); the per-chapter accent scale and its role mapping in [accent-engine.md](accent-engine.md).

---

## 1. Reading the reference

The reference board is the committed visual truth, with two locked corrections:

- **Radii.** Panels 4d/4h draw controls at radius 14 and panel 4e draws chat bubbles at radius 20 — drawings that predate the lock. Where a drawing and the canonical map differ, **the map wins**; the map and its deviation note are owned by [foundations.md](foundations.md) §8.
- **Tab bar.** Panel 4g's 5-tab bar (with a Home tab) is stale. Four tabs — Chat, Events, Tasks, More — are locked; see [navigation.md](../mobile/navigation.md). Panel 4g's *sheet* drawing remains authoritative and is specced in §9.

Colors below are given by **token role** (`accent-N` per [accent-engine.md](accent-engine.md)). The only literal hexes are the fixed neutral and semantic values, which never vary by tenant. Chat bubbles and the AI sourced-answer card (panel 4e) are the two signature surfaces; they are specced in §11.

- **Transcribe the reference, never lift it.** The board is a *picture* of the design, not an implementation: read its source text — do not render it in a browser or screenshot it — and rebuild what it draws in the target stack. The `x-dc` wrapper and the `dv-*` viewer chrome (`dv-turn`, `dv-thd`, `dv-card`) are export scaffolding, and their geometry is board layout rather than component spec — the `dv-card` panels are pinned to 440px/940px on a `#0E0D0B` ground, and panel content is inline-hex styled throughout. Specs are transcribed by token role; the export's own markup and inline values MUST NOT be copied into product code.
- **The exports are not runnable.** Both files load `./support.js`, and `canvas-screens.dc.html` mounts each of its 23 screens through an `x-import` element sourced `from="./ios-frame.jsx"`; neither support file is committed to the repo. Opened in a browser the custom elements never upgrade, so the iOS device frames and panel 4e's accent-seed / bubble-radius controls do not render and the inline-styled screen markup paints unframed. The committed exports are authoritative as **source text**; a browser render is partial, so specs are transcribed from the markup and never from a rendered screenshot.

## 2. Shared rules

- **Touch targets MUST be ≥ 44px** on touch surfaces. Compact 38px controls (§7) are web/pointer-only.
- **No drop shadows.** Elevation is a lighter surface fill ([foundations.md](foundations.md)).
- **No pill shapes** except the toggle track (§4). The "Ask pill" is a rounded rectangle, not a capsule.
- **Borders are neutral hairlines or tokens** — `rgba(255,255,255,.08)` structural, `rgba(255,255,255,.14)` on inputs, `accent-7` on accent-tinted chrome, low-opacity semantic on status surfaces (§10). Never a fixed grey hex.
- **Focus (keyboard/input):** border swaps to `accent-9` plus a 3px ring of `accent-8` at ~25% opacity. Applies to every focusable control.
- **Semantic colors are status-only** (success `#3fb950`, warning `#e5a000`, danger `#f85149`, info `#2f81f7`) — never decorative.
- **Raw chapter hex never paints.** Every accent role resolves through the generated scale ([accent-engine.md](accent-engine.md)).
- Undrawn primitives (select, radio, dropdown menu, popover) MUST compose from the same tokens: elevated `#26221C` fill, hairline border, radius 12, `accent-8` ring.

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

Track 50×30px, full-round — **the only sanctioned pill**. On: track `accent-9`, thumb 24px `accent-contrast`, right. Off: track elevated `#26221C` with 1px `rgba(255,255,255,.14)` border, thumb `#78716A`, left.

## 5. Badges and chips

Height 26–28px, radius 8–10, padding-x 10–12, text 12.5px / 600.

| Kind | Fill | Border | Text | Use |
| ---- | ---- | ------ | ---- | --- |
| Accent | `accent-3` | 1px `accent-7` | `accent-11` | accent-worthy stats: points, active filters |
| Semantic | status color @ 13% alpha | none | status color | Paid / Overdue / status only — never decorative |
| Mention / DM | mention/DM red | none | white | unread mentions and DMs only |

- The mention/DM red value, its fixed-and-semantic rule, and the treatment of channel unread markers are owned by [foundations.md](foundations.md) §5; this section specs only the badge geometry. Placement in nav: [navigation.md](../mobile/navigation.md).
- The reference lifts success/info badge text slightly for contrast on the tint (`#4BC262`, `#4C93F8`); implementations MAY lift the text tone for AA contrast, but the hue is the fixed semantic.

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
- **TODO-DESIGN:** consecutive messages from the same sender are not drawn — s05 draws two adjacent incoming messages from *different* senders, each with full avatar + meta chrome. Until grouping is drawn, every message renders that full chrome; nearest pattern used is s05's per-message row.
- **TODO-DESIGN:** no pending or failed-send affordance is drawn anywhere in the reference, though sends are optimistic and a failure rolls back ([chat/README.md](../../behavior/chat/README.md)). Nearest pattern used: the self-bubble meta line (which already carries "read"), with the failed state taking danger `#f85149` and a retry path per [resilience.md](../resilience.md).
- **TODO-DESIGN:** an in-bubble mention highlight (the "you were addressed" treatment *inside* a message body) is not drawn — the reference only draws mention red as a list badge and a notification dot. Nearest pattern used: the Mention/DM badge in §5.

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
