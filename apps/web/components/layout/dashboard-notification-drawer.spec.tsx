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

const { notifications, mockInvalidateReports, mockMarkRead } = vi.hoisted(
  () => ({
    notifications: { value: [] as unknown[] },
    mockInvalidateReports: vi.fn(),
    mockMarkRead: vi.fn(),
  }),
);

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    CHAT_REPORTS_NOTIFICATION_SCREEN: actual.CHAT_REPORTS_NOTIFICATION_SCREEN,
    useNotifications: () => ({
      data: notifications.value,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
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
