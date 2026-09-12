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
 * **No `loading` fallback, deliberately.** A placeholder here would be a
 * differently-sized box inside a popover that sizes to its content, so the
 * panel would open small and then jump — trading a chunk on the critical path
 * for a layout shift, which is the other half of the same contract. Radix keeps
 * the trigger's position; an empty popover for one frame does not move anything
 * around it.
 */
export const EmojiPicker = dynamic(
  () => import("./emoji-picker-panel").then((m) => m.EmojiPickerPanel),
  { ssr: false },
);
