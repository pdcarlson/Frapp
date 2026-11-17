"use client";

import { useEffect, useRef } from "react";
import {
  errorCopy,
  GOOGLE_CALENDAR_RETURN_COPY,
  GOOGLE_CALENDAR_RETURN_PARAMS,
  googleCalendarDisconnectCopy,
  readGoogleCalendarReturn,
  useActiveChapterId,
  useConfirmGoogleCalendarConnect,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useStartGoogleCalendarConnect,
  type GoogleCalendarWebReturn,
} from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";

/** Google Calendar on the web, which Open Google Calendar opens. */
export const GOOGLE_CALENDAR_WEB = "https://calendar.google.com/calendar/r";

/** The toast a finished sign-in shows, wherever it lands. */
const GOOGLE_CALENDAR_CONNECTED_TOAST = {
  title: "Google Calendar connected",
  description: "Your events show up there within a minute.",
} as const;

/**
 * Google Calendar's connect and disconnect for one web screen: the Events
 * Subscribe menu, Settings → Linked apps, or Settings → Calendar (#5407).
 * `webReturn` is that screen, so Google's sign-in comes back to it and the
 * member sees the row they pressed now reading Connected.
 */
export function useGoogleCalendarConnection(
  webReturn: GoogleCalendarWebReturn,
) {
  const status = useGoogleCalendarStatus();
  const start = useStartGoogleCalendarConnect();
  const disconnectMutation = useDisconnectGoogleCalendar();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  async function connect() {
    try {
      const url = await start.mutateAsync({ client: "web", webReturn });
      window.location.assign(url);
    } catch (error) {
      toast({
        variant: "destructive",
        description: errorCopy(error, "Couldn't open Google. Try again."),
      });
    }
  }

  async function disconnect() {
    const ok = await confirm({
      ...googleCalendarDisconnectCopy(status.data?.google_email),
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await disconnectMutation.mutateAsync();
      toast({ description: "Google Calendar disconnected." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: errorCopy(error, "Couldn't disconnect. Try again."),
      });
    }
  }

  return {
    status,
    connect,
    disconnect,
    connecting: start.isPending,
    disconnecting: disconnectMutation.isPending,
    confirmDialog,
  };
}

/**
 * Finishes a Google sign-in when Google sends the member back to the screen
 * that started it. Mount it once per screen.
 *
 * Read once, on mount, and stripped from the address bar at once: the code is
 * a one-time credential, and a URL is the most-copied place a value can sit.
 * The confirm runs as soon as a chapter is active, exactly once (the ref is
 * cleared first, so React's development double-invoke can't spend it twice).
 */
export function useGoogleCalendarReturn() {
  const chapterId = useActiveChapterId();
  const confirmConnect = useConfirmGoogleCalendarConnect().mutateAsync;
  const { toast } = useToast();
  const pending = useRef<{ code: string; state: string } | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = new URL(window.location.href);
    const outcome = readGoogleCalendarReturn(url.searchParams);
    if (!outcome) return;
    if (outcome.kind === "confirm") {
      pending.current = { code: outcome.code, state: outcome.state };
    } else {
      toast({
        variant: outcome.kind === "denied" ? undefined : "destructive",
        description: GOOGLE_CALENDAR_RETURN_COPY[outcome.kind],
      });
    }
    for (const param of GOOGLE_CALENDAR_RETURN_PARAMS) {
      url.searchParams.delete(param);
    }
    window.history.replaceState(null, "", url.toString());
  }, [toast]);

  useEffect(() => {
    const finish = pending.current;
    if (!finish || !chapterId) return;
    pending.current = null;
    confirmConnect(finish)
      .then(() => toast({ ...GOOGLE_CALENDAR_CONNECTED_TOAST }))
      .catch((error: unknown) =>
        toast({
          variant: "destructive",
          description: errorCopy(error, GOOGLE_CALENDAR_RETURN_COPY.failed, {
            serverWritesForMembers: true,
          }),
        }),
      );
  }, [chapterId, confirmConnect, toast]);
}
