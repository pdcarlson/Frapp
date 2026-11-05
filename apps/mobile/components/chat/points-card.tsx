import { pointsChange, type PointsPayload } from "@repo/chat-core/cards";
import { PointsGlyph } from "./card-glyphs";
import {
  CardEyebrow,
  CardQuote,
  CardSentence,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * The chat points card on mobile (#3383), web's
 * `apps/web/components/chat/renderers/points-card.tsx` on the phone.
 *
 * A read-only record of one ledger adjustment: who granted or deducted how
 * many points from whom, and why. The server posts it after the ledger write
 * commits (a client cannot forge `kind:"points"`), and it is never edited: a
 * correction is a new entry. The names are the snapshot taken at that write,
 * so a member who has since left still reads by name.
 *
 * The sentence is `pointsChange` from `@repo/chat-core/cards`, web's words:
 * a grant in the success hue, a deduction in the destructive one with the
 * typographic minus.
 */
export function PointsCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: PointsPayload }) {
  const change = pointsChange(payload);
  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow label="Points" glyph={PointsGlyph} />
          <CardSentence
            parts={[
              { text: payload.actor_name },
              { text: change.verb, tone: "muted" },
              {
                text: change.amount,
                tone: change.fine ? "destructive" : "success",
              },
              { text: change.preposition, tone: "muted" },
              { text: payload.recipient_name },
            ]}
          />
          {payload.reason.trim() ? <CardQuote text={payload.reason} /> : null}
        </>
      }
    />
  );
}
