import {
  askSourceTarget,
  isBetaOffModule,
  type AskSource,
} from "@repo/validation";
import type { NotificationTarget } from "@/lib/notifications/targets";

/**
 * Where an Ask source opens on the phone (`spec/behavior/ai.md` § Ask; #451),
 * or `null` when this build has no screen for it. A source with no screen is
 * still listed, as plain text: kinds and targets are open strings on the wire
 * (`ask.ts`), so a newer server can cite something this build can't open.
 *
 * - A document opens in the in-app browser from where the member is
 *   (`AskSheet` fetches its signed link), so it is `{ document }`, not a route.
 * - Minutes open the minutes screen.
 * - A channel message opens its channel. The phone's channel screen has no
 *   jump-to-message yet, so the member lands at the newest message.
 * - Live data opens the screen it was read from. Points live on the Tasks
 *   board; Dues is off for the beta, so it has no link while that holds.
 *
 * The routes are spelled `pathname: "…"` so `lib/routes.spec.ts` checks them
 * against the file tree (see `lib/notifications/targets.ts`).
 */
export type AskSourceOpening =
  | { kind: "document"; documentId: string }
  | { kind: "route"; target: NotificationTarget };

const PAGES: Record<string, NotificationTarget> = {
  members: { pathname: "/directory" },
  events: { pathname: "/events" },
  points: { pathname: "/tasks" },
  dues: { pathname: "/dues" },
};

export function askSourceOpening(source: AskSource): AskSourceOpening | null {
  const target = askSourceTarget(source);
  if (!target) return null;
  switch (target.type) {
    case "document":
      return { kind: "document", documentId: target.document_id };
    case "meeting":
      return {
        kind: "route",
        target: {
          pathname: "/minutes-details",
          params: { id: target.meeting_id },
        },
      };
    case "message":
      return {
        kind: "route",
        target: {
          pathname: "/chat-thread",
          params: { channelId: target.channel_id },
        },
      };
    case "page": {
      if (target.page === "dues" && isBetaOffModule("dues")) return null;
      const page = PAGES[target.page];
      return page ? { kind: "route", target: page } : null;
    }
  }
}
