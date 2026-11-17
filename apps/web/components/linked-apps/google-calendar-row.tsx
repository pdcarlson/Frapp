"use client";

import {
  CalendarDays,
  ExternalLink,
  MoreHorizontal,
  Unlink,
} from "lucide-react";
import {
  googleCalendarLinkedState,
  type GoogleCalendarWebReturn,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import { useGoogleCalendarConnection } from "@/lib/events/google-calendar-connect";

const GOOGLE_CALENDAR_WEB = "https://calendar.google.com/calendar/r";

/**
 * Google Calendar's Linked apps row (#5407). Drawn on Settings → Linked apps
 * and Settings → Calendar; `webReturn` is which, so Google's sign-in comes
 * back to the same row. Nothing is drawn where the server doesn't offer
 * Google Calendar, or before its status is read.
 *
 * Off: Connect. Connected: a "…" menu with Open Google Calendar and
 * Disconnect, as Discord's Connections keep the account's actions a click
 * away. Expired: Reconnect beside the same menu.
 */
export function GoogleCalendarRow({
  webReturn,
}: {
  webReturn: GoogleCalendarWebReturn;
}) {
  const google = useGoogleCalendarConnection(webReturn);
  const state = googleCalendarLinkedState(google.status.data);
  if (!state) return null;

  return (
    <>
      <LinkedAppRow
        icon={<CalendarDays className="text-foreground" />}
        name="Google Calendar"
        state={state}
      >
        {state.tone !== "connected" ? (
          <Button
            variant="secondary"
            size="toolbar"
            disabled={google.connecting}
            onClick={() => void google.connect()}
          >
            {state.tone === "expired" ? "Reconnect" : "Connect"}
          </Button>
        ) : null}
        {state.tone !== "off" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Google Calendar options"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a
                  href={GOOGLE_CALENDAR_WEB}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden="true" />
                  Open Google Calendar
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={google.disconnecting}
                onSelect={() => void google.disconnect()}
              >
                <Unlink aria-hidden="true" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </LinkedAppRow>
      {google.confirmDialog}
    </>
  );
}
