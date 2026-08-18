/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

// The row itself takes no chapter accent, but `useChapterBranding` reaches
// `useCurrentChapter` and would drag the API client and a QueryClient into a
// spec about styling. The accent value is covered by `lib/chapter-branding.spec.tsx`.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    logoUrl: null,
    chapterName: null,
  }),
}));

import { TaskRow } from "./task-row";
import type { TaskRowModel } from "@/lib/tasks/board";

/**
 * These pin the four rules that are cheapest to break by copying a neighbouring
 * row component, and one of them is a literal acceptance criterion of #995:
 * an overdue date is `semantic.destructive`, never the mention red that
 * `foundations.md:67` reserves for direct address.
 */

const NOW = new Date(2026, 7, 17, 12, 0, 0, 0);

function row(overrides: Partial<TaskRowModel> = {}): TaskRowModel {
  return {
    id: "t1",
    title: "Submit ride-share list",
    storedStatus: "TODO",
    displayStatus: "TODO",
    dueDate: "2026-08-18",
    completedAt: null,
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
  it("draws an urgent due date in semantic.destructive, not the mention red", () => {
    const tree = render(
      <TaskRow
        row={row({ dueDate: "2026-08-15", displayStatus: "OVERDUE", isOverdue: true })}
        now={NOW}
        onToggle={() => {}}
      />,
    );

    const style = styleOfText(tree, "Overdue by");
    expect(style.color).toBe(signetDarkTokens.color.semantic.destructive);
    expect(style.color).not.toBe(signetDarkTokens.color.semantic.mention);
  });

  it("leaves a distant due date on the calm muted role", () => {
    const tree = render(
      <TaskRow row={row({ dueDate: "2026-09-30" })} now={NOW} onToggle={() => {}} />,
    );

    expect(styleOfText(tree, "Due Sep 30").color).toBe(
      signetDarkTokens.color.text.mutedForeground,
    );
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

  it("is dimmed and struck through", () => {
    const tree = render(<TaskRow row={done} now={NOW} />);
    expect(styleOfText(tree, "Submit ride-share list").textDecorationLine).toBe(
      "line-through",
    );
    const container = flatten(tree.root.findAllByType("View" as never)[0]?.props.style);
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
      <TaskRow row={row({ pointReward: null })} now={NOW} onToggle={() => {}} />,
    );
    expect(texts(tree).some((text) => text.startsWith("+"))).toBe(false);
  });

  it("keeps a completed-but-unconfirmed reward on the gold chip", () => {
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
    expect(styleOfText(tree, "+15").color).toBe(
      signetDarkTokens.color.gold.askText,
    );
  });
});
