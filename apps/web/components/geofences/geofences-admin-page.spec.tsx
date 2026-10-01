import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const {
  mockCurrentChapter,
  mockCreateMutate,
  mockUpdateMutate,
  mockDeleteMutate,
  mockToast,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockCreateMutate: vi.fn().mockResolvedValue({}),
  mockUpdateMutate: vi.fn().mockResolvedValue({}),
  mockDeleteMutate: vi.fn().mockResolvedValue({}),
  mockToast: vi.fn(),
}));

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
  // Read by the board `4c` settings drawer's Access section, which reports
  // which roles hold each `geofences:*` permission.
  useRoles: () => ({ data: [], isPending: false, isError: false }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  // Drives the `4c` gear beside the page title. Read as a boolean rather than
  // through a second `<Can>`, so `can-fallback.spec.tsx`'s per-surface lookup
  // still finds this file's screen-level gate.
  useMyPermissions: () => ({
    data: { permissions: ["geofences:manage"] },
    isPending: false,
    isError: false,
  }),
  useGeofences: () => ({
    data: [ZONE],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateGeofence: () => ({
    mutateAsync: mockCreateMutate,
    isPending: false,
  }),
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

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

describe("GeofencesAdminPage study-rule guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  async function openCreate() {
    render(<GeofencesAdminPage />);
    await userEvent.click(createTrigger());
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Science library" },
    });
    fireEvent.change(screen.getByLabelText(/vertices/i), {
      target: { value: "30.286,-97.74\n30.287,-97.74\n30.287,-97.739" },
    });
  }

  const rate = (label: RegExp) => screen.getByLabelText(label);
  const submitCreate = () =>
    fireEvent.submit(document.getElementById("geofence-create-form")!);

  it("keeps each rate's last whole number through a negative or a decimal", async () => {
    await openCreate();
    expectRefusedEntriesKeep(rate(/minutes per point/i), "30");
    expectRefusedEntriesKeep(rate(/points per interval/i), "2");
    expectRefusedEntriesKeep(rate(/min session/i), "15");
    expectRefusedEntriesKeep(rate(/pause grace/i), "5");
  });

  it("reads an emptied or unparseable rate as blank", async () => {
    await openCreate();
    expectClearingEntriesEmpty(rate(/minutes per point/i), "30");
    expectClearingEntriesEmpty(rate(/points per interval/i), "2");
    expectClearingEntriesEmpty(rate(/min session/i), "15");
    expectClearingEntriesEmpty(rate(/pause grace/i), "5");
  });

  it("keeps the 0 left by deleting a leading digit, so the edit isn't refused mid-way", async () => {
    await openCreate();
    for (const label of [
      /minutes per point/i,
      /points per interval/i,
      /min session/i,
      /pause grace/i,
    ]) {
      fireEvent.change(rate(label), { target: { value: "30" } });
      fireEvent.change(rate(label), { target: { value: "0" } });
      expect(rate(label)).toHaveValue(0);
    }
  });

  it.each([/minutes per point/i, /points per interval/i, /pause grace/i])(
    "refuses %s under its floor of 1 at save, on create",
    async (label) => {
      await openCreate();
      fireEvent.change(rate(label), { target: { value: "0" } });
      submitCreate();

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Check the zone's numbers" }),
        ),
      );
      expect(mockCreateMutate).not.toHaveBeenCalled();
    },
  );

  it.each([/minutes per point/i, /points per interval/i, /pause grace/i])(
    "refuses %s under its floor of 1 at save, on edit",
    async (label) => {
      render(<GeofencesAdminPage />);
      await userEvent.click(editButton());
      fireEvent.change(rate(label), { target: { value: "0" } });
      fireEvent.submit(document.getElementById("geofence-edit-form")!);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Check the zone's numbers" }),
        ),
      );
      expect(mockUpdateMutate).not.toHaveBeenCalled();
    },
  );

  it("creates with the kept whole numbers, never NaN or Infinity", async () => {
    await openCreate();
    fireEvent.change(rate(/minutes per point/i), { target: { value: "45" } });
    fireEvent.change(rate(/minutes per point/i), { target: { value: "1.5" } });
    submitCreate();

    await waitFor(() => expect(mockCreateMutate).toHaveBeenCalledTimes(1));
    expect(mockCreateMutate.mock.calls[0]![0]).toMatchObject({
      minutes_per_point: 45,
      points_per_interval: 1,
      min_session_minutes: 15,
      pause_grace_minutes: 5,
    });
  });

  it("refuses an emptied rate rather than sending 1 in its place", async () => {
    await openCreate();
    fireEvent.change(rate(/minutes per point/i), { target: { value: "" } });
    submitCreate();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Check the zone's numbers" }),
      ),
    );
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("guards the edit dialog's four rates the same way", async () => {
    render(<GeofencesAdminPage />);
    await userEvent.click(editButton());
    expectRefusedEntriesKeep(rate(/minutes per point/i), "30");
    expectRefusedEntriesKeep(rate(/points per interval/i), "1");
    expectRefusedEntriesKeep(rate(/min session/i), "15");
    expectRefusedEntriesKeep(rate(/pause grace/i), "5");
    expectClearingEntriesEmpty(rate(/minutes per point/i), "30");
    expectClearingEntriesEmpty(rate(/points per interval/i), "1");
    expectClearingEntriesEmpty(rate(/min session/i), "15");
    expectClearingEntriesEmpty(rate(/pause grace/i), "5");
  });

  it("saves a 0-minute minimum session as 0, not rewritten to 1", async () => {
    render(<GeofencesAdminPage />);
    await userEvent.click(editButton());
    fireEvent.change(rate(/min session/i), { target: { value: "0" } });
    fireEvent.submit(document.getElementById("geofence-edit-form")!);

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    expect(mockUpdateMutate.mock.calls[0]![0].body.min_session_minutes).toBe(0);
  });
});
