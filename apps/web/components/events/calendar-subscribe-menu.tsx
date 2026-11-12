"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  Copy,
  RotateCcw,
  Unlink,
} from "lucide-react";
import {
  calendarAppLinks,
  errorCopy,
  GOOGLE_CALENDAR_RETURN_PARAMS,
  readGoogleCalendarReturn,
  useActiveChapterId,
  useCalendarFeedLink,
  useConfirmGoogleCalendarConnect,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useResetCalendarFeedLink,
  useStartGoogleCalendarConnect,
  type GoogleCalendarReturn,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";

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
  const link = useCalendarFeedLink({ enabled: open });
  const reset = useResetCalendarFeedLink();
  const google = useGoogleCalendarStatus();
  const startGoogle = useStartGoogleCalendarConnect();
  const disconnectGoogle = useDisconnectGoogleCalendar();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const apps = link.data ? calendarAppLinks(link.data) : null;
  const googleConnect = google.data?.available ? google.data : null;
  useGoogleCalendarReturn();

  async function connectGoogle() {
    try {
      const url = await startGoogle.mutateAsync({ client: "web" });
      window.location.assign(url);
    } catch (error) {
      toast({
        variant: "destructive",
        description: errorCopy(error, "Couldn't open Google. Try again."),
      });
    }
  }

  async function disconnectGoogleCalendar() {
    const account = googleConnect?.google_email;
    const ok = await confirm({
      title: "Disconnect Google Calendar?",
      description: `Frapp's calendar is removed from ${
        account ? `your Google account (${account})` : "your Google account"
      }. Your other calendars aren't touched.`,
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await disconnectGoogle.mutateAsync();
      toast({ description: "Google Calendar disconnected." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: errorCopy(error, "Couldn't disconnect. Try again."),
      });
    }
  }

  async function copyLink() {
    if (!link.data) return;
    try {
      // Inside the try: without a secure context `navigator.clipboard` is
      // undefined and the call throws before any promise exists.
      await navigator.clipboard.writeText(link.data.url);
      toast({
        description: "Link copied. Paste it where your calendar app adds a calendar by URL.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Try again, or use one of the calendar apps above.",
      });
    }
  }

  async function resetLink() {
    const ok = await confirm({
      title: "Reset your calendar link?",
      description:
        "Calendars using your current link will go empty at their next update. Subscribe again with the new link afterwards.",
      confirmLabel: "Reset link",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await reset.mutateAsync();
      toast({ description: "Link reset. Subscribe again to keep your calendar." });
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't reset your link. Try again.",
      });
    }
  }

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
                href="https://calendar.google.com/calendar/r"
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
              disabled={startGoogle.isPending}
              onSelect={() => void connectGoogle()}
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
              disabled={disconnectGoogle.isPending}
              onSelect={() => void disconnectGoogleCalendar()}
            >
              <Unlink aria-hidden="true" />
              Disconnect Google Calendar
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!link.data || reset.isPending}
            onSelect={() => void resetLink()}
          >
            <RotateCcw aria-hidden="true" />
            Reset link
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-1.5 text-caption text-muted-foreground">
            {googleConnect?.connected && googleConnect.google_email
              ? `Google Calendar is connected as ${googleConnect.google_email} and updates within minutes. Other calendar apps check on their own schedule.`
              : googleConnect
                ? "Google Calendar updates within minutes once connected. Other calendar apps check on their own schedule."
                : "Your calendar app checks for changes on its own schedule. Google Calendar can take several hours."}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}

const GOOGLE_RETURN_COPY: Record<
  Exclude<GoogleCalendarReturn["kind"], "confirm">,
  string
> = {
  denied: "Google Calendar wasn't connected.",
  expired: "That Google sign-in expired. Connect Google Calendar again.",
  failed: "Google didn't finish the sign-in. Connect Google Calendar again.",
};

/**
 * Finishes a Google sign-in when Google sends the member back to Events.
 *
 * Read once, on mount, and stripped from the address bar at once: the code is
 * a one-time credential, and a URL is the most-copied place a value can sit.
 * The confirm runs as soon as a chapter is active, exactly once (the ref is
 * cleared first, so React's development double-invoke can't spend it twice).
 */
function useGoogleCalendarReturn() {
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
        description: GOOGLE_RETURN_COPY[outcome.kind],
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
      .then(() =>
        toast({
          description:
            "Google Calendar connected. Your events show up there within a minute.",
        }),
      )
      .catch((error: unknown) =>
        toast({
          variant: "destructive",
          description: errorCopy(error, GOOGLE_RETURN_COPY.failed, {
            serverWritesForMembers: true,
          }),
        }),
      );
  }, [chapterId, confirmConnect, toast]);
}
