import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { PinGlyph, StarGlyph } from "@/components/documents/resources-glyphs";

/*
 * #4289: a starred or pinned item's mark is solid, not the outline in the
 * accent. State must not ride on colour alone.
 */
function body(element: React.ReactElement, d: string) {
  const { container } = render(element);
  const path = container.querySelector(`path[d="${d}"]`);
  expect(path).not.toBeNull();
  return path!;
}

describe.each([
  ["StarGlyph", StarGlyph, MARK_GLYPH_PATHS.star.body],
  ["PinGlyph", PinGlyph, MARK_GLYPH_PATHS.pin.body],
] as const)("%s", (_name, Glyph, d) => {
  it("fills its silhouette solid in its own hue while on", () => {
    const path = body(<Glyph active />, d);
    expect(path.getAttribute("fill")).toBe("currentColor");
    expect(path.getAttribute("fill-opacity")).toBe("1");
  });

  it("keeps the neutral outline while off", () => {
    const path = body(<Glyph />, d);
    expect(path.getAttribute("fill")).toBe("#FFFFFF");
    expect(path.getAttribute("fill-opacity")).toBe("0.06");
  });
});

it("PinGlyph keeps its needle a stroke whether or not it is pinned", () => {
  const needle = body(<PinGlyph active />, MARK_GLYPH_PATHS.pin.detail);
  expect(needle.getAttribute("fill")).toBe("none");
});
