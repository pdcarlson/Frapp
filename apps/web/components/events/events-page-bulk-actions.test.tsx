import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// #336: the events bulk bar used to toast "not available yet" for all three
// actions. Mark attendance complete now genuinely calls the real
// auto-absent endpoint (already exposed as `useAutoAbsent`); Notify
// assignees and Archive selected are gone entirely — events have no
// assignee concept and no archive state, so there was no real mutation to
// wire without inventing one.

const { autoAbsentMutateAsync } = vi.hoisted(() => ({
  autoAbsentMutateAsync: vi.fn(),
}));

// Default `timeFilter` is "upcoming", which drops anything before "now" — a
// far-future date keeps this fixture upcoming regardless of when the suite
// actually runs.
const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter Meeting",
    location: "Great Hall",
    start_time: "2099-01-01T18:00:00.000Z",
    end_time: "2099-01-01T19:00:00.000Z",
    is_mandatory: true,
    point_value: 5,
  },
];

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => ({
    data: { subscription_status: "active", past_due_since: null },
    isPending: false,
    isError: false,
  }),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  useEvents: () => ({ data: EVENTS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAutoAbsent: () => ({ mutateAsync: autoAbsentMutateAsync, isPending: false }),
  useNow: () => Date.now(),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("./event-detail-sheet", () => ({ EventDetailSheet: () => null }));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

// The realtime subscription needs a QueryClientProvider and a Supabase
// client; neither is part of what this file covers.
vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

import { EventsPage } from "./events-page";

function selectChapterMeeting() {
  return userEvent.setup().click(
    screen.getByRole("checkbox", { name: /select chapter meeting/i }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventsPage bulk actions", () => {
  it("never renders Notify assignees or Archive selected — no real mutation exists for either", async () => {
    render(<EventsPage />);
    await selectChapterMeeting();

    expect(
      screen.queryByRole("button", { name: /notify assignees/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /archive selected/i }),
    ).not.toBeInTheDocument();
  });

  it("confirms before finalizing attendance, then calls the real auto-absent endpoint", async () => {
    autoAbsentMutateAsync.mockResolvedValue({ marked: 3 });
    const user = userEvent.setup();
    render(<EventsPage />);
    await user.click(screen.getByRole("checkbox", { name: /select chapter meeting/i }));

    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/mark attendance complete for 1 event/i),
    ).toBeInTheDocument();
    // Not yet called — the confirmation gates the mutation.
    expect(autoAbsentMutateAsync).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: /^mark attendance complete$/i }),
    );

    await waitFor(() =>
      expect(autoAbsentMutateAsync).toHaveBeenCalledWith("evt-1"),
    );
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Attendance finalized" }),
      ),
    );
  });

  it("cancelling the confirmation never calls the mutation", async () => {
    const user = userEvent.setup();
    render(<EventsPage />);
    await user.click(screen.getByRole("checkbox", { name: /select chapter meeting/i }));
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(autoAbsentMutateAsync).not.toHaveBeenCalled();
  });

  it("reports a partial failure without clearing the selection", async () => {
    autoAbsentMutateAsync.mockRejectedValue(
      new Error("Cannot mark auto-absent before the grace period ends"),
    );
    const user = userEvent.setup();
    render(<EventsPage />);
    await user.click(screen.getByRole("checkbox", { name: /select chapter meeting/i }));
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^mark attendance complete$/i }),
    );

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Some events couldn't be finalized",
          variant: "destructive",
          // Names the event and the real rejection reason, rather than a
          // generic "probably the grace period" guess that would be wrong
          // here — the mutation actually rejected with a different message.
          description: expect.stringContaining(
            "Chapter Meeting: Cannot mark auto-absent before the grace period ends",
          ),
        }),
      ),
    );
    // Selection survives a failure so the officer can retry once the grace
    // period passes, rather than having to re-select from scratch.
    expect(
      screen.getByRole("checkbox", { name: /select chapter meeting/i }),
    ).toBeChecked();
  });
});
