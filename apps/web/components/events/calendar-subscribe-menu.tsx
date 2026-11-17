"use client";

import { useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  Copy,
  RotateCcw,
  Unlink,
} from "lucide-react";
import { googleCalendarFootnote } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GOOGLE_CALENDAR_WEB,
  useGoogleCalendarConnection,
  useGoogleCalendarReturn,
} from "@/lib/events/google-calendar-connect";
import { useCalendarLinkActions } from "@/lib/events/calendar-link-actions";

/**
 * "Subscribe" on the Events toolbar (#3322): puts the chapter's events, and
 * the member's own open tasks, on the calendar they already use, through a
 * private link the calendar app keeps checking.
 * Behavior: `spec/behavior/events.md` § Calendar subscription.
 *
 * Shaped after the apps members already use for this: TeamSnap's Schedule
 * page has a Subscribe button, Canvas's Calendar has a "Calendar Feed" link,
 * and Heja's schedule offers Google Calendar or Copy link. Each is one control
 * on the calendar screen that opens the choice of calendar app, not a
 * settings page, so this is one toolbar menu: a row per app, then Copy link
 * for anything else, then Reset link, which Canvas and Google Calendar's own
 * "secret address" both offer for a link that got out.
 *
 * The link is asked for only when the menu opens, so a member who never
 * opens it never has one made. Until it arrives the rows are drawn but
 * disabled, so the menu never changes size.
 *
 * Google Calendar (#3322, step 2; § Google Calendar): where the server offers
 * it, the Google row connects the member's Google account instead of handing
 * Google the link, because Google re-reads a subscribed link only every few
 * hours while a connection updates within minutes. That is the shape Reclaim,
 * Motion and Cal.com use, and the one TeamSnap and Spond's link-only menus
 * leave out: one "Google Calendar" row that goes to Google's own sign-in, a
 * calendar of Frapp's own in the account, and a Disconnect beside Reset link.
 * Connected, the row opens Google Calendar and says which account.
 */
export function CalendarSubscribeMenu() {
  const [open, setOpen] = useState(false);
  const { link, apps, copyLink, resetLink, resetting, confirmDialog } =
    useCalendarLinkActions({ enabled: open });
  const google = useGoogleCalendarConnection("events");
  const googleConnect = google.status.data?.available
    ? google.status.data
    : null;
  useGoogleCalendarReturn();

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="toolbar"
            variant="secondary"
            className="shrink-0 gap-2"
            aria-label="Subscribe to chapter events in your calendar"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Subscribe
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <p className="px-2 pt-1.5 pb-1 text-sm text-muted-foreground">
            {link.isError
              ? "Couldn't get your calendar link. Close this and try again."
              : "Chapter events you can see and your open tasks, kept up to date."}
          </p>
          <DropdownMenuItem asChild disabled={!apps}>
            <a href={apps?.apple}>Apple Calendar</a>
          </DropdownMenuItem>
          {googleConnect?.connected && googleConnect.status === "active" ? (
            <DropdownMenuItem asChild>
              <a
                href={GOOGLE_CALENDAR_WEB}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Calendar
                <span className="ml-auto truncate text-caption text-muted-foreground">
                  Connected
                </span>
              </a>
            </DropdownMenuItem>
          ) : googleConnect ? (
            <DropdownMenuItem
              disabled={google.connecting}
              onSelect={() => void google.connect()}
            >
              Google Calendar
              {googleConnect.status === "needs_reconnect" ? (
                <span className="ml-auto text-caption text-destructive">
                  Reconnect
                </span>
              ) : null}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild disabled={!apps}>
              <a href={apps?.google} target="_blank" rel="noopener noreferrer">
                Google Calendar
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild disabled={!apps}>
            <a href={apps?.outlook} target="_blank" rel="noopener noreferrer">
              Outlook.com
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!apps}>
            <a
              href={apps?.outlookWork}
              target="_blank"
              rel="noopener noreferrer"
            >
              Outlook for school or work
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!link.data}
            onSelect={() => void copyLink()}
          >
            <Copy aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {googleConnect?.connected ? (
            <DropdownMenuItem
              disabled={google.disconnecting}
              onSelect={() => void google.disconnect()}
            >
              <Unlink aria-hidden="true" />
              Disconnect Google Calendar
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!link.data || resetting}
            onSelect={() => void resetLink()}
          >
            <RotateCcw aria-hidden="true" />
            Reset link
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-1.5 text-caption text-muted-foreground">
            {googleCalendarFootnote(googleConnect)}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
      {google.confirmDialog}
    </>
  );
}
