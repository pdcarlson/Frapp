import { render, screen, fireEvent } from "@testing-library/react";
import { chapterSubscription } from "@/tests/chapter-subscription";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventCard } from "./event-card";
import type { ChatMessage } from "@repo/chat-core/types";

// ── Mocks ────────────────────────────────────────────────────────────────
// The card is hook-driven, so we stub the attendance query + check-in mutation
// and the toast to isolate the rendering + window gating.

const mockUseAttendance = vi.fn();
const mockUseMyPermissions = vi.fn();
const mockEventCardExcuse = vi.fn<(payload: unknown) => unknown>(() => ({
  kind: "none",
}));
const checkIn = vi.fn().mockResolvedValue(undefined);
// The viewer's own row and the event, read while check-in is open (#4136).
const mockMyAttendance = vi.fn();
const mockUseEvent = vi.fn();
const checkInState = { isPending: false };

const { mockCurrentChapter, mockOffline } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockOffline: { value: false },
}));

vi.mock("@/lib/providers/network-provider", async () => {
  const { networkMock } = await import("@/tests/network");
  return networkMock(mockOffline);
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  // `countCheckedIn` stays real; only the data hooks are stubbed.
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // Paid-ops writes on this surface now read the chapter subscription (#841);
  // these cases predate the gate, so they run against an active chapter.
  useCurrentChapter: () => mockCurrentChapter(),
  useAttendance: (id: string) => mockUseAttendance(id),
  useCheckIn: () => ({
    mutateAsync: checkIn,
    isPending: checkInState.isPending,
  }),
  useMyAttendance: (id: string) => mockMyAttendance(id),
  useEvent: (id: string) => mockUseEvent(id),
  useMyPermissions: () => mockUseMyPermissions(),
  useNow: () => Date.now(),
  useEventCardExcuse: (payload: unknown) => mockEventCardExcuse(payload),
  // A viewer with no roles: the event's default decides (the rule is the
  // hook's own spec).
  useRequiredOfViewer: () => (fields: { is_mandatory?: boolean | null }) =>
    fields.is_mandatory === true,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeMessage(
  payloadOverrides: Record<string, unknown> = {},
): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "admin-1",
    content: 'Alice scheduled "Spring Formal"',
    kind: "event",
    is_deleted: false,
    payload: {
      event_id: "evt-1",
      name: "Spring Formal",
      start_time: "2026-06-12T20:00:00.000Z",
      end_time: "2026-06-12T22:00:00.000Z",
      location: "Chapter House",
      point_value: 15,
      is_mandatory: false,
      created_at: "2026-06-01T00:00:00.000Z",
      ...payloadOverrides,
    },
  } as unknown as ChatMessage;
}

const chapter = chapterSubscription(mockCurrentChapter);

describe("EventCard", () => {
  beforeEach(() => {
    chapter.active();
    vi.clearAllMocks();
    mockOffline.value = false;
    mockUseAttendance.mockReturnValue({ data: [] });
    checkInState.isPending = false;
    mockMyAttendance.mockReturnValue({
      data: null,
      isPending: false,
      fetchStatus: "idle",
    });
    mockUseEvent.mockReturnValue({
      data: { id: "evt-1", check_in_zone: null },
      isError: false,
    });
    mockEventCardExcuse.mockReturnValue({ kind: "none" });
    // Default to an attendance-viewer (admin) so the count tests exercise the
    // count path; the non-admin case is covered explicitly below.
    mockUseMyPermissions.mockReturnValue({
      data: { permissions: ["events:update"] },
    });
  });

  it("renders the event snapshot (name, location, points)", () => {
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("Spring Formal")).toBeInTheDocument();
    expect(screen.getByText(/Chapter House/)).toBeInTheDocument();
    expect(screen.getByText(/\+15 pts/)).toBeInTheDocument();
  });

  it("draws Mandatory as the hairline badge, as the Events list does (#4132)", () => {
    render(
      <EventCard message={makeMessage({ is_mandatory: true })} isConfirmed />,
    );
    const badge = screen.getByText("Mandatory");
    expect(badge.className).toContain("text-muted-foreground");
    expect(badge.className).not.toContain("text-destructive-text");
    expect(badge.className).not.toContain("text-accent-text");
  });

  it("shows Mandatory only when the event requires this viewer (#4132)", () => {
    render(
      <EventCard
        message={makeMessage({ is_mandatory: true, viewer_required: false })}
        isConfirmed
      />,
    );
    expect(screen.queryByText("Mandatory")).not.toBeInTheDocument();
  });

  // #4660: the rule is `useEventCardExcuse`'s (its own spec in @repo/hooks);
  // the card draws what it answers.
  it("offers Can't make it, linking to the sheet with the line open", () => {
    mockEventCardExcuse.mockReturnValue({ kind: "offer" });
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.getByRole("link", { name: "Can't make it" })).toHaveAttribute(
      "href",
      "/events?event=evt-1&excuse=1",
    );
  });

  it("says where a sent excuse stands instead", () => {
    mockEventCardExcuse.mockReturnValue({
      kind: "sent",
      status: "PENDING",
      reason: "Away game",
      title: "Excuse sent to Jake",
      detail: null,
      canWithdraw: true,
    });
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("Excuse sent to Jake")).toBeInTheDocument();
    expect(screen.queryByText("Can't make it")).not.toBeInTheDocument();
  });

  it("offers nothing to a member the event doesn't require", () => {
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.queryByText("Can't make it")).not.toBeInTheDocument();
  });

  it("hands the rule the card's own payload", () => {
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(mockEventCardExcuse).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt-1", is_mandatory: false }),
    );
  });

  it("falls back to the content string on a malformed payload", () => {
    const message = makeMessage();
    (message as { payload: unknown }).payload = { nonsense: true };
    render(<EventCard message={message} isConfirmed />);
    expect(screen.getByText(/Alice scheduled/)).toBeInTheDocument();
  });

  it("counts only PRESENT/LATE attendance rows", () => {
    mockUseAttendance.mockReturnValue({
      data: [
        { status: "PRESENT" },
        { status: "LATE" },
        { status: "ABSENT" },
        { status: "EXCUSED" },
      ],
    });
    render(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("2 checked in")).toBeInTheDocument();
  });

  it("draws no count until the roster is read", () => {
    // "0 checked in" while the read is in flight would be a number that isn't
    // true yet; an empty roster is the only thing that says 0.
    mockUseAttendance.mockReturnValue({ data: undefined });
    const { rerender } = render(
      <EventCard message={makeMessage()} isConfirmed />,
    );
    expect(screen.queryByText(/checked in$/)).not.toBeInTheDocument();
    mockUseAttendance.mockReturnValue({ data: [] });
    rerender(<EventCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("0 checked in")).toBeInTheDocument();
  });

  it("shows Check in inside the window and dispatches the check-in", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now - 60_000).toISOString(),
          end_time: new Date(now + 60_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    const button = screen.getByRole("button", { name: /check in/i });
    fireEvent.click(button);
    // Object payload since #994 — the card sends no token and no coordinates,
    // which is what makes it the *plain* self check-in surface.
    expect(checkIn).toHaveBeenCalledWith({ eventId: "evt-1" });
  });

  // #4136: the phone's check-in states, read while the window is open.
  describe("the viewer's own check-in (#4136)", () => {
    function openCard() {
      const now = Date.now();
      return makeMessage({
        start_time: new Date(now - 60_000).toISOString(),
        end_time: new Date(now + 60_000).toISOString(),
      });
    }

    it("reads the viewer's row and the event only while check-in is open", () => {
      render(<EventCard message={makeMessage()} isConfirmed />);
      expect(mockMyAttendance).toHaveBeenCalledWith("");
      expect(mockUseEvent).toHaveBeenCalledWith("");
      render(<EventCard message={openCard()} isConfirmed />);
      expect(mockMyAttendance).toHaveBeenCalledWith("evt-1");
      expect(mockUseEvent).toHaveBeenCalledWith("evt-1");
    });

    it("says Checking in… while the check-in runs", () => {
      checkInState.isPending = true;
      render(<EventCard message={openCard()} isConfirmed />);
      expect(
        screen.getByRole("button", { name: "Checking in…" }),
      ).toBeDisabled();
    });

    it("turns into a disabled Checked in once the viewer is on the list", () => {
      mockMyAttendance.mockReturnValue({
        data: {
          attendance: {
            status: "PRESENT",
            check_in_time: new Date().toISOString(),
          },
        },
        isPending: false,
        fetchStatus: "idle",
      });
      render(<EventCard message={openCard()} isConfirmed />);
      expect(screen.getByRole("button", { name: "Checked in" })).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Check in" }),
      ).not.toBeInTheDocument();
    });

    it("says the officer's mark instead of offering Check in", () => {
      mockMyAttendance.mockReturnValue({
        data: { attendance: { status: "EXCUSED", check_in_time: null } },
        isPending: false,
        fetchStatus: "idle",
      });
      render(<EventCard message={openCard()} isConfirmed />);
      expect(screen.getByText("Marked excused")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /check in/i }),
      ).not.toBeInTheDocument();
    });

    it("sends a zoned event to the app, and waits for the event to say", () => {
      mockUseEvent.mockReturnValue({ data: undefined, isError: false });
      const { unmount } = render(
        <EventCard message={openCard()} isConfirmed />,
      );
      expect(
        screen.queryByRole("button", { name: /check in/i }),
      ).not.toBeInTheDocument();
      unmount();

      mockUseEvent.mockReturnValue({
        data: {
          id: "evt-1",
          check_in_zone: [
            { lat: 1, lng: 1 },
            { lat: 1, lng: 2 },
            { lat: 2, lng: 2 },
          ],
        },
        isError: false,
      });
      render(<EventCard message={openCard()} isConfirmed />);
      expect(
        screen.getByText(
          "This event checks your location, so check in from the Frapp mobile app.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /check in/i }),
      ).not.toBeInTheDocument();
    });

    it("offers neither control with Events turned off, and says why", () => {
      mockCurrentChapter.mockReturnValue({
        data: {
          subscription_status: "active",
          enabled_modules: { events: false },
        },
        isPending: false,
        isError: false,
      });
      mockEventCardExcuse.mockReturnValue({ kind: "offer" });
      render(<EventCard message={openCard()} isConfirmed />);
      expect(
        screen.queryByRole("button", { name: /check in/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Can't make it" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "Check-in is turned off for your chapter right now. An officer can turn events back on.",
        ),
      ).toBeInTheDocument();
      expect(mockMyAttendance).toHaveBeenCalledWith("");
    });
  });

  it("hides Check in outside the event window", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now - 3 * 3_600_000).toISOString(),
          end_time: new Date(now - 2 * 3_600_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(
      screen.queryByRole("button", { name: /check in/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the count and skips the attendance query for a non-admin, but keeps Check in", () => {
    mockUseMyPermissions.mockReturnValue({ data: { permissions: [] } });
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now - 60_000).toISOString(),
          end_time: new Date(now + 60_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    // No count line for a member who can't read the roster…
    expect(screen.queryByText(/\d+ checked in/)).not.toBeInTheDocument();
    // …the admin-only attendance query is never fired (empty id disables it)…
    expect(mockUseAttendance).toHaveBeenCalledWith("");
    // …but self check-in stays available during the window.
    expect(
      screen.getByRole("button", { name: /check in/i }),
    ).toBeInTheDocument();
  });

  it("keeps Check in available within the grace window after the event ends", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now - 60 * 60_000).toISOString(),
          end_time: new Date(now - 5 * 60_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(
      screen.getByRole("button", { name: /check in/i }),
    ).toBeInTheDocument();
  });

  it("shows Check in inside the event's lead before the start (#3703)", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now + 5 * 60_000).toISOString(),
          end_time: new Date(now + 65 * 60_000).toISOString(),
          check_in_opens_minutes: 10,
        })}
        isConfirmed
      />,
    );
    expect(
      screen.getByRole("button", { name: /check in/i }),
    ).toBeInTheDocument();
  });

  it("opens ten minutes early on a card posted before the lead existed", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now + 5 * 60_000).toISOString(),
          end_time: new Date(now + 65 * 60_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(
      screen.getByRole("button", { name: /check in/i }),
    ).toBeInTheDocument();
  });

  it("hides Check in before the event's lead", () => {
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now + 60 * 60_000).toISOString(),
          end_time: new Date(now + 2 * 60 * 60_000).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(
      screen.queryByRole("button", { name: /check in/i }),
    ).not.toBeInTheDocument();
  });
});

describe("EventCard subscription gating", () => {
  // `POST /v1/events/:eventId/attendance/check-in` is on `AttendanceController`,
  // which carries `ChapterGuard` with no `@FreeTier`. The card is rendered in
  // chat, which IS free-tier — the host surface does not decide the gate (#841).
  const inWindow = () => {
    const now = Date.now();
    return makeMessage({
      start_time: new Date(now - 60_000).toISOString(),
      end_time: new Date(now + 60_000).toISOString(),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    mockUseAttendance.mockReturnValue({ data: undefined });
    mockUseMyPermissions.mockReturnValue({ data: { permissions: [] } });
  });

  it("disables check-in and names the blocker on a lapsed chapter", () => {
    chapter.incomplete();
    render(<EventCard message={inWindow()} isConfirmed />);

    expect(screen.getByRole("button", { name: /check in/i })).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("does not dispatch the check-in while blocked", () => {
    chapter.incomplete();
    render(<EventCard message={inWindow()} isConfirmed />);

    fireEvent.click(screen.getByRole("button", { name: /check in/i }));
    expect(checkIn).not.toHaveBeenCalled();
  });

  it("leaves check-in alone on an active chapter", () => {
    chapter.active();
    render(<EventCard message={inWindow()} isConfirmed />);

    expect(screen.getByRole("button", { name: /check in/i })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<EventCard message={inWindow()} isConfirmed />);

    expect(screen.getByRole("button", { name: /check in/i })).toBeEnabled();
  });

  it("keeps the notice off cards outside the check-in window", () => {
    // Otherwise a timeline of past events repeats one chapter-wide sentence
    // under every card.
    chapter.incomplete();
    const now = Date.now();
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(now - 4 * 3_600_000).toISOString(),
          end_time: new Date(now - 2 * 3_600_000).toISOString(),
        })}
        isConfirmed
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables check-in while OFFLINE without a per-card notice", () => {
    chapter.active();
    mockOffline.value = true;
    render(<EventCard message={inWindow()} isConfirmed />);

    const checkInButton = screen.getByRole("button", { name: /check in/i });
    expect(checkInButton).toBeDisabled();
    expect(checkInButton).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    expect(checkInButton).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// #4135: the time line is the shared `formatEventWindow`, the phone's words.
describe("EventCard time line", () => {
  beforeEach(() => {
    chapter.active();
    mockUseAttendance.mockReturnValue({ data: [] });
    mockUseMyPermissions.mockReturnValue({ data: { permissions: [] } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 12, 9));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says Tonight for an evening event today, the day period once", () => {
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(2026, 5, 12, 18).toISOString(),
          end_time: new Date(2026, 5, 12, 19).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(screen.getByText("Tonight · 6:00 – 7:00 PM")).toBeInTheDocument();
  });

  it("names tomorrow", () => {
    render(
      <EventCard
        message={makeMessage({
          start_time: new Date(2026, 5, 13, 10).toISOString(),
          end_time: new Date(2026, 5, 13, 11).toISOString(),
        })}
        isConfirmed
      />,
    );
    expect(screen.getByText("Tomorrow · 10:00 – 11:00 AM")).toBeInTheDocument();
  });
});
