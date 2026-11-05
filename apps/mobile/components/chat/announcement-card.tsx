import { useMemo } from "react";
import { AnnouncementGlyph } from "./card-glyphs";
import {
  CardEyebrow,
  ChatCardShell,
  useCardStyles,
  type ChatCardFrameProps,
} from "./chat-card";
import { MessageMarkdown, parseMessageMarkdown } from "./message-markdown";

/**
 * The chat announcement card on mobile (#3383), web's
 * `apps/web/components/chat/renderers/announcement-card.tsx` on the phone:
 * the `/announce` text under an accent eyebrow.
 *
 * The text is `readAnnouncementBody` from `@repo/chat-core/cards`, which
 * prefers the message's `content` (what the push and the channel preview
 * showed) over `payload.body`. It is drawn through the message markdown a
 * plain message uses, so an announcement's links, mentions and emphasis read
 * as they would in any message, and its links ride the card's screen-reader
 * actions as "Open <link>".
 */
export function AnnouncementCard({
  body,
  ...frame
}: ChatCardFrameProps & { body: string }) {
  const styles = useCardStyles();
  const parsed = useMemo(() => parseMessageMarkdown(body), [body]);
  return (
    <ChatCardShell
      {...frame}
      links={parsed.empty ? [] : parsed.links}
      header={
        <>
          <CardEyebrow label="Announcement" glyph={AnnouncementGlyph} />
          {parsed.empty ? null : (
            <MessageMarkdown
              parsed={parsed}
              style={styles.bodyText}
              onLongPress={frame.onOpenActions}
            />
          )}
        </>
      }
    />
  );
}
