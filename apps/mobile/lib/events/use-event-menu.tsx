import { useCallback, useMemo, useState, type ReactNode } from "react";
import { dropKeptDraft, useKeptDraftKeys } from "@repo/hooks/kept-drafts";
import { useDeleteEvent, useEvents, useNowDate } from "@repo/hooks";
import {
  CopyGlyph,
  PencilGlyph,
  TrashGlyph,
} from "@/components/control-glyphs";
import {
  useItemMenu,
  type ItemMenuAction,
  type ItemMenuHandle,
} from "@/components/item-actions-menu";
import {
  askEventDelete,
  useCanCreateEvents,
  useEventEditGrants,
} from "@/components/events/new-event-sheet";
import { alertFailure } from "@/lib/failure-alert";
import { successHaptic } from "@/lib/haptics";
import { records } from "@/lib/more/narrow";
import { duplicateEventTemplate } from "@/lib/events/edit-event";
import { EventEditHost } from "@/lib/events/use-event-edit";
import { useNewEventAt } from "@/lib/events/use-new-event-at";
import {
  selectAllEventRows,
  selectEventDetail,
  type EventDetail,
  type EventRow,
} from "@/lib/events/select";

/** An event's long-press menu rows (#5492), in the order they are drawn. */
export type EventMenuKey = "edit" | "duplicate" | "delete";

/**
 * Which rows an event's menu draws, by the grants `event.controller.ts`
 * checks: Edit is `PATCH /v1/events/:id` (`events:update`), Duplicate is
 * `POST /v1/events` (`events:create`), Delete is `DELETE /v1/events/:id`
 * (`events:delete`), each with the controller's `members:view`. There is no
 * creator rule.
 */
export function eventMenuKeys(grants: {
  edit: boolean;
  create: boolean;
  delete: boolean;
}): EventMenuKey[] {
  const keys: EventMenuKey[] = [];
  if (grants.edit) keys.push("edit");
  if (grants.create) keys.push("duplicate");
  if (grants.delete) keys.push("delete");
  return keys;
}

/**
 * An event row's long-press menu (#5492; Paul, 2026-11-18): Edit, Duplicate
 * and Delete, each to a viewer the API lets use it (`eventMenuKeys`, read
 * with the gates Event details and the + read: `useEventEditGrants`,
 * `useCanCreateEvents`). What each does is the existing flow's:
 *
 * - Edit opens Edit event over the list (`EventEditHost`), the sheet Event
 *   details' pencil opens, series and all.
 * - Duplicate opens New event filled in from the event, as a new one-time
 *   event (`duplicateEventTemplate`).
 * - Delete asks the Edit sheet's question (`askEventDelete`): a repeating
 *   event asks this one or all upcoming.
 *
 * A row the viewer can do nothing with gets no menu, and no long press.
 * Render `host` once in the screen.
 */
export function useEventMenu(): {
  menuFor: (event: EventRow) => ItemMenuHandle | null;
  /** An event by id, read off the events list; `null` when it doesn't hold it. */
  menuForId: (id: string) => ItemMenuHandle | null;
  host: ReactNode;
} {
  const grants = useEventEditGrants();
  const canCreate = useCanCreateEvents();
  const eventsQuery = useEvents();
  const eventsData = eventsQuery.data;
  const deleteEvent = useDeleteEvent();
  const now = useNowDate();
  const newEvent = useNewEventAt(now);
  const { openWith } = newEvent;
  const menu = useItemMenu();
  const { handleFor } = menu;
  const [editing, setEditing] = useState<{ id: string; key: number } | null>(
    null,
  );

  // The list's records by id, indexed once per read, for Duplicate.
  const rawById = useMemo(
    () => new Map(records(eventsData).map((raw) => [raw.id, raw])),
    [eventsData],
  );
  /** The event as the list read it, every field the form holds. */
  const detailOf = useCallback(
    (event: EventRow): EventDetail | null =>
      selectEventDetail(rawById.get(event.id) ?? null),
    [rawById],
  );
  const keptDraftKeys = useKeptDraftKeys();
  const editAgain = useCallback(
    (id: string) =>
      setEditing((previous) => ({ id, key: (previous?.key ?? 0) + 1 })),
    [],
  );
  const stopEditing = useCallback(() => setEditing(null), []);

  const runDelete = useCallback(
    async (event: EventRow) => {
      const scope = await askEventDelete(event);
      if (!scope) return;
      deleteEvent.mutate(
        { id: event.id, scope },
        {
          onSuccess: () => {
            successHaptic();
            // The event is gone, and its kept edit with it, as the Edit
            // sheet's Delete drops it.
            dropKeptDraft(keptDraftKeys.draft(`event-edit:${event.id}`));
          },
          onError: (error) =>
            alertFailure({
              title: "Couldn't delete the event",
              error,
              fallback: "Try again.",
            }),
        },
      );
    },
    [deleteEvent, keptDraftKeys],
  );

  const actionFor = useCallback(
    (key: EventMenuKey, event: EventRow): ItemMenuAction => {
      switch (key) {
        case "edit":
          return {
            key,
            label: "Edit",
            glyph: (color) => <PencilGlyph color={color} />,
            run: () => editAgain(event.id),
          };
        case "duplicate":
          return {
            key,
            label: "Duplicate",
            glyph: (color) => <CopyGlyph color={color} />,
            // Read when picked, not for every row on every render.
            run: () => {
              const detail = detailOf(event);
              if (detail) openWith(duplicateEventTemplate(detail, new Date()));
            },
          };
        case "delete":
          return {
            key,
            label: "Delete",
            destructive: true,
            glyph: (color) => <TrashGlyph color={color} />,
            run: () => void runDelete(event),
          };
      }
    },
    [detailOf, openWith, runDelete, editAgain],
  );

  const menuFor = useCallback(
    (event: EventRow) =>
      handleFor({
        title: event.name,
        actions: eventMenuKeys({
          edit: grants.edit,
          create: canCreate,
          delete: grants.delete,
        }).map((key) => actionFor(key, event)),
      }),
    [handleFor, grants.edit, grants.delete, canCreate, actionFor],
  );

  // The list's events as rows by id, for a screen that holds only an id
  // (Activity's rows, which carry their own read of the event).
  const rowById = useMemo(
    () => new Map(selectAllEventRows(eventsData).map((row) => [row.id, row])),
    [eventsData],
  );
  const menuForId = useCallback(
    (id: string) => {
      const row = rowById.get(id);
      return row ? menuFor(row) : null;
    },
    [rowById, menuFor],
  );

  return {
    menuFor,
    menuForId,
    host: (
      <>
        {menu.element}
        {editing ? (
          <EventEditHost
            key={editing.key}
            eventId={editing.id}
            onClosed={stopEditing}
            onRetry={() => editAgain(editing.id)}
          />
        ) : null}
        {newEvent.sheet}
      </>
    ),
  };
}
