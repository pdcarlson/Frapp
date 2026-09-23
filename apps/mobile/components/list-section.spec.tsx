/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ListRow, listRowHint, type ListRowProps } from "./list-section";

function pressable(props: ListRowProps) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ListRow {...props} />
      </FrappThemeProvider>,
    );
  });
  return tree.root.find((node) => (node.type as unknown) === "Pressable");
}

describe("ListRow — what a screen reader hears", () => {
  it("reads the description as the hint and the trailing value as the value", () => {
    const row = pressable({
      label: "Block Blake",
      description: "Hides their messages from you in this chapter's chat.",
      value: "3",
      onPress: vi.fn(),
    });
    expect(row.props.accessibilityLabel).toBe("Block Blake");
    expect(row.props.accessibilityHint).toBe(
      "Hides their messages from you in this chapter's chat.",
    );
    expect(row.props.accessibilityValue).toEqual({ text: "3" });
  });

  it("keeps an explicit hint, after the description", () => {
    const row = pressable({
      label: "Push notifications",
      description: "Off",
      accessibilityHint: "Opens this app's settings.",
      onPress: vi.fn(),
    });
    expect(row.props.accessibilityHint).toBe(
      "Off. Opens this app's settings.",
    );
    expect(row.props.accessibilityValue).toBeUndefined();
  });
});

describe("listRowHint", () => {
  it("says a repeated sentence once, and nothing when there is nothing", () => {
    expect(listRowHint("Opens in your browser.", "Opens in your browser.")).toBe(
      "Opens in your browser.",
    );
    expect(listRowHint(null, undefined)).toBeUndefined();
    expect(listRowHint("", undefined)).toBeUndefined();
  });
});
