"use client";

import dynamic from "next/dynamic";

/**
 * The emoji picker, fetched on first open rather than on cold load.
 *
 * `frimousse` ships its own emoji index, and both call sites — the composer's
 * ☺ button and a message row's reaction button — render it inside a
 * `PopoverContent`, which Radix does not mount until the popover opens. So the
 * *component* was already lazy; only the *module* was not, and an eager import
 * is enough to weld a library into the entry chunk however conditionally it
 * renders. `1s` puts the emoji picker in `chat-extras` for exactly that reason,
 * beside the slash palette and the mention list.
 *
 * `ssr: false` because there is nothing to server-render: the panel only ever
 * exists inside an opened popover, and rendering it on the server would put the
 * library back on the critical path by another route.
 *
 * **The `loading` fallback is the panel's exact box, and it is not optional.**
 * The first instinct here was to omit it, on the reasoning that an empty popover
 * for one frame moves nothing. That reasoning was wrong in both halves. It is
 * not one frame — it is a network round trip on a cold cache — and
 * `PopoverContent` is `w-auto p-0`, so with no child the popover opens as a
 * ~0x0 bordered dot beside the trigger: it reads as a broken button, and
 * clicking again just toggles the empty box.
 *
 * The jump is worse than the dot. Floating UI places the popover against the
 * trigger using the size it has *at open*, so a 0x0 box near the bottom of the
 * viewport is placed below the trigger, and then the real 288x288 panel mounts,
 * collides with the viewport edge and flips the whole popover above the trigger
 * — under a pointer that has already started moving toward where it was. A
 * reaction button on a message row is exactly that position. Reserving
 * `h-72 w-72`, the panel's own size, costs nothing on the critical path and
 * removes both symptoms; it is the same reserved-geometry argument this lane
 * makes everywhere else, applied to a popover instead of a column.
 */
export const EmojiPicker = dynamic(
  () => import("./emoji-picker-panel").then((m) => m.EmojiPickerPanel),
  {
    ssr: false,
    loading: () => <div className="h-72 w-72" aria-hidden="true" />,
  },
);
