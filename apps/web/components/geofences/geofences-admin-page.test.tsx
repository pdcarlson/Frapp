import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockUpdateMutate, mockDeleteMutate } = vi.hoisted(
  () => ({
    mockCurrentChapter: vi.fn(),
    mockUpdateMutate: vi.fn().mockResolvedValue({}),
    mockDeleteMutate: vi.fn().mockResolvedValue({}),
  }),
);

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const ZONE = {
  id: "gf-1",
  chapter_id: "chap-1",
  name: "Main library",
  coordinates: [
    { lat: 30.286, lng: -97.74 },
    { lat: 30.287, lng: -97.74 },
    { lat: 30.287, lng: -97.739 },
  ],
  is_active: true,
  minutes_per_point: 30,
  points_per_interval: 1,
  min_session_minutes: 15,
  pause_grace_minutes: 5,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useGeofences: () => ({
    data: [ZONE],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateGeofence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateGeofence: () => ({
    mutateAsync: mockUpdateMutate,
    isPending: false,
  }),
  useDeleteGeofence: () => ({
    mutateAsync: mockDeleteMutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { GeofencesAdminPage } = await import("./geofences-admin-page");

const chapter = chapterSubscription(mockCurrentChapter);

const createTrigger = () =>
  screen.getByRole("button", { name: /new study zone/i });
const editButton = () => screen.getByRole("button", { name: /^edit$/i });
const disableButton = () => screen.getByRole("button", { name: /disable/i });
const deleteButton = () => screen.getByRole("button", { name: /delete/i });

describe("GeofencesAdminPage subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves every write alone on an active chapter", () => {
    chapter.active();
    render(<GeofencesAdminPage />);

    expect(createTrigger()).toBeEnabled();
    expect(editButton()).toBeEnabled();
    expect(disableButton()).toBeEnabled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the create trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<GeofencesAdminPage />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    // §5 rule 4: disabled, not hidden — the zones are still readable.
    expect(screen.getByText(/main library/i)).toBeInTheDocument();

    // And the dialog must not open onto a doomed action.
    await userEvent.click(createTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates the row writes too, not just the create trigger", () => {
    // PATCH and DELETE /v1/geofences/:id sit behind the same guard, so leaving
    // these live would have the page claim writes are blocked while offering
    // three of them.
    chapter.incomplete();
    render(<GeofencesAdminPage />);

    expect(editButton()).toBeDisabled();
    expect(disableButton()).toBeDisabled();
    expect(deleteButton()).toBeDisabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    render(<GeofencesAdminPage />);

    const describedBy = createTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(deleteButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops geofence writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<GeofencesAdminPage />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than checkout", () => {
    chapter.canceled();
    render(<GeofencesAdminPage />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate prevents: a trigger that paints enabled
    // for that round trip still lets a fast click reach a doomed form.
    chapter.loading();
    render(<GeofencesAdminPage />);

    expect(createTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its study
    // zones; the server guard is still the enforcement.
    chapter.unreadable();
    render(<GeofencesAdminPage />);

    expect(createTrigger()).toBeEnabled();
    expect(editButton()).toBeEnabled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes the editor when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there.
    chapter.active();
    const { rerender } = render(<GeofencesAdminPage />);
    await userEvent.click(editButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.pastDue();
    rerender(<GeofencesAdminPage />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("still opens the editor and toggles a zone on an active chapter", async () => {
    chapter.active();
    render(<GeofencesAdminPage />);

    await userEvent.click(disableButton());
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);

    await userEvent.click(editButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });
});
