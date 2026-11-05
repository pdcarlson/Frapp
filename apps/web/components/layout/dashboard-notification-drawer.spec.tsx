import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The drawer's part in keeping the officer report queue fresh (#2257). The
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
  mockInvalidateReports,
  mockMarkRead,
  mockRefetch,
} = vi.hoisted(() => ({
  notifications: { value: [] as unknown[] },
  queryFailed: { value: false },
  mockInvalidateReports: vi.fn(),
  mockMarkRead: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    CHAT_REPORTS_NOTIFICATION_SCREEN: actual.CHAT_REPORTS_NOTIFICATION_SCREEN,
    useNotifications: () => ({
      data: queryFailed.value ? undefined : notifications.value,
      isPending: false,
      isError: queryFailed.value,
      isFetching: false,
      refetch: mockRefetch,
    }),
    useMarkNotificationRead: () => ({
      mutateAsync: mockMarkRead,
      isPending: false,
    }),
    useInvalidateChatReports: () => mockInvalidateReports,
  };
});

vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => undefined,
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "u-officer" }),
}));

const { DashboardNotificationDrawer } =
  await import("./dashboard-notification-drawer");

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

function renderDrawer() {
  return render(<DashboardNotificationDrawer open onOpenChange={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkRead.mockResolvedValue({});
  notifications.value = [EVENT];
  queryFailed.value = false;
});

describe("DashboardNotificationDrawer — report queue freshness", () => {
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
    rerender(<DashboardNotificationDrawer open onOpenChange={vi.fn()} />);
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
    rerender(<DashboardNotificationDrawer open onOpenChange={vi.fn()} />);
    expect(mockInvalidateReports).toHaveBeenCalledTimes(2);
  });

  it("marks the queue stale again when a report notification is followed to Chat Admin", async () => {
    const user = userEvent.setup();
    notifications.value = [REPORT];
    renderDrawer();
    mockInvalidateReports.mockClear();

    const link = screen.getByRole("link", { name: /Message Reported/ });
    expect(link).toHaveAttribute("href", "/chat-admin");
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

describe("DashboardNotificationDrawer — chrome (components.md § Chrome weight)", () => {
  it("draws a bare title with Mark all read as its one icon control", () => {
    renderDrawer();

    expect(
      screen.getByRole("heading", { name: "Notifications" }),
    ).toBeInTheDocument();
    const markAll = screen.getByRole("button", { name: "Mark all read" });
    expect(markAll).toHaveAttribute("title", "Mark all read");
    expect(markAll.textContent).toBe("");
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
      screen.getByRole("link", { name: /^Unread:\s*Notice / }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Message Reported / }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^(New|Read)$/)).toBeNull();
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
});
