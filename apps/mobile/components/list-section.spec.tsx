/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";
import { useBottomSheetInternal } from "@gorhom/bottom-sheet";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, typeRole } from "@/lib/theme";
import { ForwardGlyph } from "@/components/control-glyphs";
import { expectRoundedRipple } from "@/test/pressable-row";
import {
  DayHeading,
  ListRow,
  listRowHint,
  type ListRowProps,
  ListSection,
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
    // The suite's react-native stub runs as iOS. A ListRow sits on its
    // ListSection's fill, which on a screen is `surface1`, so it lifts a step
    // above that, to `card`: a lift to the section's own fill would paint the
    // row its own colour and show nothing.
    expect(row.props.style({ pressed: true })).toMatchObject({
      backgroundColor: signetDarkTokens.color.surface.card,
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
    expect(tree.root.findAllByType(ForwardGlyph)).toHaveLength(0);
  });
});

describe("ListRow — chevron", () => {
  function chevrons(props: ListRowProps) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListRow {...props} />
        </FrappThemeProvider>,
      );
    });
    return tree.root.findAllByType(ForwardGlyph);
  }

  it("draws one on a row that opens somewhere", () => {
    expect(chevrons({ label: "Documents", onPress: vi.fn() })).toHaveLength(1);
  });

  // Web's row chevrons are `--muted-foreground`; the phone's follow (#4138).
  it("draws it in the muted-foreground tone, as web's row chevrons", () => {
    const [glyph] = chevrons({ label: "Documents", onPress: vi.fn() });
    expect(glyph.props.color).toBe(signetDarkTokens.color.text.mutedForeground);
  });

  it("draws none on a row that acts in place (components.md § Chrome weight)", () => {
    expect(
      chevrons({
        label: "Sign out",
        destructive: true,
        action: true,
        onPress: vi.fn(),
      }),
    ).toHaveLength(0);
  });
});

describe("DayHeading", () => {
  // Web's Events day heading (#4138): sentence case, caption / 600, foreground,
  // never the uppercase section eyebrow.
  it("draws the day in sentence case, caption / 600, in the foreground tone", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <DayHeading>Tomorrow</DayHeading>
        </FrappThemeProvider>,
      );
    });
    const text = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.style != null,
    );
    const style = Object.assign({}, ...[text.props.style].flat(Infinity));
    const { caption } = signetDarkTokens.typography.role;
    expect(text.props.accessibilityRole).toBe("header");
    expect(style.textTransform).toBeUndefined();
    expect(style.color).toBe(signetDarkTokens.color.text.foreground);
    expect(style.fontSize).toBe(caption.size);
    expect(style.fontFamily).toBe(
      typeRole({
        ...caption,
        weight: signetDarkTokens.typography.weight.semibold,
      }).fontFamily,
    );
  });
});

describe("ListRow — busy", () => {
  function renderRow(props: ListRowProps) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListRow {...props} />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  // A row whose action is running is working, not unavailable: it keeps its
  // label colour, swaps the chevron for a spinner, and takes no second press.
  it("keeps the label's colour and puts a spinner where the chevron was", () => {
    const tree = renderRow({ label: "Bylaws", onPress: vi.fn(), busy: true });
    const label = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "Bylaws",
    );
    const color = Object.assign({}, ...[label.props.style].flat()).color;

    expect(color).toBe(signetDarkTokens.color.text.foreground);
    expect(
      tree.root.findAll(
        (node) => (node.type as unknown) === "ActivityIndicator",
      ),
    ).toHaveLength(1);
    expect(tree.root.findAllByType(ForwardGlyph)).toHaveLength(0);

    const row = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(row.props.disabled).toBe(true);
    expect(row.props.accessibilityState).toEqual({
      disabled: false,
      busy: true,
    });
  });
});

describe("ListRow — detail", () => {
  // s15 draws a fact row with the label quiet and the value bright: the
  // default row's emphasis the other way round.
  it("mutes the label at regular weight and sets the value at the label's weight", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListRow variant="detail" label="Email" value="pc@rpi.edu" />
        </FrappThemeProvider>,
      );
    });
    const styleOf = (text: string) => {
      const node = tree.root.find(
        (candidate) =>
          (candidate.type as unknown) === "Text" &&
          candidate.props.children === text,
      );
      return Object.assign({}, ...[node.props.style].flat()) as Record<
        string,
        unknown
      >;
    };
    const label = styleOf("Email");
    const value = styleOf("pc@rpi.edu");
    const { text } = signetDarkTokens.color;

    expect(label.color).toBe(text.mutedForeground);
    expect(value.color).toBe(text.foreground);
    expect(value.fontSize).toBe(label.fontSize);
    expect(value.fontFamily).not.toBe(label.fontFamily);
  });

  // A chapter's custom-field label has no length limit. Sized to its text
  // with nothing to stop it, a long one took the whole row and squeezed the
  // value to no width; it stops at half the row and wraps there instead.
  it("wraps a long label at half the row and keeps the value's width", () => {
    const longLabel = "Emergency contact name and phone number";
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListRow variant="detail" label={longLabel} value="Jordan Lee" />
        </FrappThemeProvider>,
      );
    });
    const flat = (style: unknown) =>
      Object.assign({}, ...[style].flat()) as Record<string, unknown>;
    const labelText = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === longLabel,
    );
    const valueText = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === "Jordan Lee",
    );
    const labelColumn = flat(labelText.parent!.props.style);

    expect(labelColumn.maxWidth).toBe("50%");
    // Its own width, shrinking only past half the row. Not `flex: 0`, which
    // react-native-web hands to CSS as a zero basis (one letter a line).
    expect(labelColumn.flex).toBe(-1);
    // No line cap on the label, so it wraps rather than clipping.
    expect(labelText.props.numberOfLines).toBeUndefined();
    // The value takes the rest of the row, whatever the label measures.
    expect(flat(valueText.props.style).flex).toBe(1);
  });
});

describe("ListSection", () => {
  function fill() {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ListSection>
            <ListRow label="Documents" onPress={vi.fn()} />
          </ListSection>
        </FrappThemeProvider>,
      );
    });
    const section = tree.root.findAll(
      (node) => (node.type as unknown) === "View",
    )[0]!;
    return Object.assign({}, ...[section.props.style].flat(Infinity))
      .backgroundColor as string;
  }

  // #4682: a list on a screen sat two steps above the page.
  it("is one step above the page on a screen", () => {
    expect(fill()).toBe(signetDarkTokens.color.surface.surface1);
  });

  it("keeps `card` in a sheet, one step under the sheet's own fill", () => {
    vi.mocked(useBottomSheetInternal).mockReturnValue({} as never);
    try {
      expect(fill()).toBe(signetDarkTokens.color.surface.card);
    } finally {
      vi.mocked(useBottomSheetInternal).mockReturnValue(null);
    }
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

  it("lifts one step above the page on iOS, and never fades", () => {
    const feedback = feedbackOn("ios");
    expect(feedback.lift(true)).toEqual({
      backgroundColor: signetDarkTokens.color.surface.surface1,
    });
    expect(feedback.lift(true)).not.toHaveProperty("opacity");
    expect(feedback.lift(false)).toBeNull();
  });

  it("lifts a row that is itself a card to the step above the card", () => {
    expect(feedbackOn("ios", { onCard: true }).lift(true)).toEqual({
      backgroundColor: signetDarkTokens.color.surface.card,
    });
  });

  it("keeps a sheet's steps: a card there is `card`, and what lifts on it `popover`", () => {
    vi.mocked(useBottomSheetInternal).mockReturnValue({} as never);
    try {
      expect(feedbackOn("ios").lift(true)).toEqual({
        backgroundColor: signetDarkTokens.color.surface.card,
      });
      expect(feedbackOn("ios", { onCard: true }).lift(true)).toEqual({
        backgroundColor: signetDarkTokens.color.surface.popover,
      });
    } finally {
      vi.mocked(useBottomSheetInternal).mockReturnValue(null);
    }
  });

  it("leaves Android to its ripple, with no lift on top", () => {
    const feedback = feedbackOn("android");
    expect(feedback.ripple.color).toMatch(/^rgba\(245,245,245,0\.12\)$/);
    expect(feedback.lift(true)).toBeNull();
  });
});

// React Native paints the ripple as the row's own background, which the row's
// radius and `overflow` never clip; only a parent's clip rounds it. So the
// ripple-bearing Pressable sits inside a View with the row's radius and
// `overflow: "hidden"`, and the row's margins move onto that View so the row
// is laid out where it was.
describe("PressableRow", () => {
  function renderRow(
    props: Partial<React.ComponentProps<typeof PressableRow>>,
  ) {
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

  // A flexing row (the chat home's section heading, beside its filter button)
  // must size the clip, the parent's real child; on the inner row alone the
  // clip shrank to its content and the heading's name drew at zero width.
  it("sizes the clip by the row's flex, and lets the row fill the clip", () => {
    const row = renderRow({ style: { flex: 1, flexDirection: "row" } });
    const clip = row.parent?.props.style;
    expect(clip).toEqual({ overflow: "hidden", flex: 1 });
    const resting = row.props.style({ pressed: false })[0];
    expect(resting).toEqual({ flexGrow: 1, flexDirection: "row" });
  });

  it("lifts on iOS while held, and to the step above for a card", () => {
    // The suite's react-native stub runs as iOS.
    expect(renderRow({}).props.style({ pressed: true })).toContainEqual({
      backgroundColor: signetDarkTokens.color.surface.surface1,
    });
    expect(
      renderRow({ onCard: true }).props.style({ pressed: true }),
    ).toContainEqual({
      backgroundColor: signetDarkTokens.color.surface.card,
    });
  });

  it("lifts a control on the input step to the step above its own fill", () => {
    // A filter chip is filled with `surface1`: the page lift would paint it
    // its own colour and show nothing.
    expect(
      renderRow({ onControl: true }).props.style({ pressed: true }),
    ).toContainEqual({
      backgroundColor: signetDarkTokens.color.surface.card,
    });
    // A chip on a card is filled with `card`, so it lifts one more.
    expect(
      renderRow({ onControl: true, onCard: true }).props.style({
        pressed: true,
      }),
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

describe("ListRow long press (#3938)", () => {
  it("passes the long press through and names it for a screen reader", () => {
    const onLongPress = vi.fn();
    const row = pressable({
      label: "Bylaws",
      onPress: vi.fn(),
      onLongPress,
      longPressLabel: "Delete document",
    });
    expect(row.props.onLongPress).toBe(onLongPress);
    expect(row.props.accessibilityActions).toEqual([
      { name: "longpress", label: "Delete document" },
    ]);
    row.props.onAccessibilityAction({
      nativeEvent: { actionName: "longpress" },
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("offers no action while the row is busy", () => {
    const row = pressable({
      label: "Bylaws",
      onPress: vi.fn(),
      onLongPress: vi.fn(),
      longPressLabel: "Delete document",
      busy: true,
    });
    expect(row.props.accessibilityActions).toBeUndefined();
    expect(row.props.onAccessibilityAction).toBeUndefined();
  });
});
