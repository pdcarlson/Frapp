import { formatDateEntry, parseDateEntry } from "@repo/formatting";
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

// Capture the create/update mutation args. `vi.hoisted` runs before the hoisted
// `vi.mock` factory, so the spies exist when the factory wires them in.
const {
  createMutate,
  updateMutate,
  mockCurrentChapter,
  mockToast,
  mockPermissions,
  useEventMock,
  useEventsMock,
} = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  mockCurrentChapter: vi.fn(),
  mockToast: vi.fn(),
  // An officer who edits events unless a case says otherwise (#3709: points
  // and required attendance are theirs).
  mockPermissions: { list: ["events:update"] as string[] },
  // The series parent a generated meeting reads; none unless a case sets it.
  useEventMock: vi.fn<
    (id: unknown) => { data: unknown; isPending: boolean; isError: boolean }
  >(() => ({ data: undefined, isPending: false, isError: false })),
  // The chapter's events, for a started series' next meeting (#4746); none
  // unless a case sets them.
  useEventsMock: vi.fn<
    (options?: { enabled?: boolean }) => {
      data: unknown;
      isLoading: boolean;
    }
  >(() => ({ data: undefined, isLoading: false })),
}));

vi.mock("@repo/hooks", () => ({
  EVENT_CREATE_UNCONFIRMED: "unconfirmed-sentinel",
  useCreateEvent: () => ({ mutateAsync: createMutate, isPending: false }),
  useEvent: (id: unknown) => useEventMock(id),
  useEvents: (options?: { enabled?: boolean }) => useEventsMock(options),
  useUpdateEvent: () => ({ mutateAsync: updateMutate, isPending: false }),
  useEventTypes: () => ({
    data: [
      {
        id: "type-meeting",
        chapter_id: "chap-1",
        name: "Chapter meeting",
        point_value: 10,
        is_mandatory: true,
        position: 1,
        created_at: "2026-11-11T00:00:00.000Z",
        updated_at: "2026-11-11T00:00:00.000Z",
      },
      {
        id: "type-social",
        chapter_id: "chap-1",
        name: "Social",
        point_value: 0,
        is_mandatory: false,
        position: 2,
        created_at: "2026-11-11T00:00:00.000Z",
        updated_at: "2026-11-11T00:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  useCreateEventType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEventType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEventType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({
    data: [
      { id: "r1", name: "Exec" },
      { id: "r2", name: "Committee" },
    ],
    isError: false,
  }),
  // The event routes behind this dialog are paid-ops, so it reads the chapter's
  // subscription now (#841). Every case here predates the gate and asserts
  // editing behaviour, so they all run against an active chapter.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: mockPermissions.list },
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

import { EventEditorDialog } from "./event-editor-dialog";
import { chapterSubscription } from "@/tests/chapter-subscription";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const chapter = chapterSubscription(mockCurrentChapter);

/** Open "More options", which starts closed on create. Safe to call twice. */
function openMoreOptions() {
  const more = screen.queryByRole("button", { name: /More options/ });
  if (more) fireEvent.click(more);
}

/** Open More options and the check-in zone under it. */
function openZone() {
  openMoreOptions();
  if (!screen.queryByRole("button", { name: "Add point" })) {
    fireEvent.click(screen.getByRole("button", { name: /Check-in zone/ }));
  }
}

/** One end of the schedule: a day typed into the date field, and a time. */
function setSchedule(end: "Starts" | "Ends", day: string, time: string) {
  fireEvent.change(screen.getByLabelText(`${end}, day`), {
    target: { value: day },
  });
  fireEvent.change(screen.getByLabelText(`${end}, time`), {
    target: { value: time },
  });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: "Exec Sync" },
  });
  setSchedule("Starts", "2026-07-01", "18:00");
  setSchedule("Ends", "2026-07-01", "19:00");
}

describe("EventEditorDialog form shape and attendance by role", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
  }

  it("opens on the four fields every event needs, and says what the rest hold", () => {
    renderCreate();
    expect(screen.queryByLabelText("Points for attending")).toBeNull();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("10 points · Optional for everyone · Doesn't repeat");
  });

  it("keeps meeting minutes to an edit, after the event exists", () => {
    renderCreate();
    openMoreOptions();
    expect(screen.queryByLabelText("Meeting minutes")).toBeNull();
  });

  it("labels the notes field as meeting minutes on edit", () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e0",
          name: "Chapter",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    expect(screen.getByLabelText("Meeting minutes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Internal notes")).not.toBeInTheDocument();
  });

  it("creates an event required for one role and optional for everyone else", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    fireEvent.click(
      within(
        await screen.findByRole("radiogroup", { name: "Attendance for Exec" }),
      ).getByRole("radio", { name: "Required" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByText(/13 meetings, the last on Sep 23\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).toMatchObject({
      is_mandatory: false,
      others_invited: true,
      required_role_ids: ["r1"],
      // Weekly on the start's day at its default length is the legacy
      // token, which shipped phones read (#4488).
      recurrence_rule: "WEEKLY",
    });
    expect(body).not.toHaveProperty("optional_role_ids");
  });

  it("makes a twice-a-week series that ends on a date (#4488, #3662)", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    // The start's weekday is on; one more chip makes it twice a week.
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((chip) => chip.getAttribute("aria-label"));
    expect(pressed).toHaveLength(1);
    const other = pressed[0] === "Monday" ? "Thursday" : "Monday";
    fireEvent.click(screen.getByRole("button", { name: other }));
    fireEvent.click(screen.getByRole("radio", { name: "On date" }));
    // Offered the day the 13 meetings would have ended on.
    expect(screen.getByText(/meetings, the last on/)).toBeTruthy();
    // A picked end date says its own length, and is the one sent.
    fireEvent.change(screen.getByLabelText("Ends on"), {
      target: { value: "2026-07-15" },
    });
    expect(
      screen.getByText(/^\d meetings, the last on Jul 1\d\./),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0].recurrence_rule).toMatch(
      /^FREQ=WEEKLY;INTERVAL=1;BYDAY=[A-Z]{2},[A-Z]{2};UNTIL=20260715;TZID=/,
    );
  });

  describe("Repeat on an edit (#4488)", () => {
    // A Monday series whose first meeting is still ahead.
    const RULE =
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=10;TZID=America/New_York";
    const head = {
      id: "h1",
      name: "Chapter",
      start_time: "2027-07-05T23:00:00.000Z",
      end_time: "2027-07-06T00:00:00.000Z",
      point_value: 10,
      recurrence_rule: RULE,
    };
    const renderEdit = (event: Record<string, unknown>) =>
      render(
        <EventEditorDialog
          open
          mode="edit"
          event={event}
          usingPreviewData={false}
          onOpenChange={() => {}}
          onSaved={async () => {}}
        />,
      );
    const saved = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
      return updateMutate.mock.calls[0]![0].body as Record<string, unknown>;
    };

    it("asks which events a rename is for, and sends only the name", async () => {
      renderEdit(head);
      expect(screen.queryByText(/meetings, the last on/)).toBeNull();
      fireEvent.change(screen.getByLabelText("Event name"), {
        target: { value: "Chapter meeting" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      // The question Google Calendar, Apple Calendar and Outlook ask (#3667).
      expect(await screen.findByText("This is a repeating event")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "This event only" }));
      await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
      // No time or location, so the chapter isn't paged for a rename, and the
      // unchanged rule isn't sent: a sent rule rebuilds the series.
      expect(updateMutate.mock.calls[0]![0]).toEqual({
        id: "h1",
        body: { name: "Chapter meeting", scope: "instance" },
      });
    });

    it("sends a rename to every upcoming event when asked", async () => {
      renderEdit(head);
      fireEvent.change(screen.getByLabelText("Event name"), {
        target: { value: "Chapter meeting" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "All upcoming events" }),
      );
      await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
      expect(updateMutate.mock.calls[0]![0].body).toEqual({
        name: "Chapter meeting",
        scope: "series",
      });
    });

    it("sends nothing when nothing changed", async () => {
      const onOpenChange = vi.fn();
      render(
        <EventEditorDialog
          open
          mode="edit"
          event={head}
          usingPreviewData={false}
          onOpenChange={onOpenChange}
          onSaved={async () => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(updateMutate).not.toHaveBeenCalled();
      expect(screen.queryByText("This is a repeating event")).toBeNull();
    });

    it("moves stored weekdays with a start moved in the same save", async () => {
      renderEdit(head);
      // Monday Jul 5 → Tuesday Jul 6, same time, and 8 meetings.
      fireEvent.change(screen.getByLabelText("Starts, day"), {
        target: { value: "2027-07-06" },
      });
      fireEvent.change(screen.getByLabelText("Ends after how many meetings"), {
        target: { value: "8" },
      });
      // The chip lit is the day saved.
      expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const body = await saved();
      expect(body).toMatchObject({
        recurrence_rule: RULE.replace("MO;COUNT=10", "TU;COUNT=8"),
        scope: "series",
      });
    });

    it("sends a changed rule to the whole series", async () => {
      renderEdit(head);
      fireEvent.change(screen.getByLabelText("Ends after how many meetings"), {
        target: { value: "6" },
      });
      expect(screen.getByText(/^6 meetings, the last on Aug 9/)).toBeTruthy();
      const body = await saved();
      expect(body).toMatchObject({
        recurrence_rule: RULE.replace("COUNT=10", "COUNT=6"),
        scope: "series",
      });
    });

    it("ends the series with Doesn't repeat", async () => {
      renderEdit(head);
      fireEvent.click(screen.getByRole("radio", { name: "Doesn't repeat" }));
      const body = await saved();
      expect(body).toMatchObject({ recurrence_rule: null, scope: "series" });
    });

    describe("from a generated meeting", () => {
      // The second Monday, a week after the head.
      const occurrence = {
        ...head,
        id: "o1",
        start_time: "2027-07-12T23:00:00.000Z",
        end_time: "2027-07-13T00:00:00.000Z",
        recurrence_rule: null,
        parent_event_id: "h1",
      };
      afterEach(() => {
        useEventMock.mockImplementation(() => ({
          data: undefined,
          isPending: false,
          isError: false,
        }));
      });
      const withParent = () =>
        useEventMock.mockImplementation((id: unknown) => ({
          data: id === "h1" ? head : undefined,
          isPending: false,
          isError: false,
        }));

      it("reads the series' rule off its first meeting", () => {
        withParent();
        renderEdit(occurrence);
        expect(useEventMock).toHaveBeenCalledWith("h1");
        expect(
          screen.getByRole("radio", { name: "Doesn't repeat" }),
        ).toHaveAttribute("aria-checked", "false");
      });

      it("moves every upcoming meeting through the first, as a shift", async () => {
        withParent();
        renderEdit(occurrence);
        // A day later on this meeting is a day later on the first (the end
        // moves with the start).
        fireEvent.change(screen.getByLabelText("Starts, day"), {
          target: { value: "2027-07-13" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        fireEvent.click(
          await screen.findByRole("button", { name: "All upcoming events" }),
        );
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { id, body } = updateMutate.mock.calls[0]![0];
        const DAY = 24 * 60 * 60 * 1000;
        expect(id).toBe("h1");
        expect(body).toEqual({
          scope: "series",
          start_time: new Date(Date.parse(head.start_time) + DAY).toISOString(),
          end_time: new Date(Date.parse(head.end_time) + DAY).toISOString(),
        });
      });

      it("leaves the meeting after a series move rebuilds it", async () => {
        withParent();
        const onLeftEvent = vi.fn();
        updateMutate.mockResolvedValueOnce({ id: "h1" });
        render(
          <EventEditorDialog
            open
            mode="edit"
            event={occurrence}
            usingPreviewData={false}
            onOpenChange={() => {}}
            onSaved={async () => {}}
            onLeftEvent={onLeftEvent}
          />,
        );
        fireEvent.change(screen.getByLabelText("Starts, day"), {
          target: { value: "2027-07-13" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        fireEvent.click(
          await screen.findByRole("button", { name: "All upcoming events" }),
        );
        await waitFor(() => expect(onLeftEvent).toHaveBeenCalledTimes(1));
      });

      it("stays on the meeting after a rename of just this one", async () => {
        withParent();
        const onLeftEvent = vi.fn();
        const onOpenChange = vi.fn();
        updateMutate.mockResolvedValueOnce({ id: "o1" });
        render(
          <EventEditorDialog
            open
            mode="edit"
            event={occurrence}
            usingPreviewData={false}
            onOpenChange={onOpenChange}
            onSaved={async () => {}}
            onLeftEvent={onLeftEvent}
          />,
        );
        fireEvent.change(screen.getByLabelText("Event name"), {
          target: { value: "Chapter meeting" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        fireEvent.click(
          await screen.findByRole("button", { name: "This event only" }),
        );
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
        expect(onLeftEvent).not.toHaveBeenCalled();
      });

      it("says what to do when an All upcoming save is refused", async () => {
        withParent();
        updateMutate.mockRejectedValueOnce({ statusCode: 400, message: "x" });
        renderEdit(occurrence);
        fireEvent.change(screen.getByLabelText("Event name"), {
          target: { value: "Chapter meeting" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        fireEvent.click(
          await screen.findByRole("button", { name: "All upcoming events" }),
        );
        await waitFor(() =>
          expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({
              description: expect.stringMatching(
                /^That change can't be made to the whole series/,
              ),
            }),
          ),
        );
      });

      it("holds Save until the first meeting has loaded", () => {
        useEventMock.mockImplementation(() => ({
          data: undefined,
          isPending: true,
          isError: false,
        }));
        renderEdit(occurrence);
        expect(screen.getByText("Loading the series…")).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "Save changes" }),
        ).toBeDisabled();
      });

      it("locks Repeat when the first meeting can't be read", async () => {
        useEventMock.mockImplementation(() => ({
          data: undefined,
          isPending: false,
          isError: true,
        }));
        renderEdit(occurrence);
        expect(screen.getByText(/Part of a repeating series/)).toBeTruthy();
        expect(
          screen.queryByRole("radio", { name: "Doesn't repeat" }),
        ).toBeNull();
        fireEvent.change(screen.getByLabelText("Event name"), {
          target: { value: "Chapter meeting" },
        });
        // Without the first meeting a series time change can't be sent, so
        // the question isn't asked.
        const body = await saved();
        expect(body).toEqual({ name: "Chapter meeting", scope: "instance" });
      });
    });
  });

  // #4746: a Repeat change on a started series steps from its real next
  // meeting, read from the chapter's events, not from the rule's pattern.
  describe("Repeat on a started series", () => {
    // Monthly on the 5th from Mon 2027-07-05; the August meeting was moved
    // by hand to the 7th. The clock is past the head, before August.
    const RULE = "FREQ=MONTHLY;INTERVAL=1;COUNT=10;TZID=America/New_York";
    const head = {
      id: "h1",
      name: "Chapter",
      start_time: "2027-07-05T16:00:00.000Z",
      end_time: "2027-07-05T17:00:00.000Z",
      point_value: 10,
      recurrence_rule: RULE,
    };
    const child = (id: string, start: string) => ({
      ...head,
      id,
      start_time: start,
      end_time: start,
      recurrence_rule: null,
      parent_event_id: "h1",
    });
    const rows = [
      head,
      child("c-aug", "2027-08-07T16:00:00.000Z"),
      child("c-sep", "2027-09-05T16:00:00.000Z"),
    ];
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2027-07-20T12:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
      useEventsMock.mockImplementation(() => ({
        data: undefined,
        isLoading: false,
      }));
    });
    const renderEdit = () =>
      render(
        <EventEditorDialog
          open
          mode="edit"
          event={head}
          usingPreviewData={false}
          onOpenChange={() => {}}
          onSaved={async () => {}}
        />,
      );
    const shorten = () =>
      fireEvent.change(screen.getByLabelText("Ends after how many meetings"), {
        target: { value: "3" },
      });

    it("counts from the moved meeting the series really holds next", () => {
      useEventsMock.mockImplementation(() => ({
        data: rows,
        isLoading: false,
      }));
      renderEdit();
      expect(useEventsMock).toHaveBeenCalledWith({ enabled: true });
      shorten();
      expect(screen.getByText(/^3 meetings, the last on Oct 7/)).toBeTruthy();
    });

    it("counts from the rule's pattern when the events can't be read", () => {
      renderEdit();
      shorten();
      expect(screen.getByText(/^3 meetings, the last on Oct 5/)).toBeTruthy();
    });

    it("holds Repeat and Save while the events load", () => {
      useEventsMock.mockImplementation(() => ({
        data: undefined,
        isLoading: true,
      }));
      renderEdit();
      expect(screen.getByText("Loading the series…")).toBeTruthy();
      expect(
        screen.queryByRole("radio", { name: "Doesn't repeat" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
    });
  });

  it("keeps Create from sending a series it can't make", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    fireEvent.change(screen.getByLabelText("Ends after how many meetings"), {
      target: { value: "1" },
    });
    expect(screen.getByText("A series holds 2 to 120 meetings.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("opens a copy of last year's event filled in, never repeating, and reports the event it made (#3930)", async () => {
    createMutate.mockResolvedValue({ id: "evt-new" });
    const onCreated = vi.fn();
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        template={{
          id: "evt-old",
          name: "Winter Formal 2026",
          description: "Buses leave at 8:15.",
          location: "Hilton Ballroom",
          point_value: 15,
          // Last year's repeat is not this year's plan.
          recurrence_rule: "WEEKLY",
        }}
        initialStartAt="2026-12-05T21:00"
        initialEndAt="2026-12-06T01:00"
        onCreated={onCreated}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Event name") as HTMLInputElement).value,
    ).toBe("Winter Formal 2026");
    expect(
      (screen.getByLabelText("Starts, day") as HTMLInputElement).value,
    ).toContain("December 5");
    expect(
      (screen.getByLabelText("Starts, time") as HTMLInputElement).value,
    ).toBe("21:00");
    // Nothing is made until the officer saves.
    expect(createMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: "Winter Formal 2026",
      location: "Hilton Ballroom",
      point_value: 15,
    });
    expect(body.recurrence_rule ?? null).toBeNull();
    expect(body).not.toHaveProperty("id");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("evt-new"));
  });

  it("sends no role list on create when nothing differs", async () => {
    renderCreate();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).not.toHaveProperty("required_role_ids");
    expect(body).toMatchObject({ is_mandatory: false });
    // A plain event leaves `others_invited` out: stored null reads the same,
    // and an API that predates the field still accepts the create.
    expect(body).not.toHaveProperty("others_invited");
  });

  it("refuses an event that invites nobody", async () => {
    renderCreate();
    fillRequiredFields();
    openMoreOptions();
    const everyone = screen.getByRole("radiogroup", {
      name: "Attendance for everyone else",
    });
    fireEvent.click(
      within(everyone).getByRole("radio", { name: "Not invited" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Nobody is invited" }),
      ),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("reads an officers-only event back and clears it on edit", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1"],
          others_invited: false,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    const everyone = screen.getByRole("radiogroup", {
      name: "Attendance for everyone else",
    });
    expect(
      within(everyone).getByRole("radio", { name: "Not invited" }),
    ).toHaveAttribute("aria-checked", "true");
    // Exec back to the default's answer leaves it following everyone else.
    fireEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "Attendance for Exec" }),
      ).getByRole("radio", { name: "Not invited" }),
    );
    fireEvent.click(within(everyone).getByRole("radio", { name: "Optional" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({
          required_role_ids: [],
          optional_role_ids: [],
          excluded_role_ids: [],
          others_invited: true,
        }),
      }),
    );
  });

  it("shows a role missing from the loaded list as a row it can reset", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e3",
          name: "Legacy Targeted",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          required_role_ids: ["r1", "legacyrole99"],
          others_invited: false,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    fireEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "Attendance for Removed role" }),
      ).getByRole("radio", { name: "Not invited" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ required_role_ids: ["r1"] }),
      }),
    );
  });
});

describe("EventEditorDialog check-in zone", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function addPoints(points: [string, string][]) {
    points.forEach(() =>
      fireEvent.click(screen.getByRole("button", { name: "Add point" })),
    );
    points.forEach(([lat, lng], index) => {
      fireEvent.change(screen.getByLabelText(`Point ${index + 1} latitude`), {
        target: { value: lat },
      });
      fireEvent.change(screen.getByLabelText(`Point ${index + 1} longitude`), {
        target: { value: lng },
      });
    });
  }

  const TRIANGLE: [string, string][] = [
    ["42.7298", "-73.6789"],
    ["42.7300", "-73.6780"],
    ["42.7290", "-73.6775"],
  ];

  it("sends check_in_zone and its name in the create payload", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Zone name"), {
      target: { value: "Great Hall" },
    });
    addPoints(TRIANGLE);
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        check_in_zone: [
          { lat: 42.7298, lng: -73.6789 },
          { lat: 42.73, lng: -73.678 },
          { lat: 42.729, lng: -73.6775 },
        ],
        check_in_zone_name: "Great Hall",
      }),
    );
  });

  // CreateEventDto carries @ArrayMinSize(3), so an empty array is a 400 rather
  // than "no zone" — the key has to be absent entirely. This is the asymmetry
  // with update below, and getting it backwards breaks every zone-less create.
  it("omits check_in_zone entirely on create when no points are entered", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ check_in_zone: expect.anything() }),
    );
  });

  it("blocks submit with the server's own wording when under 3 points", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE.slice(0, 2));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("at least 3 points"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range coordinate before it reaches the API", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints([["91", "0"], ...TRIANGLE.slice(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("between -90 and 90"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  // Number("") is 0, not NaN, so a row with one field filled would otherwise
  // pass the finite check and save a coordinate on the prime meridian.
  it("rejects a vertex row with only one of latitude and longitude filled", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE);
    fireEvent.change(screen.getByLabelText("Point 2 longitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          "Point 2 needs both a latitude and a longitude",
        ),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  // Blank rows are skipped, but skipping them must not renumber the rows the
  // officer is looking at.
  it("names the on-screen row number when a blank row precedes the bad one", async () => {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fillRequiredFields();
    addPoints(TRIANGLE);
    // Row 2 goes entirely blank; row 4 carries the out-of-range latitude.
    fireEvent.change(screen.getByLabelText("Point 2 latitude"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Point 2 longitude"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    fireEvent.change(screen.getByLabelText("Point 4 latitude"), {
      target: { value: "91" },
    });
    fireEvent.change(screen.getByLabelText("Point 4 longitude"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Point 4"),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("seeds a stored zone on edit and clears it to an empty array", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
          ],
          check_in_zone_name: "Great Hall",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    expect(screen.getByLabelText("Point 1 latitude")).toHaveValue("1");
    expect(screen.getByLabelText("Zone name")).toHaveValue("Great Hall");

    // Removing row 1 three times empties the list — the rows renumber, so the
    // first "Remove point 1" click is repeated rather than 1/2/3 in turn.
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    // UpdateEventDto drops @ArrayMinSize so [] clears; the name clears with it.
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "e1",
        body: expect.objectContaining({
          check_in_zone: [],
          check_in_zone_name: "",
        }),
      }),
    );
  });

  it("reorders vertices, since order defines the polygon's edges", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e2",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          check_in_zone: [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
            { lat: 5, lng: 6 },
          ],
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openZone();

    fireEvent.click(screen.getByRole("button", { name: "Move point 1 down" }));
    expect(screen.getByLabelText("Point 1 latitude")).toHaveValue("3");
    expect(screen.getByLabelText("Point 2 latitude")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          check_in_zone: [
            { lat: 3, lng: 4 },
            { lat: 1, lng: 2 },
            { lat: 5, lng: 6 },
          ],
        }),
      }),
    );
  });
});

describe("EventEditorDialog point value guard (#2206)", () => {
  beforeEach(() => {
    mockToast.mockReset();
    createMutate.mockReset();
    createMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    openMoreOptions();
    return screen.getByLabelText("Points for attending");
  }

  it("keeps the last whole number through a negative or a decimal", () => {
    expectRefusedEntriesKeep(renderCreate(), "15");
  });

  it("carries no description restating the form", () => {
    renderCreate();

    expect(screen.queryByText(/configure scheduling/i)).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });

  it("keeps an emptied or unparseable field empty while the officer types", () => {
    const input = renderCreate();
    expectClearingEntriesEmpty(input, "15");
    // Before #2206 an emptied field snapped to 0, so the next digit read "05".
    fireEvent.change(input, { target: { value: "5" } });
    expect(input).toHaveValue(5);
  });

  it("saves an emptied field as 0 points, as it always has", async () => {
    const input = renderCreate();
    fillRequiredFields();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0].point_value).toBe(0);
  });

  it("refuses a stored negative on edit rather than saving it as 0", async () => {
    updateMutate.mockReset();
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e9",
          name: "Exec Sync",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          point_value: -5,
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Valid point value required" }),
      ),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("sends the kept whole number, never Infinity", async () => {
    const input = renderCreate();
    fillRequiredFields();
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0].point_value).toBe(15);
  });
});

/**
 * #3773 — web chat opens this form for `/event` typed bare or picked from the
 * palette, filled in with what was typed, and the card posts in that channel.
 */
describe("EventEditorDialog opened from chat (#3773)", () => {
  const CHANNEL = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    createMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue({ card_posted: true });
    chapter.active();
  });

  function renderFromChat(
    props: Partial<React.ComponentProps<typeof EventEditorDialog>> = {},
  ) {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
        postToChannelId={CHANNEL}
        {...props}
      />,
    );
  }

  it("opens filled in with what was typed", () => {
    renderFromChat({
      initialName: "Chapter Dinner",
      initialLocation: "Main House",
      initialPointValue: 5,
      initialStartAt: "2026-11-12T18:00",
      initialEndAt: "2026-11-12T20:00",
    });
    expect(screen.getByLabelText("Event name")).toHaveValue("Chapter Dinner");
    expect(screen.getByLabelText("Location")).toHaveValue("Main House");
    // The day is written out (#3937); the time is the browser's own input.
    expect(screen.getByLabelText("Starts, day")).toHaveValue(
      formatDateEntry("2026-11-12", new Date()),
    );
    expect(screen.getByLabelText("Starts, time")).toHaveValue("18:00");
    expect(screen.getByLabelText("Ends, time")).toHaveValue("20:00");
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("5 points");
  });

  it("carries the end with a moved start, keeping the length (#3937)", () => {
    renderFromChat({
      initialStartAt: "2026-11-12T18:00",
      initialEndAt: "2026-11-12T20:00",
    });
    fireEvent.change(screen.getByLabelText("Starts, day"), {
      target: { value: "2026-11-13" },
    });
    expect(screen.getByLabelText("Ends, day")).toHaveValue(
      formatDateEntry("2026-11-13", new Date()),
    );
    expect(screen.getByLabelText("Ends, time")).toHaveValue("20:00");
  });

  it("carries the end through a start typed a key at a time", () => {
    renderFromChat({
      initialStartAt: "2026-11-12T18:00",
      initialEndAt: "2026-11-12T20:00",
    });
    // "11/1" on the way reads as some other November 1, and "1" as nothing:
    // the end follows the whole move, not each keystroke.
    for (const typed of ["1", "11", "11/", "11/1", "11/14"]) {
      fireEvent.change(screen.getByLabelText("Starts, day"), {
        target: { value: typed },
      });
    }
    const start = parseDateEntry("11/14", new Date())!;
    expect(screen.getByLabelText("Ends, day")).toHaveValue(
      formatDateEntry(start, new Date()),
    );
    expect(screen.getByLabelText("Ends, time")).toHaveValue("20:00");
  });

  it("posts the card in the channel it came from", async () => {
    renderFromChat();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body.channel_id).toBe(CHANNEL);
    expect(body.client_message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Exec Sync was added to the chapter calendar.",
      }),
    );
  });

  it("creates an event that keeps anyone out without a card, and says why", async () => {
    // The API refuses a card for these: it would show the event to everyone
    // in the channel (`EventService.create`).
    renderFromChat();
    fillRequiredFields();
    openMoreOptions();
    fireEvent.click(
      within(
        screen.getByRole("radiogroup", {
          name: "Attendance for everyone else",
        }),
      ).getByRole("radio", { name: "Not invited" }),
    );
    fireEvent.click(
      within(
        await screen.findByRole("radiogroup", { name: "Attendance for Exec" }),
      ).getByRole("radio", { name: "Required" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const body = createMutate.mock.calls[0]![0];
    expect(body).not.toHaveProperty("channel_id");
    expect(body).not.toHaveProperty("client_message_id");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/isn't posted in chat/),
      }),
    );
  });

  it("says so when the event saved but its card didn't post", async () => {
    createMutate.mockResolvedValue({ card_posted: false });
    renderFromChat();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Event created",
          description: expect.stringMatching(/card couldn't be posted/),
        }),
      ),
    );
  });

  it("keeps a durable row in chat when the card didn't post, through the chat's tracker", async () => {
    createMutate.mockResolvedValue({ card_posted: false });
    const track = {
      clientMessageId: "22222222-2222-4222-8222-222222222222",
      failed: vi.fn(),
      lost: vi.fn(),
    };
    const trackChatCard = vi.fn(() => track);
    renderFromChat({ trackChatCard });
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(track.lost).toHaveBeenCalledTimes(1));
    expect(trackChatCard).toHaveBeenCalledWith(CHANNEL, "Exec Sync");
    expect(createMutate.mock.calls[0]![0].client_message_id).toBe(
      track.clientMessageId,
    );
    expect(track.failed).not.toHaveBeenCalled();
  });

  it("drops the chat placeholder when the create is refused", async () => {
    createMutate.mockRejectedValue(new Error("Forbidden"));
    const track = {
      clientMessageId: "33333333-3333-4333-8333-333333333333",
      failed: vi.fn(),
      lost: vi.fn(),
    };
    renderFromChat({ trackChatCard: () => track });
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(track.failed).toHaveBeenCalledTimes(1));
    expect(track.lost).not.toHaveBeenCalled();
  });

  it("says it couldn't confirm, not that it failed, when the answer was lost", async () => {
    createMutate.mockRejectedValue(new Error("unconfirmed-sentinel"));
    renderFromChat();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't confirm the event" }),
      ),
    );
  });

  it("sends no chat keys from the Events page", async () => {
    renderFromChat({ postToChannelId: undefined });
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).not.toHaveProperty("channel_id");
  });
});

describe("EventEditorDialog event types (#3730)", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    createMutate.mockResolvedValue(undefined);
    updateMutate.mockResolvedValue(undefined);
    chapter.active();
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
  }

  const fillTimes = () => {
    setSchedule("Starts", "2026-07-01", "18:00");
    setSchedule("Ends", "2026-07-01", "19:00");
  };

  it("opens with no type held", () => {
    renderCreate();
    const group = screen.getByRole("radiogroup", { name: "Type" });
    for (const chip of within(group).getAllByRole("radio")) {
      expect(chip).toHaveAttribute("aria-checked", "false");
    }
  });

  it("fills the name, points and attendance from the type and sends it", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("radio", { name: "Chapter meeting" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("Chapter meeting");
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("10 points · Required for everyone");

    fillTimes();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).toMatchObject({
      name: "Chapter meeting",
      event_type_id: "type-meeting",
      point_value: 10,
      is_mandatory: true,
    });
  });

  it("replaces a name the last type wrote, never one the officer typed", () => {
    renderCreate();
    fireEvent.click(screen.getByRole("radio", { name: "Chapter meeting" }));
    fireEvent.click(screen.getByRole("radio", { name: "Social" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Social");

    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Bowling night" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Chapter meeting" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Bowling night");
  });

  it("sends no type on create when none is held", async () => {
    renderCreate();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).not.toHaveProperty("event_type_id");
  });

  it("reads the type back on edit and clears it when let go", async () => {
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "e1",
          name: "Weekly chapter",
          start_time: "2026-07-01T18:00:00.000Z",
          end_time: "2026-07-01T19:00:00.000Z",
          point_value: 10,
          event_type_id: "type-meeting",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
    const held = screen.getByRole("radio", { name: "Chapter meeting" });
    expect(held).toHaveAttribute("aria-checked", "true");
    fireEvent.click(held);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]![0].body).toEqual({
      event_type_id: null,
      scope: "instance",
    });
  });
});

// #3709: any member with `events:create` makes an event, but only an
// `events:update` holder makes anyone required or attaches points.
describe("EventEditorDialog for a member who can't edit events", () => {
  beforeEach(() => {
    createMutate.mockReset();
    mockToast.mockReset();
    createMutate.mockResolvedValue(undefined);
    chapter.active();
    mockPermissions.list = ["events:create", "members:view"];
  });
  afterEach(() => {
    mockPermissions.list = ["events:update"];
  });

  function renderCreate() {
    render(
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );
  }

  it("shows no points, and creates an optional event worth none", async () => {
    renderCreate();
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("Optional for everyone · Doesn't repeat");
    openMoreOptions();
    expect(screen.queryByLabelText("Points for attending")).toBeNull();

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]![0]).toMatchObject({
      point_value: 0,
      is_mandatory: false,
    });
  });

  it("takes only the name from a type", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("radio", { name: "Chapter meeting" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("Chapter meeting");
    expect(
      screen.getByRole("button", { name: /More options/ }),
    ).toHaveTextContent("Optional for everyone");
  });

  it("offers no Required answer, so nobody is made required", () => {
    renderCreate();
    openMoreOptions();
    const everyone = screen.getByRole("radiogroup", {
      name: /everyone/i,
    });
    expect(
      within(everyone).queryByRole("radio", { name: "Required" }),
    ).toBeNull();
    expect(
      within(everyone).getByRole("radio", { name: "Optional" }),
    ).toBeInTheDocument();
  });
});

/**
 * Going back or leaving the page keeps what was typed (Paul, 2026-11-13,
 * #4593); Cancel and a save drop it.
 */
describe("EventEditorDialog keeps its draft (#4593)", () => {
  beforeEach(() => {
    createMutate.mockReset().mockResolvedValue(undefined);
    updateMutate.mockReset().mockResolvedValue(undefined);
    mockToast.mockReset();
    chapter.active();
  });

  function editor(
    props: Partial<React.ComponentProps<typeof EventEditorDialog>> = {},
  ) {
    return (
      <EventEditorDialog
        open
        mode="create"
        event={null}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
        keptDraft="event-create"
        {...props}
      />
    );
  }

  it("opens on the kept draft after going back, with More options as left", () => {
    const view = render(editor());
    expect(screen.queryByText("Draft restored")).toBeNull();
    fillRequiredFields();
    openMoreOptions();
    view.rerender(editor({ open: false }));
    view.rerender(editor({ open: true }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Exec Sync");
    expect(screen.getByLabelText("Points for attending")).toBeInTheDocument();
    expect(screen.getByText("Draft restored")).toBeInTheDocument();
  });

  it("opens on the kept draft after the page was left", () => {
    const view = render(editor());
    fillRequiredFields();
    view.unmount();
    render(editor());
    expect(screen.getByLabelText("Event name")).toHaveValue("Exec Sync");
  });

  it("keeps nothing for a form opened and left untouched", () => {
    const view = render(editor());
    view.rerender(editor({ open: false }));
    view.rerender(editor({ open: true }));
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("starts over on Discard", () => {
    const view = render(editor());
    fillRequiredFields();
    view.rerender(editor({ open: false }));
    view.rerender(editor({ open: true }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("");
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("drops the draft on Cancel", () => {
    const view = render(editor());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    view.rerender(editor({ open: false }));
    view.rerender(editor({ open: true }));
    expect(screen.getByLabelText("Event name")).toHaveValue("");
  });

  it("drops the draft once the event is created", async () => {
    const view = render(editor());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    view.rerender(editor({ open: false }));
    view.rerender(editor({ open: true }));
    expect(screen.getByLabelText("Event name")).toHaveValue("");
  });

  it("keeps an edit to its own event", () => {
    const one = {
      id: "e1",
      name: "Chapter",
      start_time: "2026-07-01T18:00:00.000Z",
      end_time: "2026-07-01T19:00:00.000Z",
    };
    const two = { ...one, id: "e2", name: "Rush" };
    const view = render(
      editor({ mode: "edit", event: one, keptDraft: "event-edit:e1" }),
    );
    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Chapter meeting" },
    });
    view.unmount();
    const other = render(
      editor({ mode: "edit", event: two, keptDraft: "event-edit:e2" }),
    );
    expect(screen.getByLabelText("Event name")).toHaveValue("Rush");
    expect(screen.queryByText("Draft restored")).toBeNull();
    other.unmount();
    render(editor({ mode: "edit", event: one, keptDraft: "event-edit:e1" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Chapter meeting");
  });

  it("keeps nothing from chat's /event, which has no draft name", () => {
    const view = render(editor({ keptDraft: undefined }));
    fillRequiredFields();
    view.unmount();
    render(editor({ keptDraft: undefined }));
    expect(screen.getByLabelText("Event name")).toHaveValue("");
  });
});
