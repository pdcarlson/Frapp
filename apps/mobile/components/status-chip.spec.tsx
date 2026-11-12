/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, fontFamilyFor } from "@/lib/theme";
import { AccentChip, StatusChip } from "./status-chip";

// A purple stand-in, so a chip painted house gold or a hairline grey fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
  }),
}));

const tokens = getSignetTokens();

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

/**
 * The flattened style of `node`. A private copy of the stub's
 * `StyleSheet.flatten`, which merges arrays too (#3441 folds these copies).
 */
const flat = (node: ReactTestInstance): Record<string, unknown> =>
  Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

function parts(tree: ReactTestRenderer) {
  const [chip] = tree.root.findAllByType("View" as never);
  const [label] = tree.root.findAllByType("Text" as never);
  return { chip: flat(chip), label: flat(label) };
}

describe("AccentChip (components.md §5 Accent)", () => {
  it("fills in accent-3 under a 1px accent-7 edge, with accent-11 text", () => {
    const { chip, label } = parts(render(<AccentChip label="+10 pts" />));

    expect(chip.backgroundColor).toBe("#251A33");
    expect(chip.borderColor).toBe("#5C3E8A");
    expect(chip.borderWidth).toBe(1);
    expect(label.color).toBe("#CB9FFF");
  });

  it("stands at StatusChip's height, so the two sit side by side", () => {
    const accent = parts(render(<AccentChip label="+10 pts" />));
    const status = parts(
      render(
        <StatusChip
          label="Mandatory"
          hue={tokens.color.semantic.destructive}
        />,
      ),
    );

    expect(accent.chip.height).toBe(24);
    expect(status.chip.height).toBe(24);
  });
});

describe("chip type (components.md §5: 12.5px / 600)", () => {
  it("sets both chips in the caption size at the semibold weight", () => {
    for (const element of [
      <AccentChip key="a" label="+10 pts" />,
      <StatusChip key="s" label="Paid" hue={tokens.color.semantic.success} />,
    ]) {
      const { label } = parts(render(element));
      expect(label.fontSize).toBe(tokens.typography.role.caption.size);
      // The weight rides on the per-weight Figtree face, not `fontWeight`.
      expect(label.fontFamily).toBe(fontFamilyFor(600));
    }
  });
});

describe("StatusChip text tone (components.md §5)", () => {
  it("lifts danger text to the AA tone and keeps the solid hue in the tint", () => {
    const { chip, label } = parts(
      render(
        <StatusChip label="Mandatory" hue={tokens.color.semantic.destructive} />,
      ),
    );
    expect(label.color).toBe(tokens.color.semantic.destructiveText);
    expect(chip.backgroundColor).toBe("rgba(255,102,92,0.13)");
  });

  it("draws success and warning in the hue itself", () => {
    for (const hue of [
      tokens.color.semantic.success,
      tokens.color.semantic.warning,
    ]) {
      const { label } = parts(render(<StatusChip label="Paid" hue={hue} />));
      expect(label.color).toBe(hue);
    }
  });
});
