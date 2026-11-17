"use client";

import { Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import {
  calendarAppLinks,
  useCalendarFeedLink,
  useResetCalendarFeedLink,
} from "@repo/hooks";
import { ProfileSection } from "@/components/profile/profile-section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { denseListClassName } from "@/components/shared/table-controls";
import { GoogleCalendarRow } from "@/components/linked-apps/google-calendar-row";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import { useGoogleCalendarReturn } from "@/lib/events/google-calendar-connect";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Settings → Calendar (`/preferences?section=calendar`, #5407): where a
 * member's chapter calendar goes, the second door to Google Calendar beside
 * Linked apps, as Slack keeps an app both in its own settings and in the
 * connected-apps list. The Events toolbar's Subscribe menu stays the third,
 * next to the calendar itself.
 *
 * Two rows: Google Calendar, the same row Linked apps draws, and the private
 * subscription link for every other calendar app (`spec/behavior/events.md`
 * § Calendar subscription), copied in one click with the apps and Reset a
 * menu away.
 */
export function CalendarSection() {
  useGoogleCalendarReturn();
  return (
    <ProfileSection id="calendar" title="Calendar">
      <ul className={denseListClassName}>
        <GoogleCalendarRow webReturn="calendar" />
        <SubscriptionLinkRow />
      </ul>
    </ProfileSection>
  );
}

function SubscriptionLinkRow() {
  const link = useCalendarFeedLink({ enabled: true });
  const reset = useResetCalendarFeedLink();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const apps = link.data ? calendarAppLinks(link.data) : null;

  async function copyLink() {
    if (!link.data) return;
    try {
      await navigator.clipboard.writeText(link.data.url);
      toast({
        description:
          "Link copied. Paste it where your calendar app adds a calendar by URL.",
      });
    } catch {
      toast({ variant: "destructive", description: "Copy failed. Try again." });
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
      toast({
        description: "Link reset. Subscribe again to keep your calendar.",
      });
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't reset your link. Try again.",
      });
    }
  }

  return (
    <>
      <LinkedAppRow
        icon={<Link2 className="text-foreground" />}
        name="Subscription link"
        showMark={false}
        state={{
          tone: link.isError ? "expired" : "connected",
          detail: link.isError
            ? "Couldn't get your link. Try again in a moment"
            : "Apple Calendar, Outlook and others",
        }}
      >
        <Button
          variant="secondary"
          size="toolbar"
          disabled={!link.data}
          onClick={() => void copyLink()}
        >
          Copy link
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Subscription link options"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild disabled={!apps}>
              <a href={apps?.apple}>Add to Apple Calendar</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!apps}>
              <a href={apps?.outlook} target="_blank" rel="noopener noreferrer">
                Add to Outlook.com
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!apps}>
              <a
                href={apps?.outlookWork}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add to Outlook for school or work
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!link.data || reset.isPending}
              onSelect={() => void resetLink()}
            >
              <RotateCcw aria-hidden="true" />
              Reset link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </LinkedAppRow>
      {confirmDialog}
    </>
  );
}
