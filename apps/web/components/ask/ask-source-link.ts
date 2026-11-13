import { askSourceTarget, type AskSource } from "@repo/validation";
import { chatDeepLink } from "@/lib/chat/chat-links";

/** `/documents?document=<id>` opens that file in the viewer (`documents-page.tsx`). */
export const DOCUMENT_LINK_PARAM = "document";

/** The dashboard route each live-data source opens. Dues has no web page in the beta. */
const PAGE_ROUTES: Record<string, string | null> = {
  members: "/members",
  events: "/events",
  points: "/points",
  dues: null,
  tasks: "/tasks",
};

/**
 * Where a source opens on web, or null when this build has no page for it:
 * the document in the viewer, the meeting's minutes, the message in its
 * channel, or the page the live data came from. A source with no link is
 * still shown, as plain text (`ask.ts`: kinds and targets are open strings).
 */
export function askSourceHref(source: AskSource): string | null {
  const target = askSourceTarget(source);
  if (!target) return null;
  switch (target.type) {
    case "document":
      return `/documents?${DOCUMENT_LINK_PARAM}=${encodeURIComponent(target.document_id)}`;
    case "meeting":
      return `/meetings/${encodeURIComponent(target.meeting_id)}`;
    case "message":
      return chatDeepLink({
        channelId: target.channel_id,
        messageId: target.message_id,
      });
    case "page":
      return PAGE_ROUTES[target.page] ?? null;
  }
}
