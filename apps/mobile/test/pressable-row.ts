import { expect } from "vitest";
import type { ReactTestInstance } from "react-test-renderer";

/** Flattens an array-or-object `style` prop into one object. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/**
 * Asserts a pressable row is drawn through `PressableRow`
 * (`components/list-section.tsx`): its `Pressable` sits directly inside a
 * `View` that carries the row's corner radius and `overflow: "hidden"`. That
 * parent is what rounds the Android ripple, which the row's own radius or
 * `overflow` cannot (see `usePressFeedback`).
 *
 * Returns the clip's style and the row's resting style, so a spec can pin
 * where the row's margins ended up: on the clip, so the row sits where it did.
 */
export function expectRoundedRipple(
  pressable: ReactTestInstance,
  radius: number,
): { clip: Record<string, unknown>; resting: Record<string, unknown> } {
  expect(pressable.props.android_ripple?.color).toMatch(/^rgba\(/);
  const parent = pressable.parent;
  expect(parent?.type as unknown).toBe("View");
  const clip = flatten(parent!.props.style);
  expect(clip.overflow).toBe("hidden");
  expect(clip.borderRadius).toBe(radius);
  const resting = flatten(pressable.props.style({ pressed: false }));
  // The row keeps its own radius too, for its border and the iOS lift.
  expect(resting.borderRadius).toBe(radius);
  return { clip, resting };
}
