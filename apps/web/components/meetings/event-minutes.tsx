"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { codeOf } from "@repo/api-sdk";
import { useMeetings, useMyPermissions, useStartMeeting } from "@repo/hooks";
import { can } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
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
  if (!minutes && !canRecord) return null;

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
          title: "These minutes are already started",
          description:
            "Someone else started minutes for this meeting. They show here once they are posted.",
        });
        return;
      }
      toast({
        title: "Couldn't start the minutes",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <MinutesRowFrame
      status={
        minutes
          ? minutes.status === "draft"
            ? "A draft, not posted yet"
            : "Posted"
          : "Nobody has written them yet"
      }
    >
      {minutes ? (
        <Link
          href={meetingHref(minutes.id)}
          className={inlineNoteActionClassName}
        >
          Open minutes
        </Link>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={start.isPending}
          onClick={() => void write()}
        >
          Write minutes
        </Button>
      )}
    </MinutesRowFrame>
  );
}

/** The row's frame; `status` null is the quiet placeholder of the same size. */
function MinutesRowFrame({
  status,
  children,
}: {
  status: string | null;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-16 items-center gap-3 rounded-lg border border-border p-3"
      aria-busy={status === null ? true : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">Minutes</p>
        <p className="text-sm">
          {status ?? <span className="text-muted-foreground">Checking</span>}
        </p>
      </div>
      {children}
    </div>
  );
}
