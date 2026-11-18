import { useEffect, useMemo, useRef } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { seriesRuleOf, seriesStartsIn } from "@repo/validation";
import { useEvent, useEvents, useNowDate } from "@repo/hooks";
import {
  NewEventSheet,
  useEventEditGrants,
} from "@/components/events/new-event-sheet";
import type { EventEditTarget } from "@/lib/events/edit-event";
import {
  selectEventDetail,
  withoutMeetingLists,
  type EventDetail,
} from "@/lib/events/select";

/**
 * What Edit event opens on (#4746), for Event details' pencil and an event
 * row's long-press Edit (#5492) alike: the event, its series' rule and head
 * (a generated occurrence reads its parent), and the series' real next
 * meetings, read only for a viewer who may edit.
 *
 * `ready` waits for the parent and the list, so a Repeat change never steps
 * from a guess while they load; a list read that fails leaves the guess from
 * the rule. `sheetKey` changes when the server's event does, so a save (or
 * anyone else's) remounts the sheet on what it now holds; it leaves out the
 * agenda and attachments, which save in place on Event details (#4934), so a
 * check-off there never closes an open Edit sheet.
 */
export function useEventEditTarget(
  event: EventDetail | null,
  /** The event's raw read, for `sheetKey`. */
  eventData: unknown,
): { target: EventEditTarget | null; ready: boolean; sheetKey: string } {
  const grants = useEventEditGrants();
  const parentQuery = useEvent(
    grants.edit && event?.parent_event_id ? event.parent_event_id : "",
  );
  const parent = useMemo(
    () => selectEventDetail(parentQuery.data),
    [parentQuery.data],
  );
  const seriesListQuery = useEvents({
    enabled:
      grants.edit && !!(event?.parent_event_id || event?.recurrence_rule),
  });
  const ready =
    (!event?.parent_event_id || !parentQuery.isPending) &&
    !seriesListQuery.isLoading;
  const target = useMemo<EventEditTarget | null>(() => {
    if (!event) return null;
    const base = {
      event,
      seriesRule: seriesRuleOf(event, parent),
      parent: event.parent_event_id ? parent : null,
    };
    return {
      ...base,
      seriesStarts: seriesStartsIn(base, seriesListQuery.data),
    };
  }, [event, parent, seriesListQuery.data]);
  const sheetKey = target
    ? JSON.stringify([withoutMeetingLists(eventData), parentQuery.data ?? null])
    : "";
  return { target, ready, sheetKey };
}

/**
 * Edit event over a list (#5492): an event row's long-press Edit, without
 * going to Event details. It reads the event, waits for `useEventEditTarget`
 * and then presents the sheet once. The host mounts one per Edit (`key`).
 * Its kept draft is Event details' (`event-edit:<id>`, #4872), so either way
 * in opens on what was typed.
 */
export function EventEditHost({ eventId }: { eventId: string }) {
  const now = useNowDate();
  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );
  const { target, ready, sheetKey } = useEventEditTarget(
    event,
    eventQuery.data,
  );
  const ref = useRef<BottomSheetModal>(null);
  const presented = useRef(false);
  const show = target !== null && ready;
  useEffect(() => {
    if (!show || presented.current) return;
    presented.current = true;
    ref.current?.present();
  }, [show]);
  if (!show) return null;
  return (
    <NewEventSheet
      key={sheetKey}
      ref={ref}
      now={now}
      editing={target}
      keptDraft={`event-edit:${eventId}`}
    />
  );
}
