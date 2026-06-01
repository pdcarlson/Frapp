import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventCard } from "./event-card";
import type { ChatMessage } from "@/lib/chat/types";

// ── Mocks ────────────────────────────────────────────────────────────────
// The card is hook-driven, so we stub the attendance query + check-in mutation
// and the toast to isolate the rendering + window gating.

const mockUseAttendance = vi.fn();
const mockUseMyPermissions = vi.fn();
const checkIn = vi.fn().mockResolvedValue(undefined);

vi.mock("@repo/hooks", () => ({
  useAttendance: (id: string) => mockUseAttendance(id),
  useCheckIn: () => ({ mutateAsync: checkIn, isPending: false }),
  useMyPermissions: () => mockUseMyPermissions(),
}));

vi.mock("@/hooks/use-toast", () => ({
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

describe("EventCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAttendance.mockReturnValue({ data: [] });
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

  it("renders an empty count cleanly when attendance is loading", () => {
    mockUseAttendance.mockReturnValue({ data: undefined });
    render(<EventCard message={makeMessage()} isConfirmed />);
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
    expect(checkIn).toHaveBeenCalledWith("evt-1");
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
});
