import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

// usingPreviewData renders from the `event` prop and gates out AttendancePanel;
// stub the live hooks so the sheet renders without a query client / API.
vi.mock("@repo/hooks", () => ({
  useEvent: () => ({ data: undefined, isLoading: false, isError: false }),
  useDeleteEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  // Edit and Delete both hit paid-ops event routes, so the sheet reads the
  // chapter's subscription now (#841). Existing cases default to active.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:view"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
