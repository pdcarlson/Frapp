import {
  normalizeProofLink,
  proofLinkDomain,
  TASK_PROOF_LINK_MAX,
} from "./task-proof";

/**
 * An event's agenda and attachments (#4934, `spec/behavior/events.md`
 * § Agenda and attachments). Both belong to one meeting, never to a series,
 * and are written whole by whoever can edit the event. The API's DTOs and
 * `normalizeAgenda` / `normalizeAttachments` enforce every limit here; the
 * `events` table checks only that each column is a list within its count
 * (`EVENT_AGENDA_MAX`, `EVENT_ATTACHMENTS_MAX`), so a writer that skips the
 * API gets no length check. The forms read them so a member never types past
 * one.
 */

/** Items on one meeting's agenda (the table's check holds the same number). */
export const EVENT_AGENDA_MAX = 30;
/** One agenda item: a short line, not a paragraph. */
export const EVENT_AGENDA_ITEM_MAX = 200;
/** Attachments on one meeting (the table's check holds the same number). */
export const EVENT_ATTACHMENTS_MAX = 10;
/** An attachment's title, as a member reads it in the list. */
export const EVENT_ATTACHMENT_TITLE_MAX = 120;

/**
 * Where an agenda item tabled at an earlier meeting came from (#5534): the
 * minutes that first tabled it, that meeting's start, and how many meetings
 * have tabled it so far. Only the API sets it, when an officer adds a
 * suggested tabled item; a save keeps it by the item's `id` and never takes
 * it from the client, so it always names this chapter's minutes.
 */
export interface EventAgendaTabledFrom {
  meeting_id: string;
  start_time: string;
  times: number;
}

/**
 * One agenda item. `id` is the client's, so a row keeps its place while the
 * list is reordered or checked off; `done` is checked off during the meeting
 * by whoever can edit the event. `tabled_from` is set on an item added from
 * an earlier meeting's Tabled list; absent or null otherwise.
 */
export interface EventAgendaItem {
  id: string;
  text: string;
  done: boolean;
  tabled_from?: EventAgendaTabledFrom | null;
}

/** A titled web link. */
export interface EventLinkAttachment {
  id: string;
  kind: "link";
  url: string;
  title: string;
}

/**
 * One of the chapter's Chapter Files documents. `title` is the document's
 * name when it was attached; opening it reads the document itself
 * (`GET /v1/documents/:id`), so a file deleted since says so then.
 */
export interface EventDocumentAttachment {
  id: string;
  kind: "document";
  document_id: string;
  title: string;
}

export type EventAttachment = EventLinkAttachment | EventDocumentAttachment;

export const EVENT_ATTACHMENT_KINDS = ["link", "document"] as const;

/**
 * A link attachment's URL as Frapp keeps it: trimmed, http or https only,
 * or `null` when it isn't one. The same rule as a task's proof link.
 */
export function normalizeAttachmentUrl(value: string): string | null {
  return normalizeProofLink(value);
}

/** An agenda item's text as stored: trimmed, inner whitespace collapsed. */
export function normalizeAgendaText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The words an agenda item or a tabled matter is told apart by (#5534):
 * case, spacing and end punctuation don't make a different matter, so
 * "Formal budget." on the minutes is the agenda's "Formal budget". The one
 * rule the API's suggestions, the minutes draft, a minutes save and both
 * apps compare with.
 */
export function agendaMatterKey(text: string): string {
  return normalizeAgendaText(text)
    .toLowerCase()
    .replace(/[.!?;:,\s]+$/, "");
}

/**
 * Why an agenda can't be saved, or `null` when it can. The same rule the API
 * applies, so a form can say it before the request.
 */
export function agendaProblem(
  items: readonly Pick<EventAgendaItem, "text">[],
): string | null {
  if (items.length > EVENT_AGENDA_MAX) {
    return `An agenda holds at most ${EVENT_AGENDA_MAX} items.`;
  }
  for (const item of items) {
    const text = normalizeAgendaText(item.text);
    if (!text) return "An agenda item needs some text.";
    if (text.length > EVENT_AGENDA_ITEM_MAX) {
      return `Keep each agenda item under ${EVENT_AGENDA_ITEM_MAX} characters.`;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * An event read's agenda, as both apps draw it: the read has no response
 * schema, so a missing or malformed list reads as empty, and an entry that
 * isn't an item is skipped rather than drawn broken.
 */
export function readEventAgenda(value: unknown): EventAgendaItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): EventAgendaItem[] => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.text !== "string"
    ) {
      return [];
    }
    const item: EventAgendaItem = {
      id: entry.id,
      text: entry.text,
      done: entry.done === true,
    };
    const from = readAgendaTabledFrom(entry.tabled_from);
    return [from ? { ...item, tabled_from: from } : item];
  });
}

/**
 * An agenda item's `tabled_from` as both apps and the API read it, or null
 * when it has none or it isn't one.
 */
export function readAgendaTabledFrom(
  value: unknown,
): EventAgendaTabledFrom | null {
  if (
    !isRecord(value) ||
    typeof value.meeting_id !== "string" ||
    typeof value.start_time !== "string" ||
    typeof value.times !== "number" ||
    !Number.isInteger(value.times) ||
    value.times < 1 ||
    Number.isNaN(Date.parse(value.start_time))
  ) {
    return null;
  }
  return {
    meeting_id: value.meeting_id,
    start_time: value.start_time,
    times: value.times,
  };
}

/** An event read's attachments, read as defensively as its agenda. */
export function readEventAttachments(value: unknown): EventAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): EventAttachment[] => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.title !== "string"
    ) {
      return [];
    }
    if (entry.kind === "link" && typeof entry.url === "string") {
      // Re-checked here, not only on save: a row written some other way must
      // never put a `javascript:` or `data:` address under a tap.
      const url = normalizeAttachmentUrl(entry.url);
      return url
        ? [{ id: entry.id, kind: "link", url, title: entry.title }]
        : [];
    }
    if (entry.kind === "document" && typeof entry.document_id === "string") {
      return [
        {
          id: entry.id,
          kind: "document",
          document_id: entry.document_id,
          title: entry.title,
        },
      ];
    }
    return [];
  });
}

/** The agenda with one item checked or unchecked. */
export function toggleAgendaItem(
  items: readonly EventAgendaItem[],
  id: string,
): EventAgendaItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, done: !item.done } : item,
  );
}

/**
 * Whether an agenda can be checked off yet (Paul 2026-11-19: "shouldn't be
 * able to check off items unless the event has started?"): from the meeting's
 * start on, and after it ends too, so a secretary can catch up. A start that
 * can't be read doesn't lock it. Both apps hold the checkboxes to it; the
 * list can still be written, reordered and cut down before.
 */
export function agendaCheckOffOpen(start: unknown, now: Date): boolean {
  const at = typeof start === "string" ? Date.parse(start) : Number.NaN;
  return Number.isNaN(at) || at <= now.getTime();
}

/**
 * Whether `next` adds, removes, moves or rewords an item of `stored`, rather
 * than only checking items off. Once a meeting has started its agenda is
 * locked to check-offs (Paul 2026-11-20, "lock agenda edits once the meeting
 * has started"): the API refuses any other change, and both apps stop
 * offering one.
 */
export function agendaItemsChanged(
  next: readonly Pick<EventAgendaItem, "id" | "text">[],
  stored: readonly Pick<EventAgendaItem, "id" | "text">[],
): boolean {
  return (
    next.length !== stored.length ||
    next.some(
      (item, index) =>
        item.id !== stored[index]?.id || item.text !== stored[index]?.text,
    )
  );
}

/** Why an agenda's checkboxes wait, said where they are. */
export const AGENDA_CHECK_OFF_LOCKED_COPY =
  "Items can be checked off once the meeting starts.";

/**
 * The list with the entry at `from` moved to `to`, as a drag drops it. An
 * index off either end returns the list unchanged.
 */
export function reorderEventEntry<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  if (
    from < 0 ||
    from >= items.length ||
    to < 0 ||
    to >= items.length ||
    from === to
  ) {
    return [...items];
  }
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * The agenda with the line still in its add field put on the end, when it
 * would be taken: a form's Create sends what was typed even if Return was
 * never pressed (both apps' New event Agenda row). A line the list would
 * refuse (too long, or a full list) is left out, as the field leaves it.
 */
export function agendaWithPending(
  agenda: readonly EventAgendaItem[],
  pending: string,
  newId: () => string,
): EventAgendaItem[] {
  const text = normalizeAgendaText(pending);
  if (!text || agendaProblem([...agenda, { text }])) return [...agenda];
  return [...agenda, { id: newId(), text, done: false }];
}

/**
 * An attachment's title as the API takes it: whitespace collapsed and cut to
 * `EVENT_ATTACHMENT_TITLE_MAX`. A Chapter Files name can run to 255
 * characters, so a document's title is cut as well as a link's.
 */
export function attachmentTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, EVENT_ATTACHMENT_TITLE_MAX);
}

/**
 * A link attachment's title when its adder left it empty: the link's domain
 * ("docs.google.com"), the way a pasted link reads in chat.
 */
export function attachmentLinkTitle(title: string, url: string): string {
  return attachmentTitle(title) || attachmentTitle(proofLinkDomain(url));
}

/**
 * Why a pasted link can't be attached, or `null` when it can: the form's
 * words for `normalizeAttachmentUrl`'s two refusals.
 */
export function attachmentLinkProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Paste a web address.";
  if (trimmed.length > TASK_PROOF_LINK_MAX) {
    return `That link is too long to attach (over ${TASK_PROOF_LINK_MAX} characters).`;
  }
  return normalizeAttachmentUrl(trimmed)
    ? null
    : "Paste a web address starting with http:// or https://.";
}
