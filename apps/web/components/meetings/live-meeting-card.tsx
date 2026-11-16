"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import {
  useEvents,
  useMeetings,
  useMyPermissions,
  useStartMeeting,
  useViewerUserId,
} from "@repo/hooks";
import { formatDueTimeLabel, localClock } from "@repo/formatting";
import { MEETING_ENTRY_COPY, can, checkInWindowBounds } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { useMeetingsModuleOn } from "@/components/meetings/event-minutes";
import {
  guessMeetingType,
  meetingHref,
} from "@/components/meetings/meeting-copy";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type LiveEvent = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  check_in_opens_minutes?: number | null;
  created_by?: string | null;
};

const DISMISSED_KEY = "frapp.live-minutes-dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    // The last few are enough: a dismissed event ends within hours.
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-20)));
  } catch {
    // Private mode or blocked storage: the card just comes back next load.
  }
}

/**
 * The event the viewer runs that is on now and has no minutes they can see
 * (#5219): they created it, its check-in window is open, and it isn't one
 * they waved off. The newest start wins when two overlap.
 */
export function liveMeetingFor(
  events: LiveEvent[],
  viewerId: string,
  withMinutes: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  now: number,
): LiveEvent | null {
  let best: LiveEvent | null = null;
  for (const event of events) {
    if (event?.created_by !== viewerId) continue;
    if (withMinutes.has(event.id) || dismissed.has(event.id)) continue;
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const { opensAt, closesAt } = checkInWindowBounds(
      start,
      end,
      event.check_in_opens_minutes,
    );
    if (now < opensAt.getTime() || now > closesAt.getTime()) continue;
    if (!best || Date.parse(best.start_time) < start.getTime()) best = event;
  }
  return best;
}

/**
 * A nudge in the empty foot of the left nav (#5219, Paul: "if I am the one
 * running an event, I should see an in app notification card ... that
 * suggests I start recording minutes for an active event"). Shown only to the
 * event's creator, who may start minutes (Paul's pick, 2026-11-16), while the
 * event's check-in window is open and it has no minutes. Start minutes starts
 * them in one tap, as the event sheet's Write minutes does; Not now hides it
 * for that event in this browser. The way Granola and Otter offer "your
 * meeting started, take notes?" when a calendar event begins.
 */
export function LiveMeetingCard() {
  const on = useMeetingsModuleOn();
  const permissions = useMyPermissions().data?.permissions ?? [];
  const canRecord = on && can("meetings:record", permissions);
  const viewerId = useViewerUserId({ enabled: canRecord });
  const eventsQuery = useEvents({ enabled: canRecord });
  const meetingsQuery = useMeetings({ enabled: canRecord });
  const start = useStartMeeting();
  const router = useRouter();
  const { toast } = useToast();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canRecord) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [canRecord]);
  // Read once on the client; the card waits on queries, so it never renders
  // on the server to disagree with this.
  const [dismissed, setDismissed] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readDismissed(),
  );

  const live = useMemo(() => {
    if (!canRecord || !viewerId || meetingsQuery.isPending) return null;
    const withMinutes = new Set(
      (meetingsQuery.data ?? []).flatMap((m) =>
        m.event_id ? [m.event_id] : [],
      ),
    );
    return liveMeetingFor(
      asArray<LiveEvent>(eventsQuery.data),
      viewerId,
      withMinutes,
      new Set(dismissed),
      now,
    );
  }, [
    canRecord,
    viewerId,
    eventsQuery.data,
    meetingsQuery.data,
    meetingsQuery.isPending,
    dismissed,
    now,
  ]);

  if (!live) return null;

  const startsAt = new Date(live.start_time);
  const when =
    startsAt.getTime() > now
      ? `Starts at ${formatDueTimeLabel(localClock(startsAt))}.`
      : `Started at ${formatDueTimeLabel(localClock(startsAt))}.`;

  function dismiss() {
    if (!live) return;
    const next = [...dismissed, live.id];
    setDismissed(next);
    writeDismissed(next);
  }

  async function begin() {
    if (!live) return;
    try {
      const meeting = await start.mutateAsync({
        event_id: live.id,
        meeting_type: guessMeetingType(live.name),
      });
      router.push(meetingHref(meeting.id));
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
        void meetingsQuery.refetch();
        dismiss();
        toast({
          title: MEETING_ENTRY_COPY.alreadyStartedTitle,
          description: MEETING_ENTRY_COPY.alreadyStartedBody,
        });
        return;
      }
      toast({
        title: MEETING_ENTRY_COPY.startFailed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <section
      aria-label="Your meeting is on"
      className="mt-3 grid shrink-0 gap-1.5 rounded-lg border border-accent-border bg-accent-subtle p-3"
    >
      <p className="truncate text-sm font-semibold text-accent-text">
        {live.name} is on
      </p>
      <p className="text-caption text-muted-foreground">
        {when} No minutes yet.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="tinted"
          disabled={start.isPending}
          onClick={() => void begin()}
        >
          Start minutes
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
