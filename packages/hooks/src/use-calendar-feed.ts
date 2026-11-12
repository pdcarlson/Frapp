import { throwUnlessOk } from "@repo/api-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The member's private calendar subscription link (#3322): what web's and
 * mobile's "Add to calendar" menus hand to Apple Calendar, Google Calendar or
 * Outlook. Behavior: `spec/behavior/events.md` § Calendar subscription.
 */
export const calendarFeedKeys = createChapterQueryKeys("calendar-feed");

export interface CalendarFeedLink {
  /** https: Google Calendar and Outlook subscribe by URL; Copy link. */
  url: string;
  /** webcal://: Apple Calendar opens it as a new subscription. */
  webcal_url: string;
}

/**
 * The link, made on the first ask (the route is an idempotent POST: asking
 * again returns the same link). Pass `enabled` while the menu is open, so a
 * member who never opens it never gets a link made for them.
 */
export function useCalendarFeedLink(options: { enabled: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: calendarFeedKeys.chapter(chapterId!),
    queryFn: async (): Promise<CalendarFeedLink> => {
      const result = await client.POST("/v1/calendar-feed");
      throwUnlessOk(result);
      return result.data!;
    },
    // The link only changes when the member resets it, which writes the cache.
    staleTime: Infinity,
    enabled: options.enabled && !!chapterId,
  });
}

/**
 * Replace the link. Calendars subscribed to the old one show nothing from
 * their next check, so the member subscribes again with the new link.
 */
export function useResetCalendarFeedLink() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["calendar-feed", "reset"],
    mutationFn: async (): Promise<CalendarFeedLink> => {
      const result = await client.POST("/v1/calendar-feed/reset");
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: (link) => {
      if (chapterId) {
        queryClient.setQueryData(calendarFeedKeys.chapter(chapterId), link);
      }
    },
  });
}

/**
 * Where each calendar app takes the link. Apple Calendar opens `webcal://`
 * itself. Google Calendar and Outlook on the web each have an add-by-URL page
 * that takes the link as a parameter, the same doors Canvas and TeamSnap
 * hand their members.
 */
export function calendarAppLinks(link: CalendarFeedLink): {
  apple: string;
  google: string;
  outlook: string;
} {
  return {
    apple: link.webcal_url,
    // Google reads `cid` as a calendar to add; a webcal:// address makes it a
    // subscription by URL rather than a calendar id.
    google: `https://calendar.google.com/calendar/r?${new URLSearchParams(
      { cid: link.webcal_url },
    ).toString()}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?${new URLSearchParams(
      { url: link.url, name: "Frapp" },
    ).toString()}`,
  };
}
