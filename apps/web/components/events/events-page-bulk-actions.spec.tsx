import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// #336: the events bulk bar used to toast "not available yet" for all three
// actions. Mark attendance complete now genuinely calls the real
// auto-absent endpoint (already exposed as `useAutoAbsent`); Notify
// assignees and Archive selected are gone entirely — events have no
// assignee concept and no archive state, so there was no real mutation to
// wire without inventing one.

const { autoAbsentMutateAsync, access } = vi.hoisted(() => ({
  autoAbsentMutateAsync: vi.fn(),
  access: {
    permissions: ["events:update"] as string[],
    subscription: "active",
  },
}));

// Dates relative to the suite's clock: Chapter Meeting is tomorrow, inside
// the default Upcoming window and its two-week horizon; Last Formal was
// yesterday, so only Past shows it.
const EVENTS = [
  {
    id: "evt-1",
    name: "Chapter Meeting",
    location: "Great Hall",
    // Tomorrow, inside the list's two-week horizon whenever the suite runs.
    start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    is_mandatory: true,
    point_value: 5,
  },
  // Over since yesterday, so its check-in has closed and auto-absent can run.
  // Shown under the Past time filter.
  {
    id: "evt-past",
    name: "Last Formal",
    location: null,
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    is_mandatory: true,
    point_value: 0,
  },
];

// "This time last year" (#3930) has its own spec.
vi.mock("@/components/ai/suggested-events", () => ({
  SuggestedEvents: () => null,
  useRecordPlannedEvent: () => async () => undefined,
}));

vi.mock("@repo/hooks", () => ({
  // The toolbar's Subscribe menu (#3322) asks for nothing until it opens.
  useCalendarFeedLink: () => ({ data: undefined, isError: false }),
  useResetCalendarFeedLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  calendarAppLinks: () => null,
  useCalendarTasks: () => ({ items: [], hasMine: false, hasAssigned: false }),
  useChapterRoster: () => ({ data: [] }),
  useCurrentChapter: () => ({
    data: { subscription_status: access.subscription, past_due_since: null },
    isPending: false,
    isError: false,
  }),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvent: () => ({ data: undefined, isPending: false, isError: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  useEvents: () => ({
    data: EVENTS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAutoAbsent: () => ({
    mutateAsync: autoAbsentMutateAsync,
    isPending: false,
  }),
  useMyPermissions: () => ({ data: { permissions: access.permissions } }),
  useNow: () => Date.now(),
}));

// The viewer whose last view (List or Calendar) the page reads; no stored
// choice unless a test writes one.
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "user-1", isLoading: false }),
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
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// The realtime subscription needs a QueryClientProvider and a Supabase
// client; neither is part of what this file covers.
vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

import { EventsPage } from "./events-page";

// Bulk actions sit behind Select (#3822): the default list has no checkboxes.
async function selectChapterMeeting(
  user: ReturnType<typeof userEvent.setup> = userEvent.setup(),
) {
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(
    screen.getByRole("checkbox", { name: /select chapter meeting/i }),
  );
}

/** Sets the list's time window through the Filter popover. */
async function showTime(
  user: ReturnType<typeof userEvent.setup>,
  name: "Upcoming" | "Past" | "All",
) {
  await user.click(screen.getByRole("button", { name: /^filter events/i }));
  await user.click(
    within(screen.getByRole("radiogroup", { name: "Time" })).getByRole(
      "radio",
      { name },
    ),
  );
  await user.keyboard("{Escape}");
}

// The one event whose check-in has closed, so the one auto-absent is sent for
// (#3905). It sits under Past.
async function selectLastFormal(user: ReturnType<typeof userEvent.setup>) {
  await showTime(user, "Past");
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(
    screen.getByRole("checkbox", { name: /select last formal/i }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  access.permissions = ["events:update"];
  access.subscription = "active";
});

describe("EventsPage bulk actions", () => {
  it("offers no selection to a role that can't update events", () => {
    // Auto-absent is `events:update` on the server: a member would only
    // collect a 403 per event.
    access.permissions = [];
    render(<EventsPage />);
    expect(screen.getByText("Chapter Meeting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps the bulk action disabled while the subscription blocks event writes", async () => {
    access.subscription = "canceled";
    render(<EventsPage />);
    await selectChapterMeeting();
    expect(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    ).toBeDisabled();
  });

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
    await selectLastFormal(user);

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
      within(dialog).getByRole("button", {
        name: /^mark attendance complete$/i,
      }),
    );

    await waitFor(() =>
      expect(autoAbsentMutateAsync).toHaveBeenCalledWith("evt-past"),
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
    await selectChapterMeeting(user);
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(autoAbsentMutateAsync).not.toHaveBeenCalled();
  });

  it("marks only the selected rows on screen, never one a filter hid", async () => {
    autoAbsentMutateAsync.mockResolvedValue({ marked: 1 });
    const user = userEvent.setup();
    render(<EventsPage />);

    // Tick tomorrow's meeting under Upcoming, then switch to Past, where it's
    // hidden, and tick the one row there.
    await selectChapterMeeting(user);
    await showTime(user, "Past");
    await user.click(
      screen.getByRole("checkbox", { name: /select last formal/i }),
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/mark attendance complete for 1 event\?/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: /^mark attendance complete$/i,
      }),
    );

    await waitFor(() =>
      expect(autoAbsentMutateAsync).toHaveBeenCalledWith("evt-past"),
    );
    expect(autoAbsentMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("reports a partial failure without clearing the selection", async () => {
    autoAbsentMutateAsync.mockRejectedValue({
      statusCode: 400,
      message: "Cannot mark auto-absent before the grace period ends",
    });
    const user = userEvent.setup();
    render(<EventsPage />);
    await selectLastFormal(user);
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: /^mark attendance complete$/i,
      }),
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
            "Last Formal: Wait until the grace period ends to mark absences.",
          ),
        }),
      ),
    );
    // Selection survives a failure so the officer can retry once the grace
    // period passes, rather than having to re-select from scratch.
    expect(
      screen.getByRole("checkbox", { name: /select last formal/i }),
    ).toBeChecked();
  });

  it("doesn't send an event whose check-in hasn't closed, and names it (FRAPP-WEB-7)", async () => {
    // The API refuses auto-absent until check-in closes, 15 minutes after
    // the end; sending it anyway only produced that 400, reported to Sentry.
    const user = userEvent.setup();
    render(<EventsPage />);
    await selectChapterMeeting(user);
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: /^mark attendance complete$/i,
      }),
    );

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Some events couldn't be finalized",
          description: expect.stringMatching(
            /0 succeeded, 1 failed\. Chapter Meeting: Check-in hasn't closed yet; it closes .+ · /,
          ),
        }),
      ),
    );
    expect(autoAbsentMutateAsync).not.toHaveBeenCalled();
  });

  it("names each failure against its own event when some are held back and some rejected", async () => {
    // `results` lines up with the events sent, not with the selection.
    autoAbsentMutateAsync.mockRejectedValue({
      statusCode: 400,
      message: "Cannot mark auto-absent before the grace period ends",
    });
    const user = userEvent.setup();
    render(<EventsPage />);
    await showTime(user, "All");
    await selectChapterMeeting(user);
    await user.click(
      screen.getByRole("checkbox", { name: /select last formal/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /mark attendance complete/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: /^mark attendance complete$/i,
      }),
    );

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(
            /0 succeeded, 2 failed\. Chapter Meeting: Check-in hasn't closed yet;.*; Last Formal: Wait until the grace period ends/,
          ),
        }),
      ),
    );
    expect(autoAbsentMutateAsync).toHaveBeenCalledTimes(1);
    expect(autoAbsentMutateAsync).toHaveBeenCalledWith("evt-past");
  });
});
