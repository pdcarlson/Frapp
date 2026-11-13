"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { EVENT_PARAM, EXCUSE_PARAM } from "@/lib/events/event-links";

/**
 * Opens the event `/events?event=<id>` names (`eventDeepLink`), once the list
 * holds it and once per id, so closing its sheet does not reopen it. An id the
 * list does not hold (deleted, or not visible to this member) opens nothing.
 * Draws nothing; it is its own component so the page around it never waits on
 * the URL (`useSearchParams` wants a Suspense boundary, which the page gives
 * this alone). `excuse` says the link also asked for the sheet's Can't make it
 * line (`&excuse=1`, the chat card's button, #4660). That ask is acted on
 * every time it arrives, even for an id already opened (the page stays
 * mounted beside the docked chat), and then dropped from the URL, so the
 * card's next tap is a fresh ask rather than a URL that hasn't changed.
 */
export function OpenLinkedEvent<T>({
  events,
  idOf,
  onOpen,
}: {
  events: readonly T[];
  idOf: (event: T) => string;
  onOpen: (event: T, linked: { excuse: boolean }) => void;
}) {
  const search = useSearchParams();
  const linkedId = search?.get(EVENT_PARAM) ?? null;
  const excuse = search?.get(EXCUSE_PARAM) === "1";
  const opened = useRef<string | null>(null);
  // Set once an `excuse=1` ask is handled, until the URL drops it, so a list
  // refresh in between doesn't hand it on twice.
  const excuseHandled = useRef(false);

  useEffect(() => {
    if (!excuse) excuseHandled.current = false;
    if (!linkedId) return;
    const fresh = excuse ? !excuseHandled.current : opened.current !== linkedId;
    if (!fresh) return;
    const target = events.find((event) => idOf(event) === linkedId);
    if (target === undefined) return;
    opened.current = linkedId;
    if (excuse) excuseHandled.current = true;
    onOpen(target, { excuse });
    if (excuse) {
      // Next folds `replaceState` into its router, so `useSearchParams` sees
      // the URL without the ask, with no navigation.
      const url = new URL(window.location.href);
      url.searchParams.delete(EXCUSE_PARAM);
      window.history.replaceState(window.history.state, "", url);
    }
    // `onOpen` may be a new function each render; the refs keep it to once.
  }, [linkedId, excuse, events, idOf, onOpen]);

  return null;
}
