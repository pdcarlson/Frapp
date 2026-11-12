"use client";

import { useState } from "react";
import { CalendarPlus, ChevronDown, Copy, RotateCcw } from "lucide-react";
import {
  calendarAppLinks,
  useCalendarFeedLink,
  useResetCalendarFeedLink,
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
 */
export function CalendarSubscribeMenu() {
  const [open, setOpen] = useState(false);
  const link = useCalendarFeedLink({ enabled: open });
  const reset = useResetCalendarFeedLink();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const apps = link.data ? calendarAppLinks(link.data) : null;

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
          <DropdownMenuItem asChild disabled={!apps}>
            <a href={apps?.google} target="_blank" rel="noopener noreferrer">
              Google Calendar
            </a>
          </DropdownMenuItem>
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
          <DropdownMenuItem
            disabled={!link.data || reset.isPending}
            onSelect={() => void resetLink()}
          >
            <RotateCcw aria-hidden="true" />
            Reset link
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-1.5 text-caption text-muted-foreground">
            Your calendar app checks for changes on its own schedule. Google
            Calendar can take several hours.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}
