"use client";

import { CalendarDays, ExternalLink, RotateCcw, Unlink } from "lucide-react";
import {
  googleCalendarLinkedState,
  type GoogleCalendarWebReturn,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { ActionMenuButton } from "@/components/shared/row-menu";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import {
  GOOGLE_CALENDAR_WEB,
  useGoogleCalendarConnection,
} from "@/lib/events/google-calendar-connect";

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
  // A failed read draws the row with a retry: no row would read as "not
  // offered here", which is a claim (`DiscordRow` does the same).
  if (google.status.isError) {
    return (
      <LinkedAppRow
        icon={<CalendarDays className="text-foreground" />}
        name="Google Calendar"
        state={{ tone: "off", detail: "Couldn't load your connection" }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Try loading Google Calendar again"
          onClick={() => void google.status.refetch()}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </LinkedAppRow>
    );
  }
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
          <ActionMenuButton
            label="More for Google Calendar"
            entries={[
              {
                type: "item",
                key: "open",
                label: "Open Google Calendar",
                icon: ExternalLink,
                href: GOOGLE_CALENDAR_WEB,
                external: true,
              },
              {
                type: "item",
                key: "disconnect",
                label: "Disconnect",
                icon: Unlink,
                disabled: google.disconnecting,
                onSelect: () => void google.disconnect(),
              },
            ]}
          />
        ) : null}
      </LinkedAppRow>
      {google.confirmDialog}
    </>
  );
}
