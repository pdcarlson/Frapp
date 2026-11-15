import type React from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { useBottomSheetInternal } from "@gorhom/bottom-sheet";
import { vi } from "vitest";
import { flatStyle } from "@/test/flat-style";

/**
 * Renders as though inside a bottom sheet: `useInSheet` reads the sheet
 * library's context, which the suite's setup stubs to `null` (#4690).
 */
export function inSheet<T>(run: () => T): T {
  vi.mocked(useBottomSheetInternal).mockReturnValue({} as never);
  try {
    return run();
  } finally {
    vi.mocked(useBottomSheetInternal).mockReturnValue(null);
  }
}

/** The fill of every skeleton bar in the tree. */
export function skeletonBarFills(tree: ReactTestRenderer): unknown[] {
  return tree.root
    .findAllByType("Animated.View" as unknown as React.ComponentType)
    .map((view) => flatStyle(view.props.style).backgroundColor);
}
