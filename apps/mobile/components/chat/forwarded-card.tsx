import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  FORWARDED_LABEL,
  FORWARDED_ORIGINAL_DELETED,
  forwardedAttachmentLabel,
} from "@repo/chat-core/forwarded";
import type { ForwardedFrom } from "@repo/chat-core/types";
import { formatRelativeDayTime } from "@repo/formatting";
import { resolveAuthorLabel, useChannels } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { isDirectChannel, selectChannels } from "@/lib/chat/channel-list";
import { italicFontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { MessageGifImage } from "./message-gif";
import { MessageMarkdown, parseMessageMarkdown } from "./message-markdown";

/** A forward's copy marks no `@` token: its mentions pinged nobody here. */
const NO_CHIPS = () => false;

export interface ForwardedCardProps {
  forwarded: ForwardedFrom;
  /**
   * The placeholder for a copy the viewer's block list hides
   * (`hiddenForwardedText` in `@repo/chat-core/blocks`). When set, nothing the
   * original's author wrote is drawn: no name, text, GIF or file count.
   */
  hidden: string | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  /** The row's long-press, since the GIF is its own pressable. */
  onLongPress?: () => void;
}

/**
 * The name of the channel the original lives in, only when the viewer's own
 * channel list holds it and it is a channel rather than a conversation. The
 * copy never carries a name, so a private channel's name can't reach someone
 * outside it (#4864).
 */
function useSourceChannelName(channelId: string | null): string | null {
  const { data } = useChannels({ enabled: channelId !== null });
  return useMemo(() => {
    if (!channelId) return null;
    const channel = selectChannels(data).find((row) => row.id === channelId);
    if (!channel || isDirectChannel(channel)) return null;
    return channel.name;
  }, [channelId, data]);
}

/**
 * A forwarded message's card (#4864), web's `ForwardedCard` against mobile
 * tokens: "Forwarded", then the original's author, when it was sent and
 * (where the viewer can see it) its channel, then its text through the body's
 * own markdown renderer with no mention chips, its GIF, and how many files it
 * carried. The files stay with the original, so the card counts them rather
 * than offering them.
 *
 * The reply quote's `popover` block (`ReplyQuote`) with a left rule, so it
 * reads as someone else's words carried into this row. A blanked copy (the
 * original was deleted) says so; a masked one draws the block placeholder.
 */
export function ForwardedCard({
  forwarded,
  hidden,
  nameFor,
  viewerId,
  onLongPress,
}: ForwardedCardProps) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const placeholder = forwarded.deleted ? FORWARDED_ORIGINAL_DELETED : hidden;
  const channelName = useSourceChannelName(
    placeholder !== null ? null : forwarded.channel_id,
  );
  const text = forwarded.content.trim().length > 0 ? forwarded.content : null;
  const parsed = useMemo(
    () => (text ? parseMessageMarkdown(text, NO_CHIPS) : null),
    [text],
  );
  const author = resolveAuthorLabel(forwarded, nameFor, viewerId);
  const when = formatRelativeDayTime(forwarded.created_at);
  const files = forwardedAttachmentLabel(forwarded.attachment_count);

  return (
    <View testID="forwarded-card" style={styles.block}>
      <Text style={styles.label}>{FORWARDED_LABEL}</Text>
      {placeholder !== null ? (
        <Text testID="forwarded-placeholder" style={styles.placeholder}>
          {placeholder}
        </Text>
      ) : (
        <>
          <Text style={styles.meta} numberOfLines={1}>
            <Text style={styles.author}>{author}</Text>
            {when ? `  ${when}` : ""}
            {channelName ? ` · in #${channelName}` : ""}
          </Text>
          {parsed && !parsed.empty ? (
            <MessageMarkdown
              parsed={parsed}
              style={styles.body}
              onLongPress={onLongPress}
            />
          ) : null}
          {forwarded.gif ? (
            <MessageGifImage gif={forwarded.gif} onLongPress={onLongPress} />
          ) : null}
          {files ? <Text style={styles.meta}>{files}</Text> : null}
        </>
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    block: {
      alignSelf: "stretch",
      marginTop: tokens.spacing.xs,
      backgroundColor: tokens.color.surface.popover,
      borderRadius: tokens.radius.chip,
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.border.control,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    author: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    placeholder: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: italicFontFamilyFor(400),
      color: tokens.color.text.mutedForeground,
    },
  });
}
