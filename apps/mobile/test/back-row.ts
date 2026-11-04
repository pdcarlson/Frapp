import { act } from "react";
import { expect, vi } from "vitest";
import { useRouter } from "expo-router";
import type { ReactTestRenderer } from "react-test-renderer";
import { drawnText } from "@/test/screen-text";

/**
 * #3022. Asserts a rendered screen draws exactly one back row, that it reads
 * `‹ <label>` with a label naming its destination, and that pressing it goes
 * to `href` rather than back through history. Shared by the screen specs so
 * each one checks the same three things.
 *
 * The router is the suite-wide `vi.fn()` object (`vitest.setup.ts`), which
 * keeps its calls across tests, so this clears `navigate` before pressing.
 */
export function expectBackRow(
  tree: ReactTestRenderer,
  label: string,
  href: string,
): void {
  const rows = tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("Back to "),
  );
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row!.props.accessibilityRole).toBe("button");
  expect(row!.props.accessibilityLabel).toBe(`Back to ${label}`);
  expect(drawnText(row!)).toBe(`‹ ${label}`);

  const router = vi.mocked(useRouter)();
  vi.mocked(router.navigate).mockClear();
  act(() => {
    row!.props.onPress();
  });
  expect(router.navigate).toHaveBeenCalledWith(href);
  expect(router.back).not.toHaveBeenCalled();
}
