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
    expect(row.props.accessibilityHint).toBe("Off. Opens this app's settings.");
    expect(row.props.accessibilityValue).toBeUndefined();
  });
});

describe("ListRow — press feedback", () => {
  it("ripples on Android and lifts its surface on iOS while held", () => {
    const row = pressable({ label: "Documents", onPress: vi.fn() });
    expect(row.props.android_ripple?.color).toMatch(/^rgba\(/);
    // The suite's react-native stub runs as iOS.
    expect(row.props.style({ pressed: true })).toMatchObject({
      backgroundColor: expect.any(String),
    });
    expect(row.props.style({ pressed: false })).toBeNull();
  });

  it("gives a disabled row no ripple and no chevron", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListRow label="Host check-in" onPress={vi.fn()} disabled />
        </FrappThemeProvider>,
      );
    });
    const row = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(row.props.android_ripple).toBeUndefined();
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "›",
      ),
    ).toHaveLength(0);
  });
});

describe("ListRow — accessibilityValue", () => {
  it("reads an explicit value for a drawn trailing status, over the value text", () => {
    const row = pressable({
      label: "Notifications",
      accessibilityValue: "2 unread",
      onPress: vi.fn(),
    });
    expect(row.props.accessibilityValue).toEqual({ text: "2 unread" });
  });
});

describe("listRowHint", () => {
  it("says a repeated sentence once, and nothing when there is nothing", () => {
    expect(
      listRowHint("Opens in your browser.", "Opens in your browser."),
    ).toBe("Opens in your browser.");
    expect(listRowHint(null, undefined)).toBeUndefined();
    expect(listRowHint("", undefined)).toBeUndefined();
  });
});
