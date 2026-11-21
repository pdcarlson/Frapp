import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { BookmarkGlyph, PinGlyph } from "@/components/chat/chat-glyphs";
import { PinGlyph as DocumentsPinGlyph } from "@/components/documents/resources-glyphs";

/*
 * #4292: a pinned channel's pin and a bookmarked message's ribbon are solid
 * while on, as Documents' marks are (#4289), so the state never rides on
 * colour alone (iconography.md §1 rule 1's exception).
 */
const BOOKMARK_BODY = "M6.5 3.75h11v16.5l-5.5-4.2-5.5 4.2z";

function body(element: React.ReactElement, d: string) {
  const { container } = render(element);
  const path = container.querySelector(`path[d="${d}"]`);
  expect(path).not.toBeNull();
  return path!;
}

describe.each([
  ["PinGlyph", PinGlyph, MARK_GLYPH_PATHS.pin.body],
  ["BookmarkGlyph", BookmarkGlyph, BOOKMARK_BODY],
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

it("PinGlyph keeps its needle a stroke while pinned", () => {
  const needle = body(<PinGlyph active />, MARK_GLYPH_PATHS.pin.detail);
  expect(needle.getAttribute("fill")).toBe("none");
});

it("Documents draws chat's pin, so the two can't drift apart", () => {
  expect(DocumentsPinGlyph).toBe(PinGlyph);
});
