"use client";

import { Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useState } from "react";
import { ProfileSection } from "@/components/profile/profile-section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { denseListClassName } from "@/components/shared/table-controls";
import { GoogleCalendarRow } from "@/components/linked-apps/google-calendar-row";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import { useGoogleCalendarReturn } from "@/lib/events/google-calendar-connect";
import { useCalendarLinkActions } from "@/lib/events/calendar-link-actions";

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
  // The link is made the first time it's asked for (Copy, or the menu), not
  // when the page opens, so glancing at Settings mints no link.
  const [wanted, setWanted] = useState(false);
  const { link, apps, copyLink, resetLink, resetting, confirmDialog } =
    useCalendarLinkActions({ enabled: wanted });

  async function copy() {
    setWanted(true);
    const url = link.data?.url ?? (await link.refetch()).data?.url;
    await copyLink(url);
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
          disabled={link.isFetching && !link.data}
          onClick={() => void copy()}
        >
          Copy link
        </Button>
        <DropdownMenu onOpenChange={(open) => open && setWanted(true)}>
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
              disabled={!link.data || resetting}
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
