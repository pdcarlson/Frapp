"use client";

import dynamic from "next/dynamic";

/**
 * The emoji picker, fetched on first open rather than on cold load.
 *
 * The panel carries the emoji catalog (`@repo/chat-core/emoji`, ~110 KB
 * before compression), and both call sites (the composer's emoji button and
 * a message row's reaction button) render it inside a `PopoverContent`, which
 * Radix does not mount until the popover opens. So the *component* was
 * already lazy; only the *module* was not, and an eager import is enough to
 * weld the catalog into the entry chunk however conditionally it renders.
 * `1s` puts the emoji picker in `chat-extras` for exactly that reason, beside
 * the slash palette and the mention list.
 *
 * **Fetched on intent, not on click.** Both triggers call
 * `preloadEmojiPicker` on pointer enter and focus, so the chunk is on its way
 * in the time between reaching for the button and pressing it. Not on idle:
 * most visits never open the picker, and the chunk is small enough to land
 * within a hover. The first open of a session then draws the grid straight
 * away; it used to wait on the chunk *and* on the old library's (`frimousse`)
 * CDN fetch of emojibase.
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
 * viewport is placed below the trigger, and then the real 312x336 panel mounts,
 * collides with the viewport edge and flips the whole popover above the trigger
 * — under a pointer that has already started moving toward where it was. A
 * reaction button on a message row is exactly that position. Reserving
 * `h-[336px] w-[312px]`, the panel's own size, costs nothing on the critical path and
 * removes both symptoms; it is the same reserved-geometry argument this lane
 * makes everywhere else, applied to a popover instead of a column.
 */
const loadPanel = () =>
  import("./emoji-picker-panel").then((m) => m.EmojiPickerPanel);

export const EmojiPicker = dynamic(loadPanel, {
  ssr: false,
  loading: () => <div className="h-[336px] w-[312px]" aria-hidden="true" />,
});

let preloaded: Promise<unknown> | null = null;

/**
 * Starts fetching the panel's chunk, once per page. A failed fetch is
 * forgotten so the next hover tries again; the open itself still goes through
 * `dynamic`, which reports a chunk error the usual way.
 */
export function preloadEmojiPicker(): void {
  if (preloaded) return;
  preloaded = loadPanel().catch(() => {
    preloaded = null;
  });
}
