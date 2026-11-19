"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import {
  useMeeting,
  useMeetingNoteTaking,
  useMeetings,
  useMinutesRequest,
  useMyPermissions,
  useStartMeeting,
} from "@repo/hooks";
import {
  MEETING_ENTRY_COPY,
  MEETING_NOTE_TAKERS_COPY,
  MINUTES_REQUEST_COPY,
  can,
  eventMinutesLines,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { RequestMinutesButton } from "@/components/meetings/request-minutes-button";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";
import {
  guessMeetingType,
  meetingHref,
} from "@/components/meetings/meeting-copy";

/** Whether the chapter keeps minutes in Frapp, once the module read answers. */
export function useMeetingsModuleOn(): boolean {
  const gate = useChapterModuleGateState();
  return gate.status === "ready" && gate.isModuleEnabled("meetings");
}

/**
 * The event sheet's way into its minutes (`spec/behavior/meetings.md` §
 * Writing minutes): Open minutes when the viewer may read them, or Write
 * minutes for someone who records them, which starts them in one tap with
 * the type the event's name suggests, as Granola starts a note from the
 * calendar event. Nothing at all while the meetings module is off.
 *
 * Minutes the reader can open say where they stand (posted on which day, or
 * a draft), how many decisions and action items they hold, and the TL;DR's
 * first line, so the event answers "what happened" before a click (Paul,
 * 2026-11-19, the Meetings-by-event design).
 *
 * Someone else's unposted minutes offer Take notes instead (#4935): to an
 * officer who records minutes, and to a member their author added. To
 * anyone else the event invites, once it has ended, they offer Request
 * minutes (#5471).
 */
export function EventMinutes({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const on = useMeetingsModuleOn();
  const router = useRouter();
  const { toast } = useToast();
  const meetingsQuery = useMeetings({ enabled: on && !!eventId, eventId });
  const takingQuery = useMeetingNoteTaking({
    enabled: on && !!eventId,
    eventId,
  });
  // Only asked once the reader is known to see no minutes of their own.
  const requestQuery = useMinutesRequest({
    enabled: on && meetingsQuery.isSuccess && !meetingsQuery.data?.[0],
    eventId,
  });
  // The TL;DR lives on the minutes themselves, read once they are known.
  const detailQuery = useMeeting(on ? meetingsQuery.data?.[0]?.id : null);
  const permissions = useMyPermissions().data?.permissions ?? [];
  const start = useStartMeeting();

  const canRecord = can("meetings:record", permissions);
  if (!on || !eventId) return null;
  if (meetingsQuery.isPending) {
    // Someone who records minutes always gets the row, so it holds its place
    // while the read answers instead of pushing the notes down when it lands.
    return canRecord ? <MinutesRowFrame status={null} /> : null;
  }
  // Unknown is not "nobody wrote them": offering Write minutes on a failed
  // read would only meet a 409.
  if (meetingsQuery.isError) return null;
  const minutes = meetingsQuery.data?.[0];
  const taking = minutes ? undefined : takingQuery.data?.[0];
  if (taking) {
    return (
      <MinutesRowFrame
        status={`${MEETING_NOTE_TAKERS_COPY.listItem(taking.author_name)}, ${MEETING_ENTRY_COPY.draft.toLowerCase()}`}
      >
        <Link
          href={`/meetings/${taking.meeting_id}/notes`}
          className={cn(inlineNoteActionClassName, "text-sm")}
        >
          {taking.joined
            ? MEETING_NOTE_TAKERS_COPY.takingNotes
            : MEETING_NOTE_TAKERS_COPY.takeNotes}
        </Link>
      </MinutesRowFrame>
    );
  }
  // Take notes wins: Request waits until the note-taking read has answered.
  const askable =
    minutes || takingQuery.isPending ? null : requestQuery.data;
  if (askable) {
    return (
      <MinutesRowFrame
        status={
          askable.requested
            ? MINUTES_REQUEST_COPY.requestedStatus
            : MINUTES_REQUEST_COPY.notPosted
        }
      >
        <RequestMinutesButton state={askable} />
      </MinutesRowFrame>
    );
  }
  if (!minutes && !canRecord) return null;
  // Someone else may have started them; the note-taking read decides. The
  // request read doesn't hold the row: an officer's Write minutes shows at
  // once, and an unposted draft they can't open turns it into Request.
  if (!minutes && takingQuery.isPending) {
    return <MinutesRowFrame status={null} />;
  }

  async function write() {
    try {
      const meeting = await start.mutateAsync({
        event_id: eventId,
        meeting_type: guessMeetingType(eventName),
      });
      router.push(meetingHref(meeting.id));
    } catch (error) {
      if (codeOf(error) === "meeting.already_started") {
        void meetingsQuery.refetch();
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

  const lines = minutes
    ? eventMinutesLines(minutes, detailQuery.data?.content?.tldr)
    : null;
  return (
    <MinutesRowFrame
      status={lines ? lines.status : MEETING_ENTRY_COPY.none}
      gist={lines?.gist}
    >
      {minutes ? (
        <Link
          href={meetingHref(minutes.id)}
          // Not in a sentence, so it takes the row's 14px itself, as the
          // status beside it and the Write minutes button in its place do.
          className={cn(inlineNoteActionClassName, "shrink-0 text-sm")}
        >
          {MEETING_ENTRY_COPY.open}
        </Link>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={start.isPending}
          onClick={() => void write()}
        >
          {MEETING_ENTRY_COPY.write}
        </Button>
      )}
    </MinutesRowFrame>
  );
}

/**
 * The row's frame; `status` null is the quiet placeholder of the same size.
 * `gist`, the minutes' TL;DR line, sits under the status, two lines at most.
 */
function MinutesRowFrame({
  status,
  gist,
  children,
}: {
  status: string | null;
  gist?: string | null;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-16 items-center gap-3 rounded-lg border border-border p-3"
      aria-busy={status === null ? true : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">
          {MEETING_ENTRY_COPY.label}
        </p>
        <p className="text-sm">
          {status ?? (
            <span className="text-muted-foreground">
              {MEETING_ENTRY_COPY.checking}
            </span>
          )}
        </p>
        {gist ? (
          <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
            {gist}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
