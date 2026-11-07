/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { StyleSheet } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

// The row itself takes no chapter accent, but `useChapterBranding` reaches
// `useCurrentChapter` and would drag the API client and a QueryClient into a
// spec about styling. The accent value is covered by `lib/chapter-branding.spec.tsx`.
vi.mock("@/lib/chapter-branding", () => ({
  // A purple stand-in, so a chip painted house gold fails instead of passing.
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { TaskRow } from "./task-row";
import type { TaskRowModel } from "@/lib/tasks/board";

/**
 * These pin the four rules that are cheapest to break by copying a neighbouring
 * row component, and one of them is a literal acceptance criterion of #995:
 * an overdue date is `semantic.destructiveText` (danger's AA lift), never the
 * mention red that `foundations.md:67` reserves for direct address.
 */

const NOW = new Date(2026, 7, 17, 12, 0, 0, 0);

function row(overrides: Partial<TaskRowModel> = {}): TaskRowModel {
  return {
    id: "t1",
    title: "Submit ride-share list",
    description: null,
    createdBy: null,
    storedStatus: "TODO",
    displayStatus: "TODO",
    dueDate: "2026-08-18",
    completedAt: null,
    confirmedAt: null,
    pointReward: 5,
    pointsAwarded: false,
    isDone: false,
    isOverdue: false,
    ...overrides,
  };
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/** Every rendered string, flattened out of the tree. */
function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as never, { deep: true })
    .flatMap((node) =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === "string",
      ),
    );
}

/** The resolved style of the first node whose text matches. */
function styleOfText(tree: ReactTestRenderer, needle: string) {
  const node = tree.root
    .findAll(
      (candidate) =>
        typeof candidate.props?.children === "string" &&
        (candidate.props.children as string).includes(needle),
      { deep: true },
    )
    .at(-1);
  return flatten(node?.props?.style);
}

describe("TaskRow — the overdue colour", () => {
  it("draws an urgent due date in semantic.destructiveText, not the mention red", () => {
    const tree = render(
      <TaskRow
        row={row({
          dueDate: "2026-08-15",
          displayStatus: "OVERDUE",
          isOverdue: true,
        })}
        now={NOW}
        onToggle={() => {}}
      />,
    );

    const style = styleOfText(tree, "Overdue by");
    expect(style.color).toBe(signetDarkTokens.color.semantic.destructiveText);
    expect(style.color).not.toBe(signetDarkTokens.color.semantic.mention);
  });

  it("leaves a distant due date on the calm muted role", () => {
    const tree = render(
      <TaskRow
        row={row({ dueDate: "2026-09-30" })}
        now={NOW}
        onToggle={() => {}}
      />,
    );

    expect(styleOfText(tree, "Due Sep 30").color).toBe(
      signetDarkTokens.color.text.mutedForeground,
    );
  });
});

// A task row is a list row, so it answers a press as every list row does
// (`usePressFeedback`, through `PressableRow`): a ripple on Android and a lift
// to the card step on iOS. Never the fade it used to give. Since 2026-11-05 the
// row sits flush on the floor (web's list grammar), so it is square and lifts
// from the floor, not from a card of its own.
describe("TaskRow — press feedback", () => {
  it("ripples on Android and lifts floor to card on iOS, never fading", () => {
    const tree = render(<TaskRow row={row()} now={NOW} onOpen={() => {}} />);
    const pressable = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    // The suite's react-native stub runs as iOS.
    const held = flatten(pressable.props.style({ pressed: true }));
    const resting = flatten(pressable.props.style({ pressed: false }));

    expect(pressable.props.android_ripple?.color).toMatch(/^rgba\(/);
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.card);
    expect(held).not.toHaveProperty("opacity");
    expect(resting).not.toHaveProperty("backgroundColor");
    expect(resting).not.toHaveProperty("borderRadius");
  });

  it("draws a hairline above every row but the first in its group", () => {
    const first = render(
      <TaskRow row={row()} now={NOW} onOpen={() => {}} isFirst />,
    );
    const next = render(<TaskRow row={row()} now={NOW} onOpen={() => {}} />);
    const style = (tree: typeof first) =>
      flatten(
        tree.root
          .find((node) => (node.type as unknown) === "Pressable")
          .props.style({ pressed: false }),
      );
    expect(style(first)).not.toHaveProperty("borderTopWidth");
    expect(style(next).borderTopColor).toBe(
      signetDarkTokens.color.border.hairline,
    );
  });
});

// The Tasks screen drops `onToggle` while a row's PATCH sequence runs, so the
// row in flight is the plain branch. It still has to look and read in progress,
// not merely disabled: dimmed, and `busy` to a screen reader.
describe("TaskRow — a row in flight", () => {
  it("dims and reads busy on the plain branch the screen gives it", () => {
    const tree = render(<TaskRow row={row()} now={NOW} isPending />);
    const node = tree.root.find(
      (candidate) => candidate.props?.accessibilityRole === "checkbox",
    );
    expect(node.type as unknown).toBe("View");
    expect(node.props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    expect(flatten(node.props.style).opacity).toBe(0.8);
  });

  it("dims and reads busy as a pressable row too", () => {
    const tree = render(
      <TaskRow row={row()} now={NOW} isPending onOpen={() => {}} />,
    );
    const pressable = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(pressable.props.accessibilityState).toMatchObject({ busy: true });
    // The dim is the row's own: `splitRowStyle` keeps opacity on the Pressable.
    const resting = flatten(pressable.props.style({ pressed: false }));
    expect(resting.opacity).toBe(0.8);
    expect(flatten(pressable.parent!.props.style)).not.toHaveProperty(
      "opacity",
    );
  });

  it("is neither dimmed nor busy at rest", () => {
    const tree = render(<TaskRow row={row()} now={NOW} onOpen={() => {}} />);
    const pressable = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(pressable.props.accessibilityState).toMatchObject({ busy: false });
    expect(
      flatten(pressable.props.style({ pressed: false })),
    ).not.toHaveProperty("opacity");
  });
});

describe("TaskRow — the completed row", () => {
  const done = row({
    storedStatus: "COMPLETED",
    displayStatus: "COMPLETED",
    isDone: true,
    completedAt: new Date(2026, 7, 11, 9).toISOString(),
    pointsAwarded: true,
    pointReward: 15,
  });

  it("takes no press handler at all", () => {
    // The server allows COMPLETED no transition; a Pressable that swallowed the
    // tap would read as broken rather than as finished.
    const tree = render(<TaskRow row={done} now={NOW} />);
    const pressables = tree.root.findAll(
      (node) => typeof node.props?.onPress === "function",
      { deep: true },
    );
    expect(pressables).toHaveLength(0);
  });

  it("is dimmed and struck through once confirmed", () => {
    const tree = render(<TaskRow row={done} now={NOW} />);
    expect(texts(tree)).toContain("Confirmed");
    expect(styleOfText(tree, "Submit ride-share list").textDecorationLine).toBe(
      "line-through",
    );
    const container = flatten(
      tree.root.findAllByType("View" as never)[0]?.props.style,
    );
    expect(Number(container.opacity)).toBeLessThan(1);
  });

  it("marks an awarded reward in the success role", () => {
    const tree = render(<TaskRow row={done} now={NOW} />);
    expect(texts(tree)).toContain("+15 ✓");
    expect(styleOfText(tree, "+15 ✓").color).toBe(
      signetDarkTokens.color.semantic.success,
    );
  });
});

describe("TaskRow — the points chip", () => {
  it("draws nothing for a task carrying no reward", () => {
    const tree = render(
      <TaskRow
        row={row({ pointReward: null })}
        now={NOW}
        onToggle={() => {}}
      />,
    );
    expect(texts(tree).some((text) => text.startsWith("+"))).toBe(false);
  });

  it("keeps a completed-but-unconfirmed reward on the accent chip", () => {
    const tree = render(
      <TaskRow
        row={row({
          storedStatus: "COMPLETED",
          isDone: true,
          pointsAwarded: false,
          pointReward: 15,
        })}
        now={NOW}
      />,
    );
    expect(texts(tree)).toContain("+15");
    expect(styleOfText(tree, "+15").color).toBe("#CB9FFF");
  });
});

// foundations.md §6 "Where the accent goes" (2026-11-05): finished work is the
// quietest thing on a list, so a done box is a muted neutral fill and check,
// and a started box a neutral outline, never the chapter accent.
describe("TaskRow — the checkbox stays off the accent", () => {
  function box(tree: ReactTestRenderer): Record<string, unknown> {
    const node = tree.root.find(
      (candidate) =>
        (candidate.type as unknown) === "View" &&
        flatten(candidate.props.style).width === signetDarkTokens.spacing.xl &&
        flatten(candidate.props.style).borderRadius ===
          signetDarkTokens.radius.chip,
    );
    return flatten(node.props.style);
  }

  it("fills a done box with the raised neutral and a muted check", () => {
    const tree = render(
      <TaskRow
        row={row({
          storedStatus: "COMPLETED",
          isDone: true,
          pointReward: null,
        })}
        now={NOW}
      />,
    );
    const style = box(tree);
    expect(style.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(style.borderColor).toBe(signetDarkTokens.color.border.input);
    const flat = JSON.stringify(tree.toJSON());
    expect(flat).toContain(signetDarkTokens.color.text.mutedForeground);
    expect(flat).not.toContain("#CB9FFF");
    expect(flat).not.toContain(signetDarkTokens.color.gold.onHouse);
  });

  it("outlines a started box in a neutral, with no fill", () => {
    const tree = render(
      <TaskRow
        row={row({ storedStatus: "IN_PROGRESS", pointReward: null })}
        now={NOW}
        onToggle={() => {}}
      />,
    );
    const style = box(tree);
    expect(style.borderColor).toBe(signetDarkTokens.color.text.mutedForeground);
    expect(style.backgroundColor).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).not.toContain("#CB9FFF");
  });
});

// Owner audit 2026-11-06, P6.1: the row said "Done" where web said "Awaiting
// confirmation", and a stray tap anywhere on it completed the task for good.
describe("TaskRow — two targets and the shared words", () => {
  const waiting = row({
    storedStatus: "COMPLETED",
    displayStatus: "COMPLETED",
    isDone: true,
    completedAt: new Date(2026, 7, 16, 9).toISOString(),
  });

  it("says a completion is waiting on an officer, not done, and doesn't dim it", () => {
    const tree = render(<TaskRow row={waiting} now={NOW} onOpen={() => {}} />);
    expect(texts(tree)).toContain("Waiting on an officer");
    expect(texts(tree).some((text) => text.startsWith("Done"))).toBe(false);
    const pressable = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(
      StyleSheet.flatten(pressable.props.style({ pressed: false })),
    ).not.toHaveProperty("opacity");
  });

  it("opens the task on a row tap and changes it only from the box", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const tree = render(
      <TaskRow row={row()} now={NOW} onOpen={onOpen} onToggle={onToggle} />,
    );
    const [rowPress, boxPress] = tree.root.findAll(
      (node) => (node.type as unknown) === "Pressable",
    );
    act(() => rowPress!.props.onPress());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    act(() => boxPress!.props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("gives a screen reader the box's move as a named action on the row", () => {
    const onToggle = vi.fn();
    const tree = render(
      <TaskRow row={waiting} now={NOW} onOpen={() => {}} onToggle={onToggle} />,
    );
    const rowPress = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    expect(rowPress.props.accessibilityActions).toEqual([
      { name: "toggle", label: "Mark not done" },
    ]);
    act(() =>
      rowPress.props.onAccessibilityAction({
        nativeEvent: { actionName: "toggle" },
      }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
