/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { tint } from "@/lib/theme";
import { LocationGlyph } from "@/components/chat/location-glyph";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { BellGlyph } from "@/components/notifications/push-ask";
import { CameraGlyph } from "@/components/service-hours/camera-glyph";

// The §1 stroke recipe (`glyph-recipe.tsx`, #3428): every glyph drawn in it
// strokes at 1.6, fills its silhouette at 16% of its hue (6% white when
// neutral) and leaves its details unfilled, and keeps the accessibility it
// had before it moved onto the shared frame.

const HUE = "#F4CB63";
const NEUTRAL_FILL = "rgba(255,255,255,0.06)";

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

const svg = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown as string) === "Svg");

const shapes = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) =>
    ["Path", "Rect", "Circle"].includes(node.type as unknown as string),
  );

const A11Y_KEYS = [
  "accessible",
  "accessibilityElementsHidden",
  "importantForAccessibility",
] as const;

function a11y(tree: ReactTestRenderer) {
  const props = svg(tree).props as Record<string, unknown>;
  return Object.fromEntries(
    A11Y_KEYS.filter((key) => key in props).map((key) => [key, props[key]]),
  );
}

const CASES: ReadonlyArray<{
  name: string;
  element: React.ReactElement;
  size: number;
  fill: string;
  a11y: Record<string, unknown>;
}> = [
  {
    name: "CameraGlyph",
    element: <CameraGlyph color={HUE} />,
    size: 17,
    fill: tint(HUE, 0.16),
    a11y: {},
  },
  {
    name: "BellGlyph",
    element: <BellGlyph color={HUE} />,
    size: 22,
    fill: tint(HUE, 0.16),
    a11y: {},
  },
  {
    name: "LocationGlyph",
    element: <LocationGlyph color={HUE} />,
    size: 16,
    fill: NEUTRAL_FILL,
    a11y: { accessible: false },
  },
  {
    name: "NotificationsGlyph",
    element: <NotificationsGlyph color={HUE} neutral />,
    size: 20,
    fill: NEUTRAL_FILL,
    a11y: {
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    },
  },
];

describe("the §1 stroke recipe (#3428)", () => {
  it.each(CASES)(
    "$name strokes at 1.6, fills only its silhouette, and keeps its accessibility",
    ({ element, size, fill, a11y: expected }) => {
      const tree = render(element);
      expect(svg(tree).props.width).toBe(size);
      expect(svg(tree).props.viewBox).toBe("0 0 24 24");
      expect(a11y(tree)).toEqual(expected);
      const [body, ...details] = shapes(tree);
      expect(body!.props.stroke).toBe(HUE);
      expect(body!.props.strokeWidth).toBe(1.6);
      expect(body!.props.fill).toBe(fill);
      expect(body!.props.strokeLinejoin).toBe("round");
      expect(details.length).toBeGreaterThan(0);
      for (const detail of details) {
        expect(detail.props.stroke).toBe(HUE);
        expect(detail.props.strokeWidth).toBe(1.6);
        expect(detail.props.fill ?? "none").toBe("none");
        expect(detail.props.strokeLinecap).toBe("round");
        expect(detail.props.strokeLinejoin).toBe("round");
      }
    },
  );
});
