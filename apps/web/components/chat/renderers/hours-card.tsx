"use client";

import { ServiceGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { serviceStatusKind } from "@/components/service/service-status";
import { cn } from "@/lib/utils";
import { formatBareDateMedium, formatMinutesExact } from "@repo/formatting";
import {
  canReadCardServiceEntry,
  readLiveServiceEntry,
  SERVICE_ENTRY_CARD_LABELS,
  useMyPermissions,
  useServiceEntry,
} from "@repo/hooks";
import { can } from "@repo/validation";
import type { ChatMessage } from "@repo/chat-core/types";
import { readHoursPayload } from "@repo/chat-core/cards";

interface HoursCardProps {
  message: ChatMessage;
  /** Known, never `null` — see `MessageRendererProps.viewerId`. */
  viewerId: string;
}

/**
 * Hours card: a read-only, append-only record of a single service-entry log
 * (`member logged N on DATE`). Server-originated — there are no action buttons
 * and the card is never edited (review happens on the service hours page).
 *
 * **The badge is the entry's live review status, or nothing.** The payload's
 * status is the creation-time `PENDING` forever, so a badge drawn from it
 * called approved hours "Pending review" for good. The card reads the entry
 * back instead (`useServiceEntry`), by the rules in `@repo/hooks`'s
 * `service-entry-card.ts` that mobile's card applies too: only a `members:view`
 * holder who logged it or holds `service:approve` can read an entry, so nobody
 * else asks (for them it is a guaranteed 403), and their card, like every card
 * before its read lands or when it answers with no entry, shows no badge.
 * Until the viewer's permissions are read, only the member who logged it asks. The hue is the
 * service page's own mapping (`serviceStatusKind`).
 */
export function HoursCard({ message, viewerId }: HoursCardProps) {
  const payload = readHoursPayload(message);
  const { data: permissionsPayload } = useMyPermissions();
  // `!!viewerId`, for the reason `task-card` gives: a missing viewer must
  // never match a missing member id.
  const isOwner = !!viewerId && !!payload && viewerId === payload.user_id;
  const permissions = permissionsPayload?.permissions;
  const canApprove = can("service:approve", permissions);
  const canViewMembers = can("members:view", permissions);
  // A hook, so it runs before the malformed-payload return; an empty id holds
  // the request.
  const { data: liveRaw } = useServiceEntry(
    payload &&
      canReadCardServiceEntry({
        isOwner,
        canApprove,
        canViewMembers,
        permissionsKnown: Array.isArray(permissions),
      })
      ? payload.entry_id
      : "",
  );

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const live = readLiveServiceEntry(liveRaw);

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            EYEBROW,
            "flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <ServiceGlyph className="h-4 w-4" /> Service hours
        </div>
        {live ? (
          <Badge variant={serviceStatusKind(live.status)}>
            {SERVICE_ENTRY_CARD_LABELS[live.status]}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
        <span className="font-semibold">{payload.user_name}</span>
        <span className="text-muted-foreground">logged</span>
        <span className="font-semibold">
          {formatMinutesExact(payload.duration_minutes)}
        </span>
        <span className="text-muted-foreground">on</span>
        <span className="font-semibold">
          {formatBareDateMedium(payload.date)}
        </span>
      </div>
      {payload.description.trim() ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">
          &ldquo;{payload.description}&rdquo;
        </div>
      ) : null}
    </Card>
  );
}
