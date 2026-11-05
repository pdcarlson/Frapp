/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s19 splits its rows into TODAY and EARLIER by "now", and a tab
 * screen is never unmounted. React Query's structural sharing keeps the data
 * reference stable across a refetch that returns the same rows, so a
 * `new Date()` read once would leave an 11:47 PM row under TODAY at 12:10 AM.
 * This pins that the split moves on the shared ticking clock.
 *
 * It renders `app/(tabs)/notifications.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors: CI runs this suite in UTC and in Asia/Tokyo, and
// "today" is the member's own calendar day.
const CREATED_AT = new Date(2026, 8, 30, 23, 47);
const MOUNTED_AT = new Date(2026, 8, 30, 23, 59, 30);

const NOTIFICATIONS = [
  {
    id: "notif-1",
    title: "Dues reminder",
    body: "Spring dues are open.",
    created_at: CREATED_AT.toISOString(),
    read_at: null,
    data: null,
  },
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useNotifications: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: NOTIFICATIONS,
    refetch: vi.fn(),
  }),
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn() }),
}));

import { signetDarkTokens } from "@repo/theme/signet";
import NotificationsScreen, {
  NotificationListRow,
} from "@/app/(tabs)/notifications";

/**
 * Unmounted in `afterEach`, not at the end of each test: the shared clock is
 * module state, and a failed test's tree left subscribed would hold it at that
 * test's time for the next one.
 */
const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NotificationsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe("Notifications clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOUNTED_AT);
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("moves a row from TODAY to EARLIER at midnight while the screen is up", () => {
    const tree = render();
    expect(screenText(tree)).toContain("Dues reminder");
    expect(screenText(tree)).toContain("TODAY");
    expect(screenText(tree)).not.toContain("EARLIER");

    // Past midnight, on the clock's own tick: no remount, no refetch.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });

    expect(screenText(tree)).toContain("EARLIER");
    expect(screenText(tree)).not.toContain("TODAY");
  });
});

/**
 * #3022. The board draws `‹ More` on s14, but the inbox opens from the bell on
 * Chat home since #3362, so its way back is Chat.
 */
describe("Notifications back row (#3022)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
  });

  it("draws ‹ Chat, the screen the bell opens it from", () => {
    expectBackRow(render(), "Chat", "/");
  });
});

/**
 * Every list row answers a press the same way (`usePressFeedback`): a ripple
 * on Android, a lift on iOS. A read row recedes through its text, not the
 * whole row, so its press lift is as strong as an unread row's.
 */
describe("Notification row press feedback", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
  });

  function renderRow(isUnread: boolean) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NotificationListRow
            row={{
              id: "n1",
              title: "Dues reminder",
              body: null,
              categoryLabel: "Dues",
              href: "/dues",
              time: "4:00 PM",
              createdAt: CREATED_AT.toISOString(),
              isUnread,
            }}
            onPress={vi.fn()}
          />
        </FrappThemeProvider>,
      );
    });
    mounted.push(tree);
    return tree.root.find(
      (node) => (node.type as unknown as string) === "Pressable",
    );
  }

  it("ripples on Android and lifts on iOS, never fading the row", () => {
    for (const isUnread of [true, false]) {
      const row = renderRow(isUnread);
      expect(row.props.android_ripple?.color).toMatch(/^rgba\(/);
      // The suite's react-native stub runs as iOS.
      const held = row.props.style({ pressed: true });
      expect(held).toContainEqual({
        backgroundColor: signetDarkTokens.color.surface.card,
      });
      expect(JSON.stringify(held)).not.toContain("opacity");
    }
  });

  // s14 draws a read notification receding, not gone: its text block dims,
  // and only the text block, so the press lift behind it stays full strength.
  it("dims a read row's text, and only an unread row's stays full", () => {
    function textBlockOpacity(isUnread: boolean) {
      const row = renderRow(isUnread);
      const title = row.find(
        (node) =>
          (node.type as unknown as string) === "Text" &&
          node.props.children === "Dues reminder",
      );
      const block = Object.assign(
        {},
        ...[title.parent!.props.style].flat(Infinity),
      ) as Record<string, unknown>;
      return block.opacity;
    }

    expect(textBlockOpacity(true)).toBeUndefined();
    expect(Number(textBlockOpacity(false))).toBeLessThan(1);
    expect(
      JSON.stringify(renderRow(false).props.style({ pressed: false })),
    ).not.toContain("opacity");
  });
});
