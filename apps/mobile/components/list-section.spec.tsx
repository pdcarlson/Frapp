/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { expectRoundedRipple } from "@/test/pressable-row";
import {
  ListRow,
  listRowHint,
  type ListRowProps,
  PressableRow,
  type PressFeedback,
  usePressFeedback,
} from "./list-section";

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

describe("usePressFeedback", () => {
  function feedbackOn(
    os: string,
    options?: Parameters<typeof usePressFeedback>[0],
  ): PressFeedback {
    const platform = Platform as { OS: string };
    const previous = platform.OS;
    platform.OS = os;
    let captured!: PressFeedback;
    function Probe() {
      captured = usePressFeedback(options);
      return null;
    }
    try {
      act(() => {
        create(
          <FrappThemeProvider>
            <Probe />
          </FrappThemeProvider>,
        );
      });
    } finally {
      platform.OS = previous;
    }
    return captured;
  }

  it("lifts to the card step on iOS, and never fades", () => {
    const feedback = feedbackOn("ios");
    expect(feedback.lift(true)).toEqual({
      backgroundColor: signetDarkTokens.color.surface.card,
    });
    expect(feedback.lift(true)).not.toHaveProperty("opacity");
    expect(feedback.lift(false)).toBeNull();
  });

  it("lifts a row that is itself a card to the popover step", () => {
    expect(feedbackOn("ios", { onCard: true }).lift(true)).toEqual({
      backgroundColor: signetDarkTokens.color.surface.popover,
    });
  });

  it("leaves Android to its ripple, with no lift on top", () => {
    const feedback = feedbackOn("android");
    expect(feedback.ripple.color).toMatch(/^rgba\(237,234,227,0\.12\)$/);
    expect(feedback.lift(true)).toBeNull();
  });
});

// React Native paints the ripple as the row's own background, which the row's
// radius and `overflow` never clip; only a parent's clip rounds it. So the
// ripple-bearing Pressable sits inside a View with the row's radius and
// `overflow: "hidden"`, and the row's margins move onto that View so the row
// is laid out where it was.
describe("PressableRow", () => {
  function renderRow(props: Partial<React.ComponentProps<typeof PressableRow>>) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <PressableRow
            accessibilityLabel="Row"
            onPress={vi.fn()}
            style={[
              {
                paddingHorizontal: 8,
                marginHorizontal: -8,
                marginTop: 4,
                borderRadius: 12,
              },
              null,
              { borderTopLeftRadius: 6 },
            ]}
            {...props}
          />
        </FrappThemeProvider>,
      );
    });
    return tree.root.find((node) => (node.type as unknown) === "Pressable");
  }

  it("clips its ripple in a parent with the row's radius, and moves the margins there", () => {
    const row = renderRow({});
    const { clip, resting } = expectRoundedRipple(row, 12);

    expect(clip).toEqual({
      overflow: "hidden",
      marginHorizontal: -8,
      marginTop: 4,
      borderRadius: 12,
      borderTopLeftRadius: 6,
    });
    expect(resting).toEqual({
      paddingHorizontal: 8,
      borderRadius: 12,
      borderTopLeftRadius: 6,
    });
    expect(row.props.accessibilityLabel).toBe("Row");
  });

  it("lifts on iOS while held, and to the popover step for a card", () => {
    // The suite's react-native stub runs as iOS.
    expect(renderRow({}).props.style({ pressed: true })).toContainEqual({
      backgroundColor: signetDarkTokens.color.surface.card,
    });
    expect(
      renderRow({ onCard: true }).props.style({ pressed: true }),
    ).toContainEqual({
      backgroundColor: signetDarkTokens.color.surface.popover,
    });
  });

  it("gives a disabled row no ripple", () => {
    expect(renderRow({ disabled: true }).props.android_ripple).toBeUndefined();
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
