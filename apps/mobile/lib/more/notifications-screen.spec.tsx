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

/** What the inbox query returns; a spec sets `data` for an inbox of its own. */
const inbox = vi.hoisted(() => ({ data: null as unknown[] | null }));

/** The inbox query's `refetch`, kept stable so a spec can assert on a pull. */
const refetchInbox = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useNotifications: () => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data: inbox.data ?? NOTIFICATIONS,
    refetch: refetchInbox,
  }),
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn() }),
}));

import { signetDarkTokens } from "@repo/theme/signet";
import { NotificationsGlyph } from "@/components/more/more-glyphs";
import { EmptyState } from "@/components/state-block";
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
 * #3385. A pull on the inbox refetches the notifications it lists, joining a
 * refetch already in flight rather than cancelling it.
 */
describe("Notifications pull to refresh (#3385)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    refetchInbox.mockClear();
  });

  it("refreshes the notifications on a pull (#3385)", async () => {
    // The control is a prop of the shell's scroll view, not a rendered
    // child, so the pull is its `refresh`.
    const scroll = render().root.findByType(
      "ScrollView" as unknown as React.ElementType,
    );
    const control = scroll.props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;

    await act(async () => {
      await control.props.refresh();
    });

    expect(refetchInbox).toHaveBeenCalledTimes(1);
    expect(refetchInbox).toHaveBeenCalledWith({ cancelRefetch: false });
  });
});

/**
 * s14's empty inbox: the bell the inbox opens from, drawn in the accent, and
 * the title alone. A line saying chapter activity shows up here would only
 * restate what the screen is for (writing.md §4, as amended 2026-11-05).
 */
describe("Notifications empty inbox", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    inbox.data = null;
  });

  it("draws the bell and a title, with no line under it", () => {
    inbox.data = [];
    const tree = render();
    const empty = tree.root.findByType(EmptyState);

    expect(empty.props.glyph).toBe(NotificationsGlyph);
    expect(empty.props.title).toBe("You're all caught up");
    expect(empty.props.body).toBeUndefined();
    expect(empty.findAllByType(NotificationsGlyph)).toHaveLength(1);
    expect(
      empty
        .findAll((node) => (node.type as unknown as string) === "Text")
        .map((node) => node.props.children),
    ).toEqual(["You're all caught up"]);
  });
});

/**
 * Every list row answers a press the same way (`usePressFeedback`): a ripple
 * on Android, a lift on iOS. A read row recedes through its title's colour,
 * not an opacity, so its press lift is as strong as an unread row's.
 */
describe("Notification row press feedback", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
  });

  function renderRow(isUnread: boolean, body: string | null = null) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NotificationListRow
            row={{
              id: "n1",
              title: "Dues reminder",
              body,
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

  function textStyle(
    row: ReturnType<typeof renderRow>,
    text: string,
  ): Record<string, unknown> {
    const node = row.find(
      (candidate) =>
        (candidate.type as unknown as string) === "Text" &&
        candidate.props.children === text,
    );
    return Object.assign({}, ...[node.props.style].flat(Infinity));
  }

  // s14 draws a read notification receding, not gone. The title drops to the
  // body's tone; nothing on the row fades, so the press lift behind a read
  // row stays full strength.
  it("recedes a read row's title by colour, with no opacity anywhere", () => {
    const { foreground, mutedForeground } = signetDarkTokens.color.text;
    expect(textStyle(renderRow(true), "Dues reminder").color).toBe(foreground);

    const read = renderRow(false);
    expect(textStyle(read, "Dues reminder").color).toBe(mutedForeground);
    expect(JSON.stringify(read.props.style({ pressed: false }))).not.toContain(
      "opacity",
    );
    expect(
      read.findAll((node) =>
        JSON.stringify([node.props.style].flat(Infinity)).includes('"opacity"'),
      ),
    ).toHaveLength(0);
  });

  // The owner's design review, 2026-11-04: the body was the 16pt body role
  // under a 14pt title, so the second line outsized the headline.
  it("sets the body at the title's size, regular weight, two lines at most", () => {
    const row = renderRow(
      true,
      "Spring dues are open for every active member.",
    );
    const title = textStyle(row, "Dues reminder");
    const body = textStyle(
      row,
      "Spring dues are open for every active member.",
    );

    expect(body.fontSize).toBe(title.fontSize);
    expect(body.fontFamily).not.toBe(title.fontFamily);
    expect(body.lineHeight).toBe(title.lineHeight);
    const bodyNode = row.find(
      (node) =>
        (node.type as unknown as string) === "Text" &&
        node.props.children === "Spring dues are open for every active member.",
    );
    expect(bodyNode.props.numberOfLines).toBe(2);
    // The two-line cut is visual only: a screen reader hears all of it.
    expect(row.props.accessibilityLabel).toBe(
      "Dues reminder. Spring dues are open for every active member.",
    );
  });

  it("centres the unread dot on the title's first line", () => {
    const row = renderRow(true);
    const title = textStyle(row, "Dues reminder");
    const [dot] = row.children as ReactTestRenderer["root"][];
    const dotStyle = Object.assign(
      {},
      ...[dot!.props.style].flat(Infinity),
    ) as Record<string, number>;

    expect(dotStyle.marginTop * 2 + dotStyle.height).toBe(title.lineHeight);
  });
});
