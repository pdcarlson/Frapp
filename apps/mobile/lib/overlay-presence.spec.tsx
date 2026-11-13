/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  holdOverlay,
  isOverlayOpen,
  useOverlayOpen,
  useOverlayPresence,
} from "./overlay-presence";

/**
 * A sheet leaves the screen under it focused, so what plays by itself on a
 * resting screen asks here whether it is covered (#4610 step 3).
 */
describe("overlay presence", () => {
  it("counts stacked overlays, and releases each one once", () => {
    expect(isOverlayOpen()).toBe(false);
    const first = holdOverlay();
    const second = holdOverlay();
    first();
    first();
    expect(isOverlayOpen()).toBe(true);
    second();
    expect(isOverlayOpen()).toBe(false);
  });

  it("tells a screen when something opens over it and when it closes", () => {
    const seen: boolean[] = [];
    function Screen() {
      seen.push(useOverlayOpen());
      return null;
    }
    function Sheet({ present }: { present: boolean }) {
      useOverlayPresence(present);
      return null;
    }
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <>
          <Screen />
          <Sheet present={false} />
        </>,
      );
    });
    expect(seen.at(-1)).toBe(false);
    act(() =>
      tree.update(
        <>
          <Screen />
          <Sheet present />
        </>,
      ),
    );
    expect(seen.at(-1)).toBe(true);
    // A sheet that unmounts while open (its screen left) is closed too.
    act(() => tree.update(<Screen />));
    expect(seen.at(-1)).toBe(false);
    act(() => tree.unmount());
  });
});
