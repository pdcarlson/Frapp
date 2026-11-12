/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { PinGlyph, StarGlyph } from "./document-glyphs";

const ACCENT = "#B89CFF";

function pathProps(element: React.ReactElement, d: string) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  const path = tree.root.find(
    (node) =>
      (node.type as unknown as string) === "Path" && node.props.d === d,
  );
  return path.props as { fill: string; stroke: string };
}

/*
 * #4289: a starred or pinned item's mark is solid in its colour, not the
 * outline with a 16% tint that read as the off state in another colour.
 */
describe.each([
  ["StarGlyph", StarGlyph, MARK_GLYPH_PATHS.star.body],
  ["PinGlyph", PinGlyph, MARK_GLYPH_PATHS.pin.body],
] as const)("%s", (_name, Glyph, d) => {
  it("fills its silhouette solid in its colour while on", () => {
    const props = pathProps(<Glyph color={ACCENT} on />, d);
    expect(props.fill).toBe(ACCENT);
    expect(props.stroke).toBe(ACCENT);
  });

  it("is an outline while off", () => {
    expect(pathProps(<Glyph color={ACCENT} />, d).fill).toBe("none");
  });
});

it("PinGlyph keeps its needle a stroke while pinned", () => {
  const needle = pathProps(
    <PinGlyph color={ACCENT} on />,
    MARK_GLYPH_PATHS.pin.detail,
  );
  expect(needle.fill).toBe("none");
});
