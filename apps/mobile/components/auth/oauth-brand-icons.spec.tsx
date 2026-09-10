import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  AppleMark,
  GOOGLE_MARK_COLORS,
  GoogleMark,
  OAUTH_MARK_SIZE,
} from "./oauth-brand-icons";

function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

describe("OAuth brand marks", () => {
  it("draws Apple at the action-button size in the inherited color", () => {
    const tree = render(<AppleMark color="#EDEAE3" />);
    const svg = tree.root.findByType("Svg" as never);
    expect(svg.props.width).toBe(OAUTH_MARK_SIZE);
    expect(svg.props.height).toBe(OAUTH_MARK_SIZE);
    expect(svg.props.accessible).toBe(false);
    const path = tree.root.findByType("Path" as never);
    expect(path.props.fill).toBe("#EDEAE3");
  });

  it("draws Google's four-color G and does not take a theme fill", () => {
    const tree = render(<GoogleMark />);
    const svg = tree.root.findByType("Svg" as never);
    expect(svg.props.width).toBe(OAUTH_MARK_SIZE);
    expect(svg.props.height).toBe(OAUTH_MARK_SIZE);
    expect(svg.props.accessible).toBe(false);
    const fills = tree.root
      .findAllByType("Path" as never)
      .map((path) => path.props.fill);
    expect(fills).toEqual([
      GOOGLE_MARK_COLORS.red,
      GOOGLE_MARK_COLORS.blue,
      GOOGLE_MARK_COLORS.yellow,
      GOOGLE_MARK_COLORS.green,
    ]);
  });
});
