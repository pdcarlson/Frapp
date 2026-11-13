import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The list's part in keeping the officer report queue fresh (#2257). The
 * realtime ping it hears names no row, so it is the refetched list that says a
 * report notification arrived; the queue is then marked stale, and marked
 * again when the notification is followed.
 */

// next/link needs a router context jsdom lacks; render a plain anchor that
// runs its handler without navigating (jsdom cannot load another document).
vi.mock("next/link", () => ({
  default: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const {
  notifications,
  queryFailed,
  queryFetching,
  mockInvalidateReports,
  mockMarkRead,
  mockMarkManyRead,
  mockScreensSeen,
  mockRefetch,
  pathname,
  roster,
  now,
} = vi.hoisted(() => ({
  roster: {
    value: [] as {
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      role_color: string | null;
    }[],
  },
  now: { value: new Date("2026-09-22T12:00:00Z") },
  mockMarkManyRead: vi.fn(),
  mockScreensSeen: vi.fn(),
  pathname: { value: "/chat" },
  notifications: { value: [] as unknown[] },
  queryFailed: { value: false },
  queryFetching: { value: false },
  mockInvalidateReports: vi.fn(),
  mockMarkRead: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    AI_SUGGESTIONS_NOTIFICATION_SCREEN:
      actual.AI_SUGGESTIONS_NOTIFICATION_SCREEN,
    CHAT_REPORTS_NOTIFICATION_SCREEN: actual.CHAT_REPORTS_NOTIFICATION_SCREEN,
    DISCORD_IMPORT_NOTIFICATION_SCREEN:
      actual.DISCORD_IMPORT_NOTIFICATION_SCREEN,
    useNotifications: () => ({
      data: queryFailed.value ? undefined : notifications.value,
      isPending: false,
      isError: queryFailed.value,
      isFetching: queryFetching.value,
      refetch: mockRefetch,
    }),
    useMarkNotificationRead: () => ({
      mutateAsync: mockMarkRead,
      isPending: false,
    }),
    useMarkNotificationsRead: () => ({
      mutate: mockMarkManyRead,
      isPending: false,
    }),
    useMarkNotificationScreensSeen: mockScreensSeen,
    useInvalidateChatReports: () => mockInvalidateReports,
    memberAvatarTint: actual.memberAvatarTint,
    useNowDate: () => now.value,
    useChapterRoster: () => ({ data: roster.value }),
    useMemberDisplayNames: () => {
      const row = (id: string) => roster.value.find((r) => r.user_id === id);
      return {
        nameFor: (id: string) => row(id)?.display_name ?? null,
        avatarFor: (id: string) => row(id)?.avatar_url ?? null,
        roleColorFor: (id: string) => row(id)?.role_color ?? null,
        avatarTintFor: (id: string) =>
          actual.memberAvatarTint(
            actual.memberAvatarHue(id, row(id)?.role_color ?? null),
          ),
      };
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => undefined,
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "u-officer" }),
}));

const { NotificationsPopover, deepLinkFor } =
  await import("./notifications-popover");

function notification(
  id: string,
  screenName: string,
  createdAt: string,
  title = "Notice",
) {
  return {
    id,
    chapter_id: "chap-1",
    user_id: "u-officer",
    title,
    body: "",
    data: { target: { screen: screenName } },
    read_at: null,
    created_at: createdAt,
  };
}

const EVENT = notification("n-event", "events", "2026-09-22T09:00:00Z");
const REPORT = notification(
  "n-report-1",
  "chat_reports",
  "2026-09-22T10:00:00Z",
  "Message Reported",
);

/** The bell the list opens under. */
const BELL = <button type="button">Notifications bell</button>;

function renderDrawer() {
  return render(
    <NotificationsPopover open onOpenChange={vi.fn()}>
      {BELL}
    </NotificationsPopover>,
  );
}

/** The shell's wiring: the bell opens and closes the list under it. */
function WithBell() {
  const [open, setOpen] = useState(false);
  return (
    <NotificationsPopover open={open} onOpenChange={setOpen}>
      {BELL}
    </NotificationsPopover>
  );
}

describe("NotificationsPopover — a dropdown under the bell (#4593)", () => {
  it("opens under the bell, not as a sheet over the page, and Escape hands focus back to the bell", async () => {
    const user = userEvent.setup();
    render(<WithBell />);
    const bell = screen.getByRole("button", { name: "Notifications bell" });
    expect(bell).toHaveAttribute("aria-haspopup", "dialog");

    await user.click(bell);
    const list = screen.getByRole("dialog", { name: "Notifications" });
    expect(bell).toHaveAttribute("aria-expanded", "true");
    // Radix positions a popover in a wrapper; a sheet has no such wrapper.
    expect(list.parentElement).toHaveAttribute(
      "data-radix-popper-content-wrapper",
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bell).toHaveFocus();
  });

  it("keeps focus in the list when Mark all read goes away", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WithBell />);
    await user.click(
      screen.getByRole("button", { name: "Notifications bell" }),
    );
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    // The read lands and the button is no longer drawn.
    notifications.value = notifications.value.map((n) => ({
      ...(n as object),
      read_at: "2026-09-22T10:05:00Z",
    }));
    rerender(<WithBell />);
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Notifications" })).toHaveFocus();
  });

  it("closes when the bell is pressed again", async () => {
    const user = userEvent.setup();
    render(<WithBell />);
    const bell = screen.getByRole("button", { name: "Notifications bell" });
    await user.click(bell);
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await user.click(bell);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkRead.mockResolvedValue({});
  notifications.value = [EVENT];
  queryFailed.value = false;
  queryFetching.value = false;
  pathname.value = "/chat";
});

describe("NotificationsPopover — report queue freshness", () => {
  it("leaves the report queue alone when no report notification is listed", () => {
    renderDrawer();
    expect(mockInvalidateReports).not.toHaveBeenCalled();
  });

  it("marks the queue stale when a report notification is listed, and again when a newer one arrives", () => {
    notifications.value = [EVENT, REPORT];
    const { rerender } = renderDrawer();
    expect(mockInvalidateReports).toHaveBeenCalledTimes(1);

    // An unrelated notification arriving is not a new report.
    notifications.value = [
      EVENT,
      REPORT,
      notification("n-points", "points", "2026-09-22T11:00:00Z"),
    ];
    rerender(
      <NotificationsPopover open onOpenChange={vi.fn()}>
        {BELL}
      </NotificationsPopover>,
    );
    expect(mockInvalidateReports).toHaveBeenCalledTimes(1);

    notifications.value = [
      ...notifications.value,
      notification(
        "n-report-2",
        "chat_reports",
        "2026-09-22T11:30:00Z",
        "Message Reported",
      ),
    ];
    rerender(
      <NotificationsPopover open onOpenChange={vi.fn()}>
        {BELL}
      </NotificationsPopover>,
    );
    expect(mockInvalidateReports).toHaveBeenCalledTimes(2);
  });

  it("marks the queue stale again when a report notification is followed to Chat Admin", async () => {
    const user = userEvent.setup();
    notifications.value = [REPORT];
    renderDrawer();
    mockInvalidateReports.mockClear();

    const link = screen.getByRole("link", { name: /Message Reported/ });
    expect(link).toHaveAttribute(
      "href",
      "/settings?tab=chat#reported-messages",
    );
    await user.click(link);

    expect(mockInvalidateReports).toHaveBeenCalledTimes(1);
  });

  it("does not touch the queue when another notification is followed", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole("link", { name: /Notice/ }));

    expect(mockInvalidateReports).not.toHaveBeenCalled();
  });
});

describe("NotificationsPopover — chrome (components.md § Chrome weight)", () => {
  it("draws a bare title with a worded Mark all read as its one control (#3929)", () => {
    renderDrawer();

    expect(
      screen.getByRole("heading", { name: "Notifications" }),
    ).toBeInTheDocument();
    const markAll = screen.getByRole("button", { name: "Mark all read" });
    expect(markAll.textContent).toBe("Mark all read");
    // The realtime ping refetches; there is no manual Refresh, no count and
    // no "N total" line.
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    expect(screen.queryByText(/\d+ total/)).toBeNull();
  });

  it("marks unread with a dot and a spoken word, not a New or Read badge", () => {
    notifications.value = [
      EVENT,
      { ...REPORT, read_at: "2026-09-22T10:05:00Z" },
    ];
    renderDrawer();

    expect(
      screen.getByRole("link", { name: /^Unread:\s*Event\.\s*Notice / }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Report\.\s*Message Reported / }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^(New|Read)$/)).toBeNull();
    const dots = document.querySelectorAll("[data-unread-dot]");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("bg-foreground");
    expect(
      screen.getByRole("link", { name: /^Unread:\s*Event\.\s*Notice / }),
    ).toContainElement(dots[0] as HTMLElement);
  });

  it("shows a long title and body whole, since nothing else on web does", () => {
    notifications.value = [
      {
        ...EVENT,
        body: "A body long enough to run past two lines of the drawer, which used to clip it with no way to read the rest anywhere else on web.",
      },
    ];
    renderDrawer();
    const row = screen.getByRole("link", { name: /Notice/ });
    for (const clip of ["truncate", "line-clamp-2"]) {
      expect(row.querySelector(`.${clip}`)).toBeNull();
    }
    // Drawn inside the row: the scroll area's overflow clips anything outside.
    expect(row).toHaveClass("focus-visible:ring-inset");
  });

  it("lists rows flat, with no card around each", () => {
    renderDrawer();
    const row = screen.getByRole("link", { name: /Notice/ });
    // One class per assertion: a negated multi-class `toHaveClass` passes as
    // soon as any one of them is missing.
    for (const frame of [
      "border-border",
      "border-accent-border",
      "bg-card",
      "bg-accent-subtle",
      "bg-surface-1",
    ]) {
      expect(row).not.toHaveClass(frame);
    }
    expect(row.closest("ul")).toHaveClass("divide-y");
  });

  it("offers Try again on a failed load, since the header has no Refresh", async () => {
    queryFailed.value = true;
    renderDrawer();
    expect(screen.getByText(/Couldn.t load notifications/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("disables Try again with a spinner while the retry runs", () => {
    queryFailed.value = true;
    queryFetching.value = true;
    renderDrawer();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeDisabled();
    expect(retry.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("NotificationsPopover — a Discord import that ended", () => {
  it("opens the import page", () => {
    notifications.value = [
      notification(
        "n-import",
        "discord_import",
        "2026-11-06T10:00:00Z",
        "Discord import finished",
      ),
    ];
    renderDrawer();
    expect(
      screen.getByRole("link", { name: /Discord import finished/ }),
    ).toHaveAttribute("href", "/settings?tab=chat&tool=discord-import");
  });
});

describe("NotificationsPopover: suggested tasks to review (#4313)", () => {
  it("opens the minutes they came from, or the Tasks board without one", () => {
    const fromMinutes = notification(
      "n-suggested",
      "ai_suggestions",
      "2026-11-12T10:00:00Z",
      "5 suggested tasks to review",
    );
    notifications.value = [
      {
        ...fromMinutes,
        data: {
          target: {
            screen: "ai_suggestions",
            sourceType: "meeting",
            sourceId: "mtg-1",
          },
        },
      },
      notification(
        "n-suggested-bare",
        "ai_suggestions",
        "2026-11-12T09:00:00Z",
        "1 suggested task to review",
      ),
    ];
    renderDrawer();
    expect(
      screen.getByRole("link", { name: /5 suggested tasks to review/ }),
    ).toHaveAttribute("href", "/meetings/mtg-1");
    expect(
      screen.getByRole("link", { name: /1 suggested task to review/ }),
    ).toHaveAttribute("href", "/tasks");
  });

  it("opens the calendar for an event from this time last year (#3930)", () => {
    notifications.value = [
      {
        ...notification(
          "n-last-year",
          "ai_suggestions",
          "2026-11-12T10:00:00Z",
          "This time last year",
        ),
        data: {
          target: {
            screen: "ai_suggestions",
            sourceType: "event",
            sourceId: "evt-old",
          },
        },
      },
    ];
    renderDrawer();
    expect(
      screen.getByRole("link", { name: /This time last year/ }),
    ).toHaveAttribute("href", "/events");
  });
});

/**
 * #3788. Opening a notification from the drawer marks it read and closes the
 * drawer; a row already read sends no receipt.
 */
describe("NotificationsPopover — opening a notification marks it read", () => {
  it("sends the read receipt for an unread row and closes the drawer", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <NotificationsPopover open onOpenChange={onOpenChange}>
        {BELL}
      </NotificationsPopover>,
    );

    await user.click(screen.getByRole("link", { name: /Notice/ }));

    expect(mockMarkRead).toHaveBeenCalledWith("n-event");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends nothing for a row already read", async () => {
    const user = userEvent.setup();
    notifications.value = [{ ...EVENT, read_at: "2026-09-22T09:05:00Z" }];
    renderDrawer();

    await user.click(screen.getByRole("link", { name: /Notice/ }));

    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});

describe("NotificationsPopover: reading notifications (#3929)", () => {
  it("Mark all read sends one request, not one per row", async () => {
    const user = userEvent.setup();
    notifications.value = [EVENT, REPORT];
    renderDrawer();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(mockMarkManyRead).toHaveBeenCalledTimes(1);
    expect(mockMarkManyRead).toHaveBeenCalledWith(undefined);
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("draws no Mark all read once nothing is unread", () => {
    notifications.value = [{ ...EVENT, read_at: "2026-09-22T10:05:00Z" }];
    renderDrawer();

    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("reads the notices about the page the member is on, while the tab shows", () => {
    pathname.value = "/events";
    renderDrawer();

    // Events also shows what was suggested from this time last year (#3930).
    expect(mockScreensSeen).toHaveBeenLastCalledWith(
      ["events", "ai_suggestions"],
      { enabled: true },
    );
  });

  it("reads nothing by page on a chat page: the channel read clears those", () => {
    pathname.value = "/chat";
    renderDrawer();

    expect(mockScreensSeen).toHaveBeenLastCalledWith([], { enabled: true });
  });

  it("sends a member-joined notice to Members, not Chat", () => {
    notifications.value = [
      notification("n-join", "members", "2026-09-22T11:00:00Z", "Alex joined"),
    ];
    renderDrawer();

    expect(screen.getByRole("link", { name: /Alex joined/ })).toHaveAttribute(
      "href",
      "/members",
    );
  });
});

/**
 * #4346 (Shawn, 2026-11-11): a row shows who it is about and what kind of
 * notice it is, names wear their colour, a mention wears the @ badge, and the
 * "OBJ" box is gone.
 */
describe("NotificationsPopover: rows that stand out (#4346)", () => {
  const chat = (
    id: string,
    data: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) => ({
    ...notification(
      id,
      "chat",
      "2026-09-22T11:00:00Z",
      "Ryan Castellano in #general",
    ),
    body: "can you cover saturday?",
    data: {
      target: { screen: "chat", channelId: "c1" },
      senderId: "u-ryan",
      ...data,
    },
    ...over,
  });

  beforeEach(() => {
    roster.value = [
      {
        user_id: "u-officer",
        display_name: "Marcus Ellison",
        avatar_url: null,
        role_color: null,
      },
      {
        user_id: "u-ryan",
        display_name: "Ryan Castellano",
        avatar_url: null,
        role_color: "#8FA8FF",
      },
      {
        user_id: "u-owen",
        display_name: "Owen Delacroix",
        avatar_url: null,
        role_color: null,
      },
    ];
  });

  it("draws the sender's initials, their name in their colour, and the channel badge", () => {
    notifications.value = [
      chat("n1", { chatKind: "channel", channelName: "general" }),
    ];
    renderDrawer();
    const row = screen.getByRole("link", {
      name: /Channel message\.\s*Ryan Castellano in #general/,
    });
    expect(row).toHaveAttribute("data-notification-kind", "channel");
    expect(row.querySelector("[data-person-name]")).toHaveStyle({
      "--role-name": "#8FA8FF",
    });
    expect(row).toHaveTextContent("RC");
    expect(row.querySelector("[data-kind-badge]")).toHaveTextContent("#");
  });

  it("wears the gold @ badge when it mentions you, and stays flat", () => {
    notifications.value = [
      chat(
        "n1",
        { chatKind: "channel", mentioned: true },
        {
          body: "@Marcus Ellison @bigsigma can you cover?",
        },
      ),
    ];
    renderDrawer();
    const row = screen.getByRole("link", { name: /Mentioned you\./ });
    const badge = row.querySelector("[data-kind-badge='mention']");
    expect(badge).toHaveTextContent("@");
    // The mention chip's fixed gold, never the chapter accent.
    expect(badge).toHaveClass("bg-mention-chip-text");
    expect(badge).not.toHaveClass("bg-primary");
    expect(row).not.toHaveClass("bg-accent-subtle");
    // A name that resolves is chat's chip; one that names nobody is text.
    const chips = row.querySelectorAll("mark[data-mention]");
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      "@Marcus Ellison",
    ]);
  });

  it("draws a join as the member who joined", () => {
    notifications.value = [
      {
        ...notification(
          "n-join",
          "members",
          "2026-09-22T11:00:00Z",
          "Owen Delacroix joined",
        ),
        data: { target: { screen: "members" }, memberUserId: "u-owen" },
      },
    ];
    renderDrawer();
    const row = screen.getByRole("link", {
      name: /New member\.\s*Owen Delacroix joined/,
    });
    expect(row).toHaveTextContent("OD");
    expect(row.querySelector("[data-kind-badge='join']")).not.toBeNull();
  });

  it("draws a notice with no person behind it as its tile", () => {
    renderDrawer();
    const row = screen.getByRole("link", { name: /Event\.\s*Notice/ });
    expect(
      row.querySelector("[data-notification-tile='events']"),
    ).not.toBeNull();
    expect(row.querySelector("[data-kind-badge]")).toBeNull();
  });

  it("leaves out the U+FFFC box", () => {
    notifications.value = [
      chat("n1", { chatKind: "dm" }, { body: "take a look ￼" }),
    ];
    renderDrawer();
    const row = screen.getByRole("link", { name: /Direct message\./ });
    expect(row.textContent).not.toContain("￼");
    expect(row).toHaveTextContent("take a look");
  });

  it("groups rows Today and Earlier on the viewer's day", () => {
    now.value = new Date("2026-09-22T12:00:00");
    notifications.value = [
      notification(
        "n-today",
        "events",
        "2026-09-22T09:00:00",
        "Today's notice",
      ),
      notification("n-old", "tasks", "2026-09-20T09:00:00", "Older notice"),
    ];
    renderDrawer();
    const today = screen.getByRole("region", { name: "Today" });
    const earlier = screen.getByRole("region", { name: "Earlier" });
    expect(today).toHaveTextContent("Today's notice");
    expect(earlier).toHaveTextContent("Older notice");
  });
});

describe("NotificationsPopover: what review caught (#4346)", () => {
  beforeEach(() => {
    roster.value = [
      {
        user_id: "u-ann",
        display_name: "Ann",
        avatar_url: null,
        role_color: "#F47FA4",
      },
    ];
  });

  it("colours the name where the server wrote it, not inside 'Announcement'", () => {
    notifications.value = [
      {
        ...notification(
          "n-ann",
          "chat",
          "2026-09-22T11:00:00Z",
          "Announcement from Ann",
        ),
        data: {
          target: { screen: "chat", channelId: "c1" },
          senderId: "u-ann",
          chatKind: "announcement",
        },
      },
    ];
    renderDrawer();
    const row = screen.getByRole("link", {
      name: /Announcement\.\s*Announcement from Ann/,
    });
    const name = row.querySelector("[data-person-name]");
    expect(name).toHaveTextContent(/^Ann$/);
    expect(row).toHaveTextContent("Announcement from Ann");
  });

  it("draws the system sender's row as a notice tile, not a blank person", () => {
    notifications.value = [
      {
        ...notification("n-sys", "chat", "2026-09-22T11:00:00Z", "New Message"),
        data: {
          target: { screen: "chat", channelId: "c1" },
          senderId: "00000000-0000-0000-0000-000000000000",
        },
      },
    ];
    renderDrawer();
    const row = screen.getByRole("link", { name: /Notice\.\s*New Message/ });
    expect(
      row.querySelector("[data-notification-tile='other']"),
    ).not.toBeNull();
  });

  it("leaves U+FFFC out of a title, which carries typed text too", () => {
    notifications.value = [
      notification(
        "n-task",
        "tasks",
        "2026-09-22T11:00:00Z",
        "Book the venue \uFFFC",
      ),
    ];
    renderDrawer();
    const row = screen.getByRole("link", { name: /Task\.\s*Book the venue/ });
    expect(row.textContent).not.toContain("\uFFFC");
  });
});

describe("deepLinkFor: task notifications", () => {
  const task = (target: Record<string, string>) => ({
    ...notification("n-task", "tasks", "2026-11-13T01:00:00Z"),
    data: { target: { screen: "tasks", ...target } },
  });

  it("opens a submitted task's review in Activity", () => {
    expect(deepLinkFor(task({ taskId: "t 1", view: "review" }))).toBe(
      "/activity?review=t%201",
    );
  });

  it("opens the board for every other task notification", () => {
    expect(deepLinkFor(task({ taskId: "t1" }))).toBe("/tasks");
    expect(deepLinkFor(task({ view: "review" }))).toBe("/tasks");
  });
});
