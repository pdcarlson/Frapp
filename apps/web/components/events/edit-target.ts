import { seriesRuleOf, type EventEditTarget } from "@repo/validation";

type EventRecord = Record<string, unknown>;

export const textOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * What the shared edit logic (`event-edit.ts` in `@repo/validation`) needs to
 * know about the event and its series, or `null` while it can't be built.
 */
export function editTargetOf(
  event: EventRecord | null,
  parent: EventRecord | null,
): EventEditTarget | null {
  const id = textOf(event?.id);
  const start = textOf(event?.start_time);
  const end = textOf(event?.end_time);
  if (!event || !id || !start || !end) return null;
  const fields = {
    id,
    start_time: start,
    end_time: end,
    parent_event_id: textOf(event.parent_event_id) || null,
    recurrence_rule: textOf(event.recurrence_rule),
  };
  const parentId = textOf(parent?.id);
  const parentStart = textOf(parent?.start_time);
  const parentEnd = textOf(parent?.end_time);
  const parentFits =
    fields.parent_event_id !== null &&
    parentId === fields.parent_event_id &&
    parentStart !== null &&
    parentEnd !== null;
  return {
    event: fields,
    seriesRule: seriesRuleOf(fields, parentFits ? parent : null),
    parent: parentFits
      ? { id: parentId, start_time: parentStart, end_time: parentEnd }
      : null,
  };
}
