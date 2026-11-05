/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { LEGAL_ACCEPTANCE_LABEL } from "@repo/validation";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { ACCEPTANCE_LINKS } from "@/lib/more/legal";
import { TermsAcceptance } from "./terms-acceptance";

/**
 * The Terms checkbox join, setup and the Terms prompt share (#2302), drawn as
 * components.md § Checkbox draws one: a 24pt box that ticks, inside a 44pt
 * row, with the two documents on one line of 44pt targets under it, whose
 * slop reaches neither the row nor, when large text wraps them, each other. It
 * was a 44pt square that filled solid gold with no check.
 */

type Node = ReactTestRenderer["root"];

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === "function") return flat(style({ pressed }), pressed);
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((item) => flat(item, pressed)));
  }
  return (style ?? {}) as Record<string, unknown>;
}

function render(accepted: boolean, onAcceptedChange = vi.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TermsAcceptance
          accepted={accepted}
          onAcceptedChange={onAcceptedChange}
        />
      </FrappThemeProvider>,
    );
  });
  const row = tree.root.find(
    (node: Node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "checkbox",
  );
  const box = tree.root.findByProps({ testID: "terms-checkbox" });
  return { tree, row, box, onAcceptedChange };
}

describe("TermsAcceptance", () => {
  it("keeps the owner-approved wording, on a 44pt row around a 24pt box", () => {
    const { row, box } = render(false);

    expect(row.props.accessibilityLabel).toBe(LEGAL_ACCEPTANCE_LABEL);
    expect(flat(row.props.style).minHeight).toBe(
      signetDarkTokens.touch.minimum,
    );
    expect(flat(box.props.style)).toEqual(
      expect.objectContaining({ width: 24, height: 24, borderRadius: 7 }),
    );
  });

  it("draws an empty box unticked, and a gold box with a check ticked", () => {
    const off = render(false);
    expect(flat(off.box.props.style).backgroundColor).toBeUndefined();
    expect(off.box.findAllByType("Path" as never)).toHaveLength(0);

    const on = render(true);
    expect(flat(on.box.props.style).backgroundColor).toBe(
      signetDarkTokens.color.gold.house,
    );
    const check = on.box.findByType("Path" as never);
    expect(check.props.stroke).toBe(signetDarkTokens.color.gold.onHouse);
    expect(on.row.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
  });

  it("toggles from anywhere on the row, and shows the press", () => {
    const { row, onAcceptedChange } = render(false);

    expect(flat(row.props.style, true).opacity).toBe(0.7);
    act(() => {
      row.props.onPress();
    });
    expect(onAcceptedChange).toHaveBeenCalledWith(true);
  });

  it("puts both documents on one line, each a 44pt target", () => {
    const { tree } = render(false);
    const links = tree.root.findAll(
      (node: Node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "link",
    );

    expect(links.map((link) => link.props.accessibilityLabel)).toEqual(
      ACCEPTANCE_LINKS.map((link) => link.label),
    );
    for (const link of links) {
      // The link's own height, with its slop above and below, is the floor.
      const { top, bottom } = link.props.hitSlop;
      expect(
        flat(link.props.style).minHeight + top + bottom,
      ).toBeGreaterThanOrEqual(signetDarkTokens.touch.minimum);
    }
    const line = links[0]!.parent!;
    expect(flat(line.props.style).flexDirection).toBe("row");
  });

  it("keeps each link's slop out of the checkbox row above it", () => {
    const { tree, row } = render(false);
    const block = row.parent!;
    const links = tree.root.findAll(
      (node: Node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "link",
    );

    // The row, then the line of links, a gap apart: a top slop wider than
    // the gap would take the row's bottom edge from the checkbox.
    expect(block.children[0]).toBe(row);
    const gap = flat(block.props.style).gap as number;
    expect(gap).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.props.hitSlop.top).toBeLessThanOrEqual(gap);
    }
  });

  it("keeps a wrapped line's slop out of the line above it", () => {
    const { tree } = render(false);
    const links = tree.root.findAll(
      (node: Node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "link",
    );
    const line = flat(links[0]!.parent!.props.style);

    // Large text wraps the links onto two lines. One line's bottom slop and
    // the next one's top slop have to fit in the gap between them, or the
    // later line (hit-tested first) takes the bottom of the link above it.
    expect(line.flexWrap).toBe("wrap");
    for (const link of links) {
      const { top, bottom, left, right } = link.props.hitSlop;
      expect(line.rowGap).toBeGreaterThanOrEqual(top + bottom);
      // Along a line, each side's slop stays inside the gap before the `·`.
      expect(line.columnGap).toBeGreaterThanOrEqual(Math.max(left, right));
    }
  });
});
