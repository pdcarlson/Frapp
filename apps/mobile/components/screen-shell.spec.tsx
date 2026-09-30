/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text, View } from "react-native";
import { describe, expect, it } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ScreenShell } from "./screen-shell";

/**
 * #2485 — the tab layout draws no navigator header, so the shell is the whole
 * top of every screen that uses it. It has to take the status-bar inset the
 * header used to absorb, and its title is the screen's only heading.
 *
 * The host-string casts are the ones `lib/onboarding/join-screen.spec.tsx`
 * explains.
 */

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

function headings(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "header" &&
      (node.type as unknown) === "Text",
  );
}

describe("ScreenShell (#2485)", () => {
  it("takes the top safe-area inset, which no navigator header absorbs now", () => {
    const tree = render(
      <ScreenShell title="Tasks" subtitle="Assigned to you.">
        <View />
      </ScreenShell>,
    );
    const frame = tree.root.findByType(
      "SafeAreaView" as unknown as React.ElementType,
    );

    expect(frame.props.edges).toEqual(
      expect.arrayContaining(["top", "left", "right", "bottom"]),
    );
  });

  it("marks the title as the screen's one heading", () => {
    const tree = render(
      <ScreenShell title="Tasks" subtitle="Assigned to you.">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(headings(tree).map((node) => node.props.children)).toEqual([
      "Tasks",
    ]);
  });

  it("draws a title mark on the title's row, ahead of the title", () => {
    const tree = render(
      <ScreenShell
        title="Tau Nu"
        titleMark={<View testID="mark" />}
        subtitle="Your chapter's channels and direct messages."
      >
        <View />
      </ScreenShell>,
    );
    const [title] = headings(tree);
    const row = title!.parent!;
    const children = row.children as ReactTestRenderer["root"][];

    const markAt = children.findIndex(
      (child) => child.findAllByProps({ testID: "mark" }).length > 0,
    );
    expect(markAt).toBeGreaterThanOrEqual(0);
    expect(markAt).toBeLessThan(children.indexOf(title!));
  });
});
