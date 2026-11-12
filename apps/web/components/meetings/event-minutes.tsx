"use client";

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

  if (!on || !eventId || meetingsQuery.isPending) return null;
  const minutes = meetingsQuery.data?.[0];
  const canRecord = can("meetings:record", permissions);
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
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">Minutes</p>
        <p className="text-sm">
          {minutes
            ? minutes.status === "draft"
              ? "A draft, not posted yet"
              : "Posted"
            : "Nobody has written them yet"}
        </p>
      </div>
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
    </div>
  );
}
