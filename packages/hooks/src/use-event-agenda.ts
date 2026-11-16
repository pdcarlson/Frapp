"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EventAgendaItem, EventAttachment } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * One meeting's own lists (#4934), as an editor holds them. A save sends
 * either or both, each whole, always to the occurrence itself, never with
 * `scope: "series"`: each meeting keeps its own
 * (`spec/behavior/events.md` § Agenda and attachments).
 */
export interface EventLists {
  agenda: EventAgendaItem[];
  attachments: EventAttachment[];
}

export type EventListField = keyof EventLists;

/**
 * How long an editor waits after a change before saving, so a run of quick
 * check-offs or moves goes out as one write. `PATCH /v1/events/:id` allows
 * ten writes a minute per member (`@ThrottleFanOutWrite`), which a meeting's
 * check-offs one write each would reach.
 */
export const EVENT_LISTS_SAVE_DELAY_MS = 700;

/**
 * Edit an event's agenda and attachments, both apps' one write for them.
 *
 * A change shows at once (the lists returned are the edit, not the server's
 * read), the way Notion's and Fellow's agenda checkboxes do. Saves are
 * coalesced and never overlap: changes made in the delay, or while a save is
 * out, go in the next one, and every save carries the latest whole list, so
 * no save can undo another. A refused save drops every unsaved change, goes
 * back to the server's lists, and calls `onFailed`; nothing retries it,
 * since a stale list sent later would overwrite what was saved since.
 * Changes still waiting when the editor unmounts are sent then.
 */
export function useEventListsEditor(
  eventId: string,
  server: EventLists,
  options: { onFailed?: (error: unknown) => void } = {},
) {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  const [edited, setEdited] = useState<Partial<EventLists>>({});
  const [saving, setSaving] = useState(false);
  const editedRef = useRef<Partial<EventLists>>({});
  const serverRef = useRef(server);
  serverRef.current = server;
  const dirty = useRef(new Set<EventListField>());
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFailed = useRef(options.onFailed);
  onFailed.current = options.onFailed;
  const mounted = useRef(true);

  const keys = useRef({ chapterId, eventId });
  keys.current = { chapterId, eventId };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current || dirty.current.size === 0) return;
    const body: Partial<EventLists> = {};
    for (const field of dirty.current) {
      const value = editedRef.current[field];
      if (field === "agenda" && value) body.agenda = value as EventAgendaItem[];
      if (field === "attachments" && value) {
        body.attachments = value as EventAttachment[];
      }
    }
    dirty.current.clear();
    inFlight.current = true;
    if (mounted.current) setSaving(true);
    const { chapterId: chapter, eventId: id } = keys.current;
    const detailKey = ["events", chapter, id];
    try {
      const { error } = await client.PATCH("/v1/events/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      // The read now holds what was saved, so nothing flashes back while
      // the refetches below are out.
      queryClient.setQueryData(detailKey, (row: unknown) =>
        row && typeof row === "object" ? { ...row, ...body } : row,
      );
    } catch (failure) {
      dirty.current.clear();
      editedRef.current = {};
      if (mounted.current) setEdited({});
      onFailed.current?.(failure);
    } finally {
      inFlight.current = false;
    }
    if (dirty.current.size > 0) {
      void flush();
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
      queryClient.invalidateQueries({
        queryKey: ["events", chapter],
        exact: true,
      }),
    ]);
    // Only once the reads hold the save, and nothing newer is waiting, does
    // the editor hand back to them.
    if (!inFlight.current && dirty.current.size === 0) {
      editedRef.current = {};
      if (mounted.current) {
        setEdited({});
        setSaving(false);
      }
    }
  }, [client, queryClient]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (dirty.current.size > 0) void flush();
    };
  }, [flush]);

  const change = useCallback(
    <F extends EventListField>(
      field: F,
      update: (current: EventLists[F]) => EventLists[F],
    ) => {
      const current = (editedRef.current[field] ??
        serverRef.current[field]) as EventLists[F];
      const next = update(current);
      editedRef.current = { ...editedRef.current, [field]: next };
      setEdited(editedRef.current);
      dirty.current.add(field);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), EVENT_LISTS_SAVE_DELAY_MS);
    },
    [flush],
  );

  return {
    agenda: edited.agenda ?? server.agenda,
    attachments: edited.attachments ?? server.attachments,
    /** A save is out or waiting. */
    saving: saving || Object.keys(edited).length > 0,
    change,
    /** Send what's waiting now, without the delay. */
    flush,
  };
}
