import { normalizeProofLink } from "./task-proof";

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
 * One agenda item. `id` is the client's, so a row keeps its place while the
 * list is reordered or checked off; `done` is checked off during the meeting
 * by whoever can edit the event.
 */
export interface EventAgendaItem {
  id: string;
  text: string;
  done: boolean;
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
