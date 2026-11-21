import type { EventFormPrefill } from "@repo/chat-core/integrations";
import { localIsoDate } from "@repo/formatting";

/**
 * Everything the card's Event form holds. Location and points come only from
 * a typed `/event`; the card has no field for them, but carries them to the
 * post and to More options so nothing typed is dropped.
 */
export interface EventQuickDraft {
  name: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  startTime: string;
  endTime: string;
  location?: string;
  pointValue?: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A blank draft: today, from the next whole hour for an hour, as Google
 * Calendar's quick create starts. Late in the evening that runs past
 * midnight, so it starts tomorrow at 9 instead.
 */
export function eventQuickDraftFrom(
  prefill: EventFormPrefill = {},
  now: Date = new Date(),
): EventQuickDraft {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  if (start.getHours() >= 23 || start.getDate() !== now.getDate()) {
    start.setTime(now.getTime());
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  }
  const startTime = `${pad(start.getHours())}:00`;
  const endTime = `${pad(start.getHours() + 1)}:00`;
  return {
    name: prefill.name ?? "",
    date: prefill.date ?? localIsoDate(start),
    startTime: normalizeTime(prefill.startTime) ?? startTime,
    endTime: normalizeTime(prefill.endTime) ?? endTime,
    ...(prefill.location ? { location: prefill.location } : {}),
    ...(prefill.pointValue !== undefined
      ? { pointValue: prefill.pointValue }
      : {}),
  };
}

/** `9:00` → `09:00`, the time input's value. */
function normalizeTime(time: string | undefined): string | undefined {
  if (!time) return undefined;
  const [hours = "", minutes = ""] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}
