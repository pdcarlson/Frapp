"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { EVENT_PARAM } from "@/lib/events/event-links";

/**
 * Opens the event `/events?event=<id>` names (`eventDeepLink`), once the list
 * holds it and once per id, so closing its sheet does not reopen it. An id the
 * list does not hold (deleted, or not visible to this member) opens nothing.
 * Draws nothing; it is its own component so the page around it never waits on
 * the URL (`useSearchParams` wants a Suspense boundary, which the page gives
 * this alone).
 */
export function OpenLinkedEvent<T>({
  events,
  idOf,
  onOpen,
}: {
  events: readonly T[];
  idOf: (event: T) => string;
  onOpen: (event: T) => void;
}) {
  const linkedId = useSearchParams()?.get(EVENT_PARAM) ?? null;
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (!linkedId || opened.current === linkedId) return;
    const target = events.find((event) => idOf(event) === linkedId);
    if (target === undefined) return;
    opened.current = linkedId;
    onOpen(target);
    // `onOpen` may be a new function each render; `opened` keeps it to once.
  }, [linkedId, events, idOf, onOpen]);

  return null;
}
