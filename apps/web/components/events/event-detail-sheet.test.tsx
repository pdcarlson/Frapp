import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockDownloadIcs,
  mockResetDownloadIcs,
  mockToast,
  mockIcsState,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockDownloadIcs: vi.fn(),
  mockResetDownloadIcs: vi.fn(),
  mockToast: vi.fn(),
  // Read directly (not via React state) so a test can flip it before
  // rendering to cover the pending UI without wiring a stateful mock.
  mockIcsState: { isPending: false },
}));

// usingPreviewData renders from the `event` prop and gates out AttendancePanel;
// stub the live hooks so the sheet renders without a query client / API.
vi.mock("@repo/hooks", () => ({
  useEvent: () => ({ data: undefined, isLoading: false, isError: false }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDownloadEventIcs: () => ({
    mutateAsync: mockDownloadIcs,
    isPending: mockIcsState.isPending,
    reset: mockResetDownloadIcs,
  }),
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

vi.mock("@/hooks/use-toast", () => ({
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
  mockDownloadIcs.mockReset();
  mockResetDownloadIcs.mockReset();
  mockToast.mockReset();
  mockIcsState.isPending = false;
});

describe("EventDetailSheet role targeting", () => {
  it("resolves and renders required role names for a targeted event", () => {
    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        event={{ ...baseEvent, required_role_ids: ["r1"] }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(screen.getByText("Required roles")).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument();
    expect(screen.queryByText("All members")).not.toBeInTheDocument();
  });

  it("shows 'All members' when the event targets no roles", () => {
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

    expect(screen.getByText("All members")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /delete event/i })).toBeDisabled();
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

describe("EventDetailSheet check-in zone", () => {
  it("names the zone and counts its points when one is set", () => {
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

    expect(screen.getByText("Great Hall")).toBeInTheDocument();
    expect(screen.getByText(/4 points/)).toBeInTheDocument();
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

describe("EventDetailSheet Add to calendar", () => {
  // jsdom does not implement the Blob URL APIs the download path uses.
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("downloads the .ics returned by the API on click", async () => {
    const icsBlob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    mockDownloadIcs.mockResolvedValue(icsBlob);
    const user = userEvent.setup();

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

    await user.click(
      screen.getByRole("button", { name: /add to calendar/i }),
    );

    await waitFor(() => {
      expect(mockDownloadIcs).toHaveBeenCalledWith("e1");
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(icsBlob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("toasts an error rather than downloading when the API call fails", async () => {
    mockDownloadIcs.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

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

    await user.click(
      screen.getByRole("button", { name: /add to calendar/i }),
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not export calendar file",
          description: "network down",
          variant: "destructive",
        }),
      );
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows a spinner and disables the button while the export is pending", () => {
    mockIcsState.isPending = true;

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

    const button = screen.getByRole("button", { name: /add to calendar/i });
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  // Preview mode has no live event id to export, so the button must not
  // attempt a download — the whole point of this state.
  it("disables the button and never calls the API in preview mode", async () => {
    const user = userEvent.setup();

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

    const button = screen.getByRole("button", { name: /add to calendar/i });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(mockDownloadIcs).not.toHaveBeenCalled();
  });

  // The downloaded filename should read as the event, not its opaque id —
  // three exports in a session must not all land as indistinguishable uuids.
  it("names the download after the event, not its raw id", async () => {
    const icsBlob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    mockDownloadIcs.mockResolvedValue(icsBlob);
    const user = userEvent.setup();
    let downloadNameAtClick: string | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadNameAtClick = this.download;
      });

    render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        event={{ ...baseEvent, name: "Exec Sync!! (Weekly)" }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /add to calendar/i }),
    );

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect(downloadNameAtClick).toBe("exec-sync-weekly.ics");

    clickSpy.mockRestore();
  });

  // events-page.tsx renders one <EventDetailSheet> and swaps the `event` prop
  // rather than remounting per event, so without a reset the mutation's
  // isPending/error state from event A would still be showing while event B
  // is open.
  it("resets the mutation state when a different event is opened", () => {
    const { rerender } = render(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        event={baseEvent}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );
    mockResetDownloadIcs.mockClear();

    rerender(
      <EventDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        event={{ ...baseEvent, id: "e2", name: "Other Event" }}
        onRequestEdit={() => {}}
        onEventDeleted={() => {}}
      />,
    );

    expect(mockResetDownloadIcs).toHaveBeenCalled();
  });
});
