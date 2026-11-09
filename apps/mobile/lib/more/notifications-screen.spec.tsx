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
import { useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * #2101. s19 splits its rows into TODAY and EARLIER by "now", and the
 * screen can stay up overnight. React Query's structural sharing keeps the data
 * reference stable across a refetch that returns the same rows, so a
 * `new Date()` read once would leave an 11:47 PM row under TODAY at 12:10 AM.
 * This pins that the split moves on the shared ticking clock.
 *
 * It renders `app/(app)/notifications.tsx` but lives here: a spec under
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

/** The read receipt the screen sends; stable so a spec can assert on a tap. */
const markRead = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));

/** `POST /v1/notifications/read`, the one request behind Mark all read. */
const markAll = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

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
  useMarkNotificationRead: () => markRead,
  useMarkNotificationsRead: () => markAll,
}));

import { signetDarkTokens } from "@repo/theme/signet";
import { InlineNote } from "@/components/inline-note";
import NotificationsScreen, {
  NotificationListRow,
} from "@/app/(app)/notifications";

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
 * A tapped notification pushes a screen, but pops down to a tab, so the inbox
 * never stacks a second tab bar over itself (`spec/ui/mobile/navigation.md`
 * § Going back).
 */
describe("Notifications row target", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    inbox.data = null;
  });

  const read = (id: string, target: string) => ({
    id,
    title: `About ${target}`,
    body: null,
    created_at: CREATED_AT.toISOString(),
    read_at: CREATED_AT.toISOString(),
    data: { target: { screen: target } },
  });

  it("pops down to a tab and pushes any other screen", () => {
    inbox.data = [read("n-tasks", "tasks"), read("n-dues", "billing")];
    const router = vi.mocked(useRouter)();
    vi.mocked(router.push).mockClear();
    vi.mocked(router.dismissTo).mockClear();
    const tree = render();
    const row = (title: string) =>
      tree.root.find(
        (node) =>
          (node.type as unknown as string) === "Pressable" &&
          drawnText(node).includes(title),
      );

    act(() => row("About tasks").props.onPress());
    expect(router.dismissTo).toHaveBeenCalledWith("/tasks");
    expect(router.push).not.toHaveBeenCalled();

    act(() => row("About billing").props.onPress());
    expect(router.push).toHaveBeenCalledWith("/dues");
  });
});

/**
 * #3385. A pull on the inbox refetches the notifications it lists, replacing a
 * refetch already in flight.
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
    expect(refetchInbox).toHaveBeenCalledWith({ cancelRefetch: true });
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

  it("says it in one line, with nothing under it", () => {
    inbox.data = [];
    const tree = render();
    const empty = tree.root.findByType(InlineNote);

    expect(empty.props.children).toBe("You're all caught up.");
    expect(empty.props.action).toBeUndefined();
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

/**
 * #3788. Opening a notification from the inbox marks it read; the screen sends
 * the receipt itself, and a row that is already read sends none.
 */
describe("Notifications row tap marks read (#3788)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    inbox.data = null;
    markRead.mutate.mockClear();
  });

  function pressRow(tree: ReactTestRenderer, title: string) {
    const row = tree.root.find(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith(title) &&
        typeof node.props.onPress === "function",
    );
    act(() => row.props.onPress());
  }

  it("sends the read receipt for an unread row", () => {
    const tree = render();
    pressRow(tree, "Dues reminder");
    expect(markRead.mutate).toHaveBeenCalledWith("notif-1");
  });

  it("sends nothing for a row already read", () => {
    inbox.data = [{ ...NOTIFICATIONS[0], read_at: CREATED_AT.toISOString() }];
    const tree = render();
    pressRow(tree, "Dues reminder");
    expect(markRead.mutate).not.toHaveBeenCalled();
  });
});

/**
 * #3929. Mark all read is one `POST /v1/notifications/read`, not a receipt per
 * row, so it also reads rows past the page this screen shows.
 */
describe("Mark all read sends one request (#3929)", () => {
  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    inbox.data = null;
    markAll.mutate.mockClear();
    markRead.mutate.mockClear();
    markRead.mutateAsync.mockClear();
  });

  it("asks the server once, naming no screens", () => {
    inbox.data = [
      NOTIFICATIONS[0],
      { ...NOTIFICATIONS[0], id: "notif-2", title: "Chapter" },
    ];
    const tree = render();
    const button = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Mark all notifications read" &&
        typeof node.props.onPress === "function",
    );
    act(() => button.props.onPress());

    expect(markAll.mutate).toHaveBeenCalledTimes(1);
    expect(markAll.mutate.mock.calls[0]?.[0]).toBeUndefined();
    expect(markRead.mutate).not.toHaveBeenCalled();
    expect(markRead.mutateAsync).not.toHaveBeenCalled();
  });
});
