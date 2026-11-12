/** @vitest-environment jsdom */
import { backRowView } from "@/test/back-row";
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, typeRole } from "@/lib/theme";
import { screenText, textHeadings } from "@/test/screen-text";
import { expectBackRow } from "@/test/back-row";
import { BACK_TO_YOU } from "./back-row";
import { floatingScreenLayout } from "@/lib/floating-chrome";

// The back row paints the chapter accent; its value is back-row.spec.tsx's.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));
import { ScreenShell, StickyHeader } from "./screen-shell";

/**
 * #2485 — the tab layout draws no navigator header, so the shell is the whole
 * top of every screen that uses it. It has to take the status-bar inset the
 * header used to absorb, and its title is the only heading it draws.
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

describe("ScreenShell (#2485)", () => {
  it("takes the top safe-area inset, which no navigator header absorbs now", () => {
    const tree = render(
      <ScreenShell title="Tasks">
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

  it("marks the title as the one heading the shell draws", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(textHeadings(tree).map((node) => node.props.children)).toEqual([
      "Tasks",
    ]);
  });

  it("draws the title in the board's headline role, a level above a card's title", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <Text>Body</Text>
      </ScreenShell>,
    );
    const [title] = textHeadings(tree);

    // canvas-screens.dc.html draws s06, s08–s14 and s16's titles 24/700 at -.3px.
    // typeRole carries the 700 weight as Figtree's bold face.
    expect(title!.props.style).toEqual(
      expect.objectContaining({
        ...typeRole(getSignetTokens().typography.role.headline),
        fontSize: 24,
        letterSpacing: -0.3,
      }),
    );
  });

  it("draws a title mark on the title's row, ahead of the title", () => {
    const tree = render(
      <ScreenShell title="Tau Nu" titleMark={<View testID="mark" />}>
        <View />
      </ScreenShell>,
    );
    const [title] = textHeadings(tree);
    const row = title!.parent!;
    const children = row.children as ReactTestRenderer["root"][];

    const markAt = children.findIndex(
      (child) => child.findAllByProps({ testID: "mark" }).length > 0,
    );
    expect(markAt).toBeGreaterThanOrEqual(0);
    expect(markAt).toBeLessThan(children.indexOf(title!));
  });
});

/**
 * #3023. The shell draws no line under the title unless a screen passes one.
 * The board draws one only on s07, so Event details is the caller that does:
 * its subtitle is the event's time.
 */
describe("ScreenShell subtitle (#3023)", () => {
  it("draws nothing under the title when no subtitle is passed", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(screenText(tree)).toBe("Tasks\nBody");
  });

  it("draws a passed subtitle under the title", () => {
    const tree = render(
      <ScreenShell title="Rush dinner" subtitle="Tonight, 7:00 – 9:00 PM">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(screenText(tree)).toBe("Rush dinner\nTonight, 7:00 – 9:00 PM\nBody");
  });
});

/**
 * #3022. A screen reached from another one passes `back`, and the shell draws
 * the board's `‹ You` row above the title. A tab's own screen passes none.
 */
describe("ScreenShell back row (#3022)", () => {
  it("draws no back row when none is passed", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(screenText(tree)).not.toContain("‹");
  });

  it("draws the passed back row above the title, and it goes there", () => {
    const tree = render(
      <ScreenShell back={BACK_TO_YOU} title="Dues">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(screenText(tree)).toBe("You\nDues\nBody");
    expectBackRow(tree, "You", "/you");
  });
});

/** #3387. s15's Edit sits at the far end of its back row, as the board draws it. */
describe("ScreenShell back-row action (#3387)", () => {
  it("draws the action on the back row, after `‹ You`", () => {
    const tree = render(
      <ScreenShell
        back={BACK_TO_YOU}
        backAction={<Text testID="edit">Edit</Text>}
        title="Profile"
      >
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(screenText(tree)).toBe("You\nEdit\nProfile\nBody");
    // One view holds `‹ You` and the action side by side: the back row's own.
    const row = backRowView(tree);
    const [action] = tree.root.findAllByProps({ testID: "edit" });
    expect(row.findAll((node) => node === action)).toHaveLength(1);
    expect(
      row.findAll((node) => node.props.accessibilityLabel === "Back to You")
        .length,
    ).toBeGreaterThan(0);
    expect(row.props.style).toMatchObject({ flexDirection: "row" });
  });
});

describe("ScreenShell refresh (#3385)", () => {
  it("draws a refresh control on its scroll view only when given a refresh", () => {
    const refreshControl = (tree: ReactTestRenderer) =>
      tree.root.findByType("ScrollView" as unknown as React.ElementType).props
        .refreshControl;

    const without = render(
      <ScreenShell title="Tasks">
        <View />
      </ScreenShell>,
    );
    const withRefresh = render(
      <ScreenShell title="Tasks" refresh={() => Promise.resolve()}>
        <View />
      </ScreenShell>,
    );

    expect(refreshControl(without)).toBeUndefined();
    expect(refreshControl(withRefresh)).toBeTruthy();
  });
});

/**
 * Pinned headings (owner 2026-11-07): Chat home's section headings stay at the
 * top while their rows scroll under them. React Native pins only direct
 * children of the scroll view, so the shell opens fragments and arrays and
 * pins each `StickyHeader` among them; the title block, child 0, scrolls away.
 */
describe("ScreenShell sticky headers", () => {
  const scrollView = (tree: ReactTestRenderer) =>
    tree.root.findByType("ScrollView" as unknown as React.ElementType);

  it("pins nothing on a screen without a StickyHeader", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <View />
      </ScreenShell>,
    );

    expect(scrollView(tree).props.stickyHeaderIndices).toBeUndefined();
  });

  it("pins each StickyHeader, counting through fragments, arrays and gaps", () => {
    const sections = ["a", "b"];
    const tree = render(
      <ScreenShell title="Chat">
        <View />
        {null}
        <>
          {sections.flatMap((key) => [
            <StickyHeader key={`${key}:heading`}>
              <Text>{key}</Text>
            </StickyHeader>,
            <View key={`${key}:rows`} />,
          ])}
          <View />
        </>
      </ScreenShell>,
    );

    // 0 is the title, 1 the first View, then heading a (2), rows a (3),
    // heading b (4), rows b (5), the trailing View (6).
    expect(scrollView(tree).props.stickyHeaderIndices).toEqual([2, 4]);
  });
});

/**
 * The floating chrome. Content scrolls under the glass bar, so the shell pads
 * its scroll end clear of it, and of the create button above it when there is
 * one; the create button comes first in the tree, so a screen reader reaches
 * it without swiping past every row.
 */
describe("ScreenShell over the floating tab bar", () => {
  function renderInTabs(element: React.ReactElement) {
    return render(
      floatingScreenLayout({
        route: { name: "tasks" },
        navigation: { addListener: () => () => {} },
        children: element,
      }),
    );
  }
  const scrollEnd = (tree: ReactTestRenderer) => {
    const scroll = tree.root.find(
      (node) => (node.type as unknown) === "ScrollView",
    );
    return Object.assign(
      {},
      ...[scroll.props.contentContainerStyle].flat(Infinity),
    ).paddingBottom;
  };
  const lg = getSignetTokens("dark").spacing.lg;

  it("ends its scroll clear of the bar", () => {
    const tree = renderInTabs(
      <ScreenShell title="Events">
        <Text>Body</Text>
      </ScreenShell>,
    );

    // The safe-area mock's inset is 0: the bar's top is 12 + 62 up, plus 14.
    expect(scrollEnd(tree)).toBe(lg + 12 + 62 + 14);
  });

  it("clears the create button too, and puts it first in reading order", () => {
    const tree = renderInTabs(
      <ScreenShell
        title="Tasks"
        createAction={{ label: "New task", onPress: vi.fn() }}
      >
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(scrollEnd(tree)).toBe(lg + 12 + 62 + 14 + 56 + 14);
    const labels = tree.root
      .findAll((node) => typeof node.props.accessibilityLabel === "string")
      .map((node) => node.props.accessibilityLabel);
    expect(labels[0]).toBe("New task");
  });

  it("pads nothing extra outside the tabs", () => {
    const tree = render(
      <ScreenShell title="Tasks">
        <Text>Body</Text>
      </ScreenShell>,
    );

    expect(scrollEnd(tree)).toBe(lg);
  });

  it("pins the back row inside the safe area's content, reading no insets", () => {
    const tree = render(
      <ScreenShell back={BACK_TO_YOU} title="Dues">
        <Text>Body</Text>
      </ScreenShell>,
    );
    const pin = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Object.assign({}, ...[node.props.style].flat(Infinity)).position ===
          "absolute",
    );

    // Its parent is a plain View inside the SafeAreaView, so the pin starts
    // where the content does, under an offline banner as much as a notch.
    let host = pin.parent;
    while (host && typeof host.type !== "string") host = host.parent;
    expect(host?.type).toBe("View");
    expect(pin.props.style).toMatchObject({
      top: getSignetTokens("dark").spacing.xs,
    });
  });
});
