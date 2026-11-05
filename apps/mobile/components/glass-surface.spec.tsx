/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { signetGlass } from "@repo/theme/glass";
import { FrappThemeProvider } from "@/lib/theme";
import {
  type GlassMode,
  GlassSurface,
  resolveGlassMode,
} from "./glass-surface";

/**
 * The glass layer's platform rules (owner pick 2026-11-05): real Liquid Glass
 * on iOS 26, a blur elsewhere it works, a near-solid fill on Android until the
 * blur target lands, and plain `surface1` whenever Reduce Transparency is on.
 */
describe("resolveGlassMode", () => {
  const cases: [string, Parameters<typeof resolveGlassMode>[0], GlassMode][] = [
    [
      "iOS 26",
      { os: "ios", reduceTransparency: false, liquidGlass: true },
      "liquid",
    ],
    [
      "older iOS",
      { os: "ios", reduceTransparency: false, liquidGlass: false },
      "blur",
    ],
    [
      "web",
      { os: "web", reduceTransparency: false, liquidGlass: false },
      "blur",
    ],
    [
      "Android",
      { os: "android", reduceTransparency: false, liquidGlass: false },
      "tinted",
    ],
    [
      "Reduce Transparency, even on iOS 26",
      { os: "ios", reduceTransparency: true, liquidGlass: true },
      "solid",
    ],
  ];
  it.each(cases)("%s", (_name, input, mode) => {
    expect(resolveGlassMode(input)).toBe(mode);
  });
});

function render(mode: GlassMode): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <GlassSurface mode={mode} style={{ borderRadius: 18 }} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const frame = (tree: ReactTestRenderer) =>
  Object.assign(
    {},
    ...[tree.root.findByProps({ testID: "glass-surface" }).props.style].flat(
      Infinity,
    ),
  );
const has = (tree: ReactTestRenderer, type: string) =>
  tree.root.findAll((node) => (node.type as unknown) === type).length > 0;

describe("GlassSurface", () => {
  it("draws plain surface1 and a hairline, nothing see-through, when solid", () => {
    const tree = render("solid");
    expect(frame(tree).backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
    expect(frame(tree).borderColor).toBe(
      signetDarkTokens.color.border.hairline,
    );
    expect(has(tree, "BlurView")).toBe(false);
    expect(has(tree, "GlassView")).toBe(false);
    expect(has(tree, "Svg")).toBe(false);
  });

  it("blurs under the surface1 fill, with the brighter edge and the sheen", () => {
    const tree = render("blur");
    expect(has(tree, "BlurView")).toBe(true);
    expect(has(tree, "Svg")).toBe(true);
    expect(frame(tree).borderColor).toBe(signetGlass.edge);
  });

  it("goes near-solid with no blur where nothing can blur behind it", () => {
    const tree = render("tinted");
    expect(has(tree, "BlurView")).toBe(false);
    expect(frame(tree).backgroundColor).toMatch(/,0\.92\)$/);
  });

  it("leaves iOS 26's own glass to draw itself", () => {
    const tree = render("liquid");
    expect(has(tree, "GlassView")).toBe(true);
    expect(has(tree, "Svg")).toBe(false);
  });

  it("clips to the shape it is given", () => {
    expect(frame(render("blur")).borderRadius).toBe(18);
    expect(frame(render("blur")).overflow).toBe("hidden");
  });
});
