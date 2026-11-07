import type { SignetTokens } from "@repo/theme/signet";
import type { HoursPayload } from "@repo/chat-core/cards";
import { formatBareDateMedium, formatMinutesExact } from "@repo/formatting";
import {
  canReadCardServiceEntry,
  readLiveServiceEntry,
  SERVICE_ENTRY_CARD_LABELS,
  useMyPermissions,
  useServiceEntry,
  type ServiceEntryStatus,
} from "@repo/hooks";
import { can, statusLabel } from "@repo/validation";
import { StatusChip } from "@/components/status-chip";
import { useFrappTheme } from "@/lib/theme";
import { ServiceHoursGlyph } from "./card-glyphs";
import {
  CardEyebrow,
  CardQuote,
  CardSentence,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * The chat service-hours card on mobile (#3383), web's
 * `apps/web/components/chat/renderers/hours-card.tsx` on the phone.
 *
 * A read-only record of one `/hours log`: who logged how long on which day,
 * and what for. The server posts it after the entry commits (a client cannot
 * forge `kind:"hours"`). Review happens on the service hours screen, not here.
 *
 * **The badge is the entry's live review status, or nothing.** The message is
 * a snapshot whose status is `PENDING` forever, so the card reads the entry
 * back (`useServiceEntry`) and draws "Pending review", "Approved" or
 * "Rejected" from that, the rules in `@repo/hooks`'s `service-entry-card.ts`
 * that web's card applies too. Only a `members:view` holder who logged it or
 * holds `service:approve` may read an entry; anyone else would get a 403, so
 * their card asks nothing and shows no badge, as it does before the read lands
 * and when the read answers with no entry. Until the viewer's permissions are
 * read, only the member who logged it asks (`canReadCardServiceEntry`).
 */
export function HoursCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: HoursPayload }) {
  const { tokens } = useFrappTheme();
  // `!!viewerId`: a missing viewer must never match a missing member id.
  const isOwner = !!frame.viewerId && frame.viewerId === payload.user_id;
  // The query, not `usePermissionList()`: its `[]` can't tell "holds
  // nothing" from "not read yet", and the read rule treats those apart.
  const permissions = useMyPermissions().data?.permissions;
  const canApprove = can("service:approve", permissions);
  const canViewMembers = can("members:view", permissions);
  const entryQuery = useServiceEntry(
    canReadCardServiceEntry({
      isOwner,
      canApprove,
      canViewMembers,
      permissionsKnown: Array.isArray(permissions),
    })
      ? payload.entry_id
      : "",
  );
  const live = readLiveServiceEntry(entryQuery.data);

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow
            label="Service hours"
            glyph={ServiceHoursGlyph}
            trailing={
              live ? (
                <StatusChip
                  label={
                    SERVICE_ENTRY_CARD_LABELS[live.status] ??
                    statusLabel("serviceEntry", live.status)
                  }
                  hue={statusHue(live.status, tokens)}
                />
              ) : null
            }
          />
          <CardSentence
            parts={[
              { text: payload.user_name },
              { text: "logged", tone: "muted" },
              { text: formatMinutesExact(payload.duration_minutes) },
              { text: "on", tone: "muted" },
              { text: formatBareDateMedium(payload.date) },
            ]}
          />
          {payload.description.trim() ? (
            <CardQuote text={payload.description} />
          ) : null}
        </>
      }
    />
  );
}

/**
 * The badge's hue, web's `serviceStatusKind`: a status color, never the
 * chapter accent (§5). Pending is not yet settled, so it is the warning.
 */
function statusHue(status: ServiceEntryStatus, tokens: SignetTokens): string {
  switch (status) {
    case "APPROVED":
      return tokens.color.semantic.success;
    case "REJECTED":
      return tokens.color.semantic.destructive;
    case "PENDING":
      return tokens.color.semantic.warning;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}
