import { act } from "react";
import { expect, vi } from "vitest";
import { useRouter } from "expo-router";
import type {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import { isTabHref } from "@/lib/href";
import { drawnText } from "@/test/screen-text";

/**
 * #3022. Asserts a rendered screen draws exactly one back row, that it reads
 * `<label>` beside the drawn `‹`, naming its destination, and that pressing it goes
 * to `href` rather than back through history. Shared by the screen specs so
 * each one checks the same three things. These specs render with nothing under
 * the screen, so the row takes its fixed destination: a tab is popped down to
 * (`dismissTo`) and any other screen navigated to (`goBackTo` in `lib/href.ts`).
 *
 * The router is the suite-wide `vi.fn()` object (`vitest.setup.ts`), which
 * keeps its calls across tests, so this clears both before pressing.
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
  expect(drawnText(row!)).toBe(label);

  const router = vi.mocked(useRouter)();
  vi.mocked(router.navigate).mockClear();
  vi.mocked(router.dismissTo).mockClear();
  act(() => {
    row!.props.onPress();
  });
  const way = isTabHref(href as never) ? router.dismissTo : router.navigate;
  expect(way).toHaveBeenCalledWith(href);
  expect(router.back).not.toHaveBeenCalled();
}

/**
 * The colour of a back row's drawn `‹`: the stroke of its `BackGlyph` path. The
 * arrow is a glyph, not a character, so a row's accent or house gold lives
 * there rather than on its text.
 */
export function backArrowColor(row: ReactTestInstance): unknown {
  return row.findByType("Path" as never).props.stroke;
}

/** The view that holds a back capsule and its trailing control side by side. */
export function backRowView(tree: ReactTestRenderer): ReactTestInstance {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "View" && node.props.testID === "back-row",
  );
}
