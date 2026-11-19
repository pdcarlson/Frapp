import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { NewEventSheet } from "@/components/events/new-event-sheet";
import { emptyEventDraft, type NewEventDraft } from "@/lib/events/create-event";

/**
 * New event, filled in to start at a time the screen picks: the Calendar's
 * floating + (the picked day, #5113, #5570) and the Day grid's tap on an hour
 * (#4818). `open(start)` presents a fresh sheet (a `null` start is the
 * sheet's own default); `openWith(template)` presents one filled in from a
 * whole draft (an event's long-press Duplicate, #5492). Render `sheet` once
 * in the screen. One sheet per press (`key`), since a template seeds the
 * draft once.
 *
 * The new event landing on the month or the grid is the visible
 * confirmation; a screen reader hears it said.
 */
export function useNewEventAt(now: Date): {
  open: (start: NewEventDraft["start"]) => void;
  openWith: (template: NewEventDraft) => void;
  sheet: ReactNode;
} {
  const ref = useRef<BottomSheetModal>(null);
  const [createAt, setCreateAt] = useState<{
    key: number;
    template: NewEventDraft;
  } | null>(null);
  useEffect(() => {
    if (createAt) ref.current?.present();
  }, [createAt]);

  const openWith = (template: NewEventDraft) =>
    setCreateAt((previous) => ({
      key: (previous?.key ?? 0) + 1,
      template,
    }));
  const open = (start: NewEventDraft["start"]) =>
    openWith({ ...emptyEventDraft(), start });

  const sheet = createAt ? (
    <NewEventSheet
      key={createAt.key}
      ref={ref}
      now={now}
      template={createAt.template}
      onCreated={() =>
        AccessibilityInfo.announceForAccessibility("Event added.")
      }
    />
  ) : null;

  return { open, openWith, sheet };
}
