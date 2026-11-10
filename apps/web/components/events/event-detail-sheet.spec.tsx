import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockToast,
  eventQueryState,
  mockOffline,
  permissionsState,
  realtimeCalls,
} = vi.hoisted(() => ({
  eventQueryState: {
    isLoading: false,
    isError: false,
    error: undefined as unknown,
    data: undefined as unknown,
  },
  mockOffline: { value: false },
  mockCurrentChapter: vi.fn(),
  mockToast: vi.fn(),
  // What `useMyPermissions` answers: the viewer's permissions, or `undefined`
  // while the read is still in flight.
  permissionsState: {
    value: ["billing:manage"] as string[] | undefined,
    // How the read stands when `value` is undefined.
    fetchStatus: "fetching" as "fetching" | "paused" | "idle",
    isError: false,
  },
  realtimeCalls: [] as { table: string; scopeId: string; enabled?: boolean }[],
}));

// usingPreviewData renders from the `event` prop and gates out AttendancePanel;
// stub the live hooks so the sheet renders without a query client / API.
vi.mock("@repo/hooks", () => ({
  useEvent: () => ({
    data: eventQueryState.data,
    isLoading: eventQueryState.isLoading,
    isError: eventQueryState.isError,
    error: eventQueryState.error,
  }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  // Edit and Delete both hit paid-ops event routes, so the sheet reads the
  // chapter's subscription now (#841). Existing cases default to active.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data:
      permissionsState.value === undefined
        ? undefined
        : { permissions: permissionsState.value },
    isPending: permissionsState.value === undefined,
    isError: permissionsState.value === undefined && permissionsState.isError,
    fetchStatus:
      permissionsState.value === undefined
        ? permissionsState.fetchStatus
        : "idle",
    refetch: vi.fn(),
  }),
  useActiveChapterId: () => "chap-1",
}));

vi.mock("@/lib/providers/network-provider", async () => {
  const { networkMock } = await import("@/tests/network");
  return networkMock(mockOffline);
});

vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: (options: {
    table: string;
    scopeId: string;
    enabled?: boolean;
  }) => {
    realtimeCalls.push(options);
  },
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/events/attendance-panel", () => ({
  AttendancePanel: () => <div data-testid="attendance-roster" />,
}));

vi.mock("@/components/events/my-check-in", () => ({
  MyCheckIn: ({
    zone,
    eventUnavailable,
  }: {
    zone: string;
    eventUnavailable?: boolean;
  }) => (
    <div
      data-testid="my-check-in"
      data-zone={zone}
      data-unavailable={String(Boolean(eventUnavailable))}
    />
  ),
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
  permissionsState.value = ["billing:manage"];
  permissionsState.fetchStatus = "fetching";
  permissionsState.isError = false;
  realtimeCalls.length = 0;
  mockOffline.value = false;
  Object.assign(eventQueryState, {
    isLoading: false,
    isError: false,
    error: undefined,
    data: undefined,
  });
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

describe("EventDetailSheet preview", () => {
  it("mounts no live check-in, roster or subscription for preview data", () => {
    permissionsState.value = ["members:view", "events:update"];
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

    expect(screen.queryByTestId("my-check-in")).toBeNull();
    expect(screen.queryByTestId("attendance-roster")).toBeNull();
    expect(realtimeCalls.every((call) => call.enabled === false)).toBe(true);
  });
});

describe("EventDetailSheet for a live event, by role (#3855)", () => {
  function renderLive(
    event: Record<string, unknown> = baseEvent,
    open = true,
  ) {
    return render(
      <EventDetailSheet
        open={open}
        onOpenChange={() => {}}
        usingPreviewData={false}
        event={event}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );
  }

  it("gives a member their own check-in, and never mounts the officer roster", () => {
    permissionsState.value = ["members:view"];
    renderLive();

    expect(screen.getByTestId("my-check-in")).toBeInTheDocument();
    // Mounted, the roster's `events:update` read 403s into "Your role can't
    // do this" on the member's sheet.
    expect(screen.queryByTestId("attendance-roster")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull();
  });

  it("tells a member on a lapsed chapter nothing about editing events", () => {
    chapter.incomplete();
    permissionsState.value = ["members:view"];
    renderLive();

    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("subscribes every viewer to the event's attendance pings", () => {
    // The member's own row refreshes from it too, so it can't live in the
    // officer-only roster any more.
    permissionsState.value = ["members:view"];
    renderLive();

    expect(realtimeCalls).toContainEqual(
      expect.objectContaining({
        table: "event_attendance",
        scopeId: "e1",
        enabled: true,
      }),
    );
  });

  it("hides the header actions when the permissions read fails online", () => {
    // `<Can>`'s rule: a failure while connected is a denial, not a guess.
    permissionsState.value = undefined;
    permissionsState.isError = true;
    permissionsState.fetchStatus = "idle";
    renderLive();

    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull();
  });

  it("keeps them when the permissions read failed offline", () => {
    mockOffline.value = true;
    permissionsState.value = undefined;
    permissionsState.isError = true;
    permissionsState.fetchStatus = "idle";
    renderLive();

    expect(screen.getByRole("button", { name: "Edit event" })).toBeInTheDocument();
  });

  it("drops the subscription while the sheet is closed", () => {
    permissionsState.value = ["members:view"];
    renderLive(baseEvent, false);

    expect(
      realtimeCalls.some(
        (call) => call.table === "event_attendance" && call.enabled,
      ),
    ).toBe(false);
  });

  it("tells the check-in block the event is gone on a 404", () => {
    permissionsState.value = ["members:view"];
    eventQueryState.isError = true;
    eventQueryState.error = { statusCode: 404 };
    eventQueryState.data = { ...baseEvent };
    renderLive();

    expect(screen.getByTestId("my-check-in")).toHaveAttribute(
      "data-unavailable",
      "true",
    );
  });

  it("keeps check-in through a failed refetch of an event it still holds", () => {
    // A throttled background refetch keeps its data; one 429 must not take
    // Check in away.
    permissionsState.value = ["members:view"];
    eventQueryState.isError = true;
    eventQueryState.error = { statusCode: 429 };
    eventQueryState.data = { ...baseEvent };
    renderLive();

    expect(screen.getByTestId("my-check-in")).toHaveAttribute(
      "data-unavailable",
      "false",
    );
  });

  it("keeps the header actions when permissions can't be answered offline", () => {
    // Hidden would say the role lacks them; nobody checked.
    permissionsState.value = undefined;
    permissionsState.fetchStatus = "paused";
    renderLive();

    expect(screen.getByRole("button", { name: "Edit event" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete event" }),
    ).toBeInTheDocument();
  });

  it("gives an officer the roster and the header actions, as well as their own check-in", () => {
    permissionsState.value = [
      "members:view",
      "events:update",
      "events:delete",
    ];
    renderLive();

    expect(screen.getByTestId("attendance-roster")).toBeInTheDocument();
    expect(screen.getByTestId("my-check-in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit event" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete event" }),
    ).toBeInTheDocument();
  });

  it("splits Edit from Delete by their own permissions", () => {
    permissionsState.value = ["members:view", "events:update"];
    renderLive();

    expect(screen.getByRole("button", { name: "Edit event" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull();
    // The roster is `events:update`'s, not `events:delete`'s.
    expect(screen.getByTestId("attendance-roster")).toBeInTheDocument();
  });

  it("holds the roster and the header actions back while permissions load", () => {
    permissionsState.value = undefined;
    renderLive();

    expect(screen.queryByTestId("attendance-roster")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
    expect(screen.getByTestId("my-check-in")).toBeInTheDocument();
  });

  it("tells the check-in block which zone the event has", () => {
    permissionsState.value = ["members:view"];
    const zone = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
    ];
    const { unmount } = renderLive({ ...baseEvent, check_in_zone: zone });
    expect(screen.getByTestId("my-check-in")).toHaveAttribute("data-zone", "zone");
    unmount();

    renderLive({ ...baseEvent, check_in_zone: zone.slice(0, 2) });
    expect(screen.getByTestId("my-check-in")).toHaveAttribute(
      "data-zone",
      "malformed",
    );
  });
});
