import { vi } from "vitest";

/**
 * The `@repo/hooks` stub the web Events page specs render against, in one place.
 *
 * `events-gating`, `events-page-offline`, `events-page-bulk-actions` and
 * `events-page-list` each hand-rolled the same ~50-line hook map for
 * `EventsPage` (its toolbar's Subscribe menu, the calendar's tasks and
 * birthdays, the editor's event types), and `event-editor-dialog` the same
 * event-type list. A hook the page starts calling had to be added to every
 * copy, and the copies had already started to differ by accident.
 *
 * What the specs vary on purpose (permissions, events, the chapter, the
 * attendance roster) goes in `overrides`, which win over the defaults. The
 * call has to happen inside the hoisted `vi.mock` factory, so the module is
 * loaded with a dynamic import there, the same way `tests/network.ts` is:
 *
 * ```ts
 * vi.mock("@repo/hooks", async () => {
 *   const { eventsPageHooks } = await import("@/tests/events-page");
 *   return eventsPageHooks({ useEvents: () => eventsQuery });
 * });
 * ```
 *
 * Mutable state an override reads (a `permissionsRef.current`, an
 * `eventsQuery`) still lives in the spec, read lazily inside the override.
 */

/** Two chapter event types: a required, pointed meeting and an optional social. */
export const EVENT_TYPES = [
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
];

const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });

/** The editor's event-type picker: the list and its three idle mutations. */
export function eventTypeHooks(types: unknown[] = EVENT_TYPES) {
  return {
    useEventTypes: () => ({ data: types, isLoading: false }),
    useCreateEventType: idleMutation,
    useUpdateEventType: idleMutation,
    useDeleteEventType: idleMutation,
  };
}

/**
 * Every hook `EventsPage` and what it renders call, with `overrides` on top.
 * The real shared Google Calendar module comes first, so the Subscribe menu
 * reads its copy (#4676); the stubs below override its hooks.
 */
export async function eventsPageHooks(overrides: Record<string, unknown> = {}) {
  return {
    ...(await import("@repo/hooks/use-google-calendar")),
    // A viewer with no roles: the event's default decides (#4132). The rule
    // itself is the hook's own spec.
    useRequiredOfViewer: () => (fields: { is_mandatory?: boolean | null }) =>
      fields.is_mandatory === true,
    // The toolbar's Subscribe menu (#3322) asks for nothing until it opens.
    useCalendarFeedLink: () => ({ data: undefined, isError: false }),
    useResetCalendarFeedLink: idleMutation,
    calendarAppLinks: () => null,
    useGoogleCalendarStatus: () => ({ data: undefined }),
    useStartGoogleCalendarConnect: idleMutation,
    useConfirmGoogleCalendarConnect: () => ({ mutateAsync: vi.fn() }),
    useDisconnectGoogleCalendar: idleMutation,
    readGoogleCalendarReturn: () => null,
    GOOGLE_CALENDAR_RETURN_PARAMS: [],
    useActiveChapterId: () => "chap-1",
    useCalendarTasks: () => ({ items: [], hasMine: false, hasAssigned: false }),
    useCalendarBirthdays: () => [],
    useChapterRoster: () => ({ data: [] }),
    useCurrentChapter: () => ({
      data: { subscription_status: "active", past_due_since: null },
      isPending: false,
      isError: false,
    }),
    useCreateEvent: idleMutation,
    useEvent: () => ({ data: undefined, isPending: false, isError: false }),
    useUpdateEvent: idleMutation,
    ...eventTypeHooks(),
    useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
    useAttendance: () => ({ data: [], isPending: false, isError: false }),
    useMembers: () => ({ data: [], isPending: false, isError: false }),
    useUpdateAttendanceStatus: idleMutation,
    useAutoAbsent: idleMutation,
    useMyPermissions: () => ({
      data: { permissions: ["events:update", "events:create", "members:view"] },
    }),
    useEvents: () => ({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useNow: () => Date.now(),
    ...overrides,
  };
}
