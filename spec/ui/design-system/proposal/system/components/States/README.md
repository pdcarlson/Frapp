What a screen shows while loading, while pending, at zero, and when it failed.

**Status:** Confirmed (rulebook § 5; P1.3, P4.2, P4.3). "Try again" as the one retry label is Proposed.

| | File | Component |
| --- | --- | --- |
| Web | `apps/web/components/shared/page-skeletons.tsx`, `async-states.tsx`, `nested-states.tsx`, `segment-error.tsx`, `inline-note.tsx` | `PageSkeleton`, `SkeletonRows`, `ErrorState`, `InlineNote` |
| Phone | `apps/mobile/components/state-block.tsx`, `card-list-skeleton.tsx`, `route-error.tsx`, `inline-note.tsx`, `network-banner.tsx` | `ErrorState`, `SkeletonRegion`, `InlineNote`, `NetworkBanner` |

## Loading

The loaded layout's own shape: the same groups, the same number of rows, bars where the text will be. Bars are `radius-xs`. Web sweeps a shimmer from `popover` through `skeleton-highlight` across a 260 tile in 1.4s, one phase for the whole surface; the phone pulses opacity. With reduced motion the bars hold still. Never a centred spinner, never "Loading…".

## Pending

Gray in place. The row or message dims while it saves and nothing moves. No spinner row, no "Sending" line, no banner. A button that is working keeps its width and label.

## Empty

The real layout at zero. The section header and its group stay, and the group holds one line: a fact in `muted-foreground` ("No tasks this week."), with the first action at the end of that line where the first item would go. A search or filter that matched nothing is one line ("No tasks match …"). No card, no illustration, no icon tile. A feature a member can't use or set up is hidden, not explained.

## Error

The only state that gets a card: the error glyph on `destructive-tint`, a title that says what happened, one plain line, and "Try again". The edge is `destructive` at 28%. A part that failed under a page that loaded is a line in its own group and must never read as zero.

## You provide

The loaded layout's skeleton, the empty line and its action, the error's title and line, and the retry handler.

## Rules

- An empty line states a fact. It never says where things will appear or which button to press.
- An error says what happened and gives one way out. Never a status code, a permission key or a provider's message.
- One connection indicator: the pill in the top bar on web, the floating pill on the phone. Never a second offline notice.
- A success is the change itself showing on screen, not only a toast.

## Web and phone

The system keeps one error card (sized to its content, as the phone draws it; web's has a fixed minimum height of 208) and one retry label. It accepts the phone's opacity pulse in place of the shimmer: the shape and colour match, which is what the rule protects.

## Drift

Neither app has an empty-state component; empties are `InlineNote` sentences (147 of them). C3: of 30 empty states compared, 21 narrate and 12 are worded differently on the two apps. "Retry" (33) and "Try again" (39) both ship. W13: 108 spinners and 37 "Loading…" strings on web, about 5 of them centred page spinners. M12: 25 spinners and 2 "Loading…" on the phone. Web's `ErrorState` defaults to "Unable to load data".
