"use client";

import {
  calendarAppLinks,
  useCalendarFeedLink,
  useResetCalendarFeedLink,
} from "@repo/hooks";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * The private calendar link's Copy and Reset (`spec/behavior/events.md`
 * § Calendar subscription), for the two web screens that offer it: the Events
 * Subscribe menu and Settings → Calendar (#5407). One copy, so the two say
 * the same thing.
 *
 * `enabled` is whether the link is wanted yet: it is made the first time a
 * member asks for it, so pass true only once they open the menu or press
 * Copy (`useCalendarFeedLink`).
 */
export function useCalendarLinkActions({ enabled }: { enabled: boolean }) {
  const link = useCalendarFeedLink({ enabled });
  const reset = useResetCalendarFeedLink();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const apps = link.data ? calendarAppLinks(link.data) : null;

  async function copyLink(url = link.data?.url) {
    if (!url) return;
    try {
      // Inside the try: without a secure context `navigator.clipboard` is
      // undefined and the call throws before any promise exists.
      await navigator.clipboard.writeText(url);
      toast({
        description:
          "Link copied. Paste it where your calendar app adds a calendar by URL.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Try again, or add it to a calendar app instead.",
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

  return {
    link,
    apps,
    copyLink,
    resetLink,
    resetting: reset.isPending,
    confirmDialog,
  };
}
