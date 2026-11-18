import { useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { seriesRuleOf, seriesStartsIn } from "@repo/validation";
import { useEvent, useEvents, useNowDate } from "@repo/hooks";
import {
  NewEventSheet,
  useEventEditGrants,
} from "@/components/events/new-event-sheet";
import type { EventEditTarget } from "@/lib/events/edit-event";
import { alertFailure } from "@/lib/failure-alert";
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

/** Said while Edit reads the event (and its series) before the sheet rises. */
export const EVENT_EDIT_OPENING = "Opening the event.";

/**
 * Edit event over a list (#5492): an event row's long-press Edit, without
 * going to Event details. It reads the event, waits for `useEventEditTarget`
 * and then presents the sheet once. The host mounts one per Edit (`key`) and
 * unmounts it when the sheet closes (`onClosed`), so its reads go with it.
 * Its kept draft is Event details' (`event-edit:<id>`, #4872), so either way
 * in opens on what was typed.
 *
 * While the reads run, a screen reader hears that the event is opening (the
 * list is cached, so this is usually a moment). A read that fails says so in
 * the platform alert (`alertFailure`), with Try again where trying again can
 * help (`onRetry` mounts a fresh host), and the host goes.
 */
export function EventEditHost({
  eventId,
  onClosed,
  onRetry,
}: {
  eventId: string;
  onClosed: () => void;
  onRetry: () => void;
}) {
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
  const failed = !show && eventQuery.isError && eventQuery.data === undefined;
  useEffect(() => {
    if (!show || presented.current) return;
    presented.current = true;
    ref.current?.present();
  }, [show]);
  // Said once, if the sheet can't rise on the first render.
  const announced = useRef(false);
  useEffect(() => {
    if (show || failed || announced.current) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility(EVENT_EDIT_OPENING);
  }, [show, failed]);
  const error = eventQuery.error;
  useEffect(() => {
    if (!failed) return;
    onClosed();
    alertFailure({
      title: "Couldn't open the event",
      error,
      fallback: "Check your connection and try again.",
      retry: onRetry,
    });
  }, [failed, error, onClosed, onRetry]);
  if (!show) return null;
  return (
    <NewEventSheet
      key={sheetKey}
      ref={ref}
      now={now}
      editing={target}
      keptDraft={`event-edit:${eventId}`}
      onClosed={onClosed}
    />
  );
}
