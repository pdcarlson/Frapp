import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockToast,
  eventQueryState,
} = vi.hoisted(() => ({
  eventQueryState: { isLoading: false },
  mockCurrentChapter: vi.fn(),
  mockToast: vi.fn(),
}));

// usingPreviewData renders from the `event` prop and gates out AttendancePanel;
// stub the live hooks so the sheet renders without a query client / API.
vi.mock("@repo/hooks", () => ({
  useEvent: () => ({
    data: undefined,
    isLoading: eventQueryState.isLoading,
    isError: false,
  }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  // Edit and Delete both hit paid-ops event routes, so the sheet reads the
  // chapter's subscription now (#841). Existing cases default to active.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:manage"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/events/attendance-panel", () => ({
  AttendancePanel: () => null,
}));

import { EventDetailSheet } from "./event-detail-sheet";

const baseEvent = {
  id: "e1",
  name: "Exec Sync",
  start_time: "2026-07-01T18:00:00.000Z",
  end_time: "2026-07-01T19:00:00.000Z",
};

const chapter = chapterSubscription(mockCurrentChapter);

beforeEach(() => {
  chapter.active();
  mockToast.mockReset();
});

describe("EventDetailSheet who's coming", () => {
  it("names each role set apart, with its answer", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{
          ...baseEvent,
          required_role_ids: ["r1"],
          others_invited: false,
        }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Who's coming")).toBeInTheDocument();
    expect(screen.getByText("Only the roles below")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("says the default alone when no role is set apart", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, required_role_ids: [] }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Optional for everyone")).toBeInTheDocument();
  });
});

describe("EventDetailSheet series", () => {
  const series = [
    baseEvent,
    {
      ...baseEvent,
      id: "e2",
      start_time: "2026-07-08T18:00:00.000Z",
      end_time: "2026-07-08T19:00:00.000Z",
    },
    {
      ...baseEvent,
      id: "e3",
      start_time: "2026-07-15T18:00:00.000Z",
      end_time: "2026-07-15T19:00:00.000Z",
    },
  ];

  it("lists the series' upcoming meetings under the one it opened, and opens another", async () => {
    const user = userEvent.setup();
    const onSelectOccurrence = vi.fn();
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        series={series}
        onSelectOccurrence={onSelectOccurrence}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    const list = within(
      screen.getByRole("region", { name: "Upcoming in this series" }),
    );
    const meetings = list.getAllByRole("button");
    expect(meetings).toHaveLength(3);
    // The one open is marked and isn't a way to reopen itself.
    expect(meetings[0]).toHaveAttribute("aria-current", "true");
    expect(meetings[0]).toBeDisabled();

    await user.click(meetings[2]!);
    expect(onSelectOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e3" }),
    );
  });

  it("badges a generated meeting with the series' rule it was handed", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        // A generated meeting: no rule of its own.
        event={{ ...baseEvent, recurrence_rule: null, parent_event_id: "h" }}
        series={series}
        seriesRule="WEEKLY"
        onSelectOccurrence={() => {}}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Weekly")).toBeInTheDocument();
  });

  it("shows no series block for a one-time event", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.queryByText("Upcoming in this series")).toBeNull();
  });
});

describe("EventDetailSheet meeting minutes", () => {
  it("labels the notes field as meeting minutes, not internal notes", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, notes: "Line one\nLine two" }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Meeting minutes")).toBeInTheDocument();
    expect(screen.queryByText("Internal notes")).not.toBeInTheDocument();
  });

  it("preserves line breaks members typed instead of collapsing them", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, notes: "Line one\nLine two" }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    // The sheet renders into a Radix portal on `document.body`, and RTL's
    // `getByText` normalizes whitespace (collapsing the newline) — which
    // would pass even if the markup dropped it — so read the raw node.
    const minutes = document.body.querySelector("p.whitespace-pre-wrap");
    expect(minutes).not.toBeNull();
    expect(minutes?.textContent).toBe("Line one\nLine two");
  });

  it("preserves line breaks in the description too, same as minutes", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, description: "Agenda one\nAgenda two" }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    // Description renders before minutes in the sheet, so it's the first
    // whitespace-pre-wrap paragraph.
    const [description] = document.body.querySelectorAll(
      "p.whitespace-pre-wrap",
    );
    expect(description?.textContent).toBe("Agenda one\nAgenda two");
  });

  it("renders no minutes section when the event has none", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.queryByText("Meeting minutes")).not.toBeInTheDocument();
  });
});

describe("EventDetailSheet subscription gating", () => {
  // `DELETE /v1/events/:id` and the `PATCH` behind Edit are both paid-ops.
  // Edit is gated here, not only inside the editor dialog, because this button
  // is the trigger for that flow (§5 rule 1).
  function renderSheet() {
    return render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );
  }

  it("disables edit and delete and names the blocker on a lapsed chapter", () => {
    chapter.incomplete();
    renderSheet();

    expect(screen.getByRole("button", { name: /edit event/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /delete event/i }),
    ).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("leaves both alone on an active chapter", () => {
    chapter.active();
    renderSheet();

    expect(screen.getByRole("button", { name: /edit event/i })).toBeEnabled();
    // Delete is not asserted enabled here: `usingPreviewData` already disables
    // it via `canMutate`, independently of the subscription gate. Asserting it
    // would pass for the wrong reason in every branch of this describe.
    //
    // Asserting the copy rather than `role="status"`: this sheet renders its own
    // status-role node for the live-event fetch, so the role alone is ambiguous.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    renderSheet();

    expect(screen.getByRole("button", { name: /edit event/i })).toBeEnabled();
  });

  it("blocks paid-ops event writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    renderSheet();

    expect(screen.getByRole("button", { name: /edit event/i })).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });
});

describe("EventDetailSheet header actions", () => {
  // components.md § Chrome weight: an object's actions are icons in its
  // header beside the close, not worded buttons opening the body.
  it("draws Edit and Delete as named icons with tooltips", () => {
    chapter.active();
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    for (const name of ["Edit event", "Delete event"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveTextContent(/^$/);
      expect(button).toHaveAttribute("title", name);
    }
    // The .ics export was withdrawn until calendar sync ships (#3708).
    expect(
      screen.queryByRole("button", { name: /add to calendar/i }),
    ).toBeNull();
  });
});

describe("EventDetailSheet check-in zone", () => {
  it("names the zone, never its corner count, when one is set", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{
          ...baseEvent,
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
            { lat: 7, lng: 8 },
          ],
          check_in_zone_name: "Great Hall",
        }}
        onRequestEdit={() => {}}
        onEventDeleted={async () => {}}
      />,
    );

    expect(
      screen.getByText("Check in from inside the Great Hall zone."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/4 points/)).not.toBeInTheDocument();
  });

  it("says check-in is unrestricted when no zone is set", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={async () => {}}
      />,
    );

    expect(screen.getByText(/can check in from anywhere/)).toBeInTheDocument();
  });

  // A 2-point polygon fails `isValidZone` server-side, which fails closed and
  // rejects every check-in. Reporting that as "no zone" would tell the officer
  // the exact opposite of what members hit.
  it("warns rather than reporting no zone when the polygon is malformed", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{
          ...baseEvent,
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
          ],
        }}
        onRequestEdit={() => {}}
        onEventDeleted={async () => {}}
      />,
    );

    expect(screen.getByText(/zone is incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/can check in from anywhere/)).toBeNull();
  });
});

describe("EventDetailSheet zone validity mirrors the server", () => {
  // isValidZone requires EVERY entry to be a finite pair, not just three of
  // them. Counting only the good points would report a working zone for a
  // polygon the server rejects outright.
  it("warns on a zone with three good points and two malformed ones", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{
          ...baseEvent,
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
            { lat: "nope", lng: 8 },
            { lat: 9 },
          ],
          check_in_zone_name: "Great Hall",
        }}
        onRequestEdit={() => {}}
        onEventDeleted={async () => {}}
      />,
    );

    expect(screen.getByText(/zone is incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/3 points/)).toBeNull();
    expect(screen.queryByText(/can check in from anywhere/)).toBeNull();
  });
});

describe("EventDetailSheet schedule and policy", () => {
  function renderSheet(event: Record<string, unknown>) {
    return render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={event}
        onRequestEdit={() => {}}
        onEventDeleted={async () => {}}
      />,
    );
  }

  it("states the when on one line, in the house shape", () => {
    renderSheet({
      ...baseEvent,
      start_time: new Date(2026, 6, 1, 17, 0).toISOString(),
      end_time: new Date(2026, 6, 1, 19, 0).toISOString(),
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toMatch(/Starts:|Ends:/);
    expect(dialog.textContent).not.toMatch(/:\d\d:\d\d/);
    expect(screen.getByText(/· 5:00\s?– 7:00\sPM$/)).toBeInTheDocument();
  });

  it("names the cadence in words and draws nothing for a one-time event", () => {
    const { unmount } = renderSheet({
      ...baseEvent,
      recurrence_rule: "BIWEEKLY",
    });
    expect(screen.getByText("Bi-weekly")).toBeInTheDocument();
    expect(screen.queryByText("BIWEEKLY")).toBeNull();
    unmount();

    renderSheet(baseEvent);
    expect(screen.queryByText("One-time")).toBeNull();
  });

  it("drops a location or point value the event does not have", () => {
    renderSheet(baseEvent);

    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toMatch(/TBD|0 points|point\(s\)/);
  });

  it("carries no description narrating the sheet", () => {
    renderSheet(baseEvent);

    expect(screen.queryByText(/review scheduling details/i)).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });
});

describe("EventDetailSheet loading", () => {
  it("draws a skeleton and one screen-reader status line, not a spinner with a caption (components.md §10)", () => {
    eventQueryState.isLoading = true;
    try {
      render(
        <EventDetailSheet
          open
          onOpenChange={() => {}}
          usingPreviewData={false}
          event={baseEvent}
          onRequestEdit={() => {}}
          onEventDeleted={() => {}}
        />,
      );
      const status = screen
        .getAllByRole("status")
        .find((node) => node.textContent === "Loading event details");
      expect(status).toBeDefined();
      expect(status).toHaveClass("sr-only");
    } finally {
      eventQueryState.isLoading = false;
    }
  });
});

describe("EventDetailSheet required badge", () => {
  // A status, so danger as the events list and mobile draw it, never the
  // chapter accent (components.md §5).
  it("draws required-for-everyone as the danger badge", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, is_mandatory: true }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );
    const badge = screen.getByText("Required for everyone");
    expect(badge.className).toContain("text-destructive-text");
    expect(badge.className).not.toContain("text-accent-text");
  });
});
