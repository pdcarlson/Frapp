/**
 * The rules a chat hours card applies, shared by web's
 * (`apps/web/components/chat/renderers/hours-card.tsx`) and mobile's
 * (`apps/mobile/components/chat/hours-card.tsx`), as `./task-card` is for the
 * task card. Pure, so both renderers' specs can drive them.
 *
 * The card's message is a creation-time snapshot whose status is `PENDING`
 * forever, so the badge is the entry's live review status or nothing: a card
 * that said "Pending review" on hours an officer approved last week is the
 * stale-snapshot bug #2065 fixed on the task card.
 */

/** A service entry's review status, as `service_entries.status` stores it. */
export type ServiceEntryStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * What an hours card's badge says. "Pending review" rather than the s19
 * list's bare "Pending": in a channel the card speaks to the whole chapter,
 * and the longer phrase says who it is waiting on.
 */
export const SERVICE_ENTRY_CARD_LABELS: Record<ServiceEntryStatus, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** The entry as `GET /v1/service-entries/{id}` returns it, as much as a card reads. */
export interface LiveServiceEntry {
  id: string;
  status: ServiceEntryStatus;
}

function isServiceEntryStatus(value: unknown): value is ServiceEntryStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SERVICE_ENTRY_CARD_LABELS, value)
  );
}

/**
 * `useServiceEntry`'s data as a `LiveServiceEntry`, or `null` when there is
 * none yet (loading, a 403 or 404, an entry since deleted, or a shape without
 * an id or a known status).
 */
export function readLiveServiceEntry(data: unknown): LiveServiceEntry | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== "string" || !isServiceEntryStatus(r.status)) return null;
  return { id: r.id, status: r.status };
}

/**
 * Whether the viewer may read the card's entry. `GET /v1/service-entries/{id}`
 * needs `members:view`, and then answers only the member who logged it and a
 * `service:approve` holder, so a card shouldn't ask for anyone else: for them
 * it is a guaranteed 403, and the card shows no badge. (The route also needs
 * the Hours module; a card doesn't wait on that read, and a 403 from it reads
 * as no badge, see `useServiceEntry`.)
 */
export function canReadCardServiceEntry(input: {
  isOwner: boolean;
  canApprove: boolean;
  canViewMembers: boolean;
}): boolean {
  return input.canViewMembers && (input.isOwner || input.canApprove);
}
