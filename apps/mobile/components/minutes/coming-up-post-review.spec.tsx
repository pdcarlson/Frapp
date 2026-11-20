/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComingUpReviewRow } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  rows: { current: null as unknown[] | null },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#2B2009",
  }),
}));

vi.mock("@repo/hooks", () => ({
  useComingUpPostReview: (_id: string, _content: unknown, enabled: boolean) =>
    enabled ? mocks.rows.current : null,
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-marcus" ? "Marcus Hale" : null),
  }),
  useTrackComingUpDates: () => ({
    mutateAsync: mocks.track,
    isPending: false,
  }),
}));

import { ComingUpPostReview } from "./coming-up-post-review";

const row = (over: Partial<ComingUpReviewRow>): ComingUpReviewRow => ({
  index: 0,
  date: "2099-11-21",
  text: "Dues due to the treasurer",
  kind: "task",
  title: "Dues due to the treasurer",
  description: null,
  assigneeId: "u-marcus",
  suggestion: null,
  checked: true,
  ...over,
});

function render(onDone = vi.fn(), onTracked = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ComingUpPostReview
          meetingId="m-1"
          content={{ dates: [], action_items: [] }}
          viewerId="u-me"
          onDone={onDone}
          onTracked={onTracked}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const box = (tree: ReactTestRenderer, label: RegExp) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityRole === "checkbox" &&
      typeof node.props.onPress === "function" &&
      label.test(String(node.props.accessibilityLabel)),
  );

function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.findAll((child) => child.props?.children === label).length > 0,
  );
  return found[found.length - 1]!;
}

describe("ComingUpPostReview (phone)", () => {
  beforeEach(() => {
    mocks.track.mockReset().mockResolvedValue({ made: 2, failed: 0 });
    mocks.rows.current = [
      row({}),
      row({
        index: 1,
        date: "2099-12-02",
        title: "Philanthropy committee reports back",
        assigneeId: null,
        checked: false,
      }),
      row({
        index: 2,
        date: "2099-12-06",
        kind: "calendar",
        title: "Winter Formal",
        assigneeId: null,
        checked: false,
      }),
    ];
  });

  it("offers web's lines, ticked where the minutes name an owner", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Track the dates from this meeting?");
    expect(text).toContain("Already on the calendar");
    expect(
      box(tree, /Task for Marcus Hale/).props.accessibilityState.checked,
    ).toBe(true);
    expect(box(tree, /Task for you/).props.accessibilityState.checked).toBe(
      false,
    );
    expect(text).toContain("Track 1");
  });

  it("makes what is left ticked, and says so", async () => {
    const onTracked = vi.fn();
    const tree = render(vi.fn(), onTracked);
    act(() => box(tree, /Task for you/).props.onPress());
    await act(async () => {
      button(tree, "Track 2").props.onPress();
    });
    expect(mocks.track).toHaveBeenCalledWith({
      rows: [mocks.rows.current![0], mocks.rows.current![1]],
      viewerId: "u-me",
    });
    expect(onTracked).toHaveBeenCalledWith("Made 2 tasks");
  });

  it("closes without a word when no date needs a task", () => {
    mocks.rows.current = [mocks.rows.current![2]!];
    const onDone = vi.fn();
    const tree = render(onDone);
    expect(onDone).toHaveBeenCalled();
    expect(screenText(tree)).not.toContain("Track the dates");
  });
});
