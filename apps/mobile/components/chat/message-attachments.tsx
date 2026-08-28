import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Files attached to one message, in the s05 thread.
 *
 * Mirrors `apps/web/components/chat/message-attachments.tsx`. Fetched rather
 * than read off the message, because every bucket in this repo is private and a
 * download URL has to be signed per request; `count` comes from the message row,
 * so a message with no attachments never issues one.
 *
 * This replaces the "N attachments · open on web" placeholder #1228 shipped as a
 * stopgap. That line was honest but it was a dead end — a member on mobile could
 * not reach the file at all, which is what `components.md` §5 bans.
 *
 * **Callers must not mount this for a message with no attachments.** The query
 * hook reaches for `FrappClientProvider` the moment this renders, so mounting it
 * unconditionally would make every plain-text row — the overwhelming majority —
 * require a client context it has never needed. `MessageBubble` guards on
 * `attachment_count` for that reason; the check below is belt and braces.
 *
 * Loading and error states are deliberately visible, for the same reason web
 * gives: this replaced a rendering where the filename was literal text in the
 * message body, so degrading to nothing would read as data loss to anyone who
 * remembers seeing the file.
 */
export interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
  /** Self bubbles take the chapter accent, so their text colour differs. */
  isMine: boolean;
}

/** Content types rendered as an inline preview rather than a download row. */
export function isPreviewable(contentType: string | null): boolean {
  return !!contentType && contentType.startsWith("image/");
}

export function MessageAttachments({
  channelId,
  messageId,
  count,
  isMine,
}: MessageAttachmentsProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const query = useMessageAttachments(channelId, messageId, count > 0);
  const [openFailed, setOpenFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const noteStyle = isMine ? styles.noteMine : styles.noteTheirs;

  if (count === 0) return null;

  if (query.isPending) {
    return (
      <Text style={noteStyle}>
        {count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`}
      </Text>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Text style={styles.error}>
        {count === 1 ? "Attachment" : `${count} attachments`} couldn&apos;t be
        loaded.
      </Text>
    );
  }

  async function open(id: string, url: string) {
    // One at a time: iOS rejects a second presentation while one is showing,
    // which is a rejection worth not provoking rather than reporting. Same
    // guard `app/(tabs)/documents.tsx` uses for the same reason.
    if (openingId) return;
    setOpenFailed(false);
    setOpeningId(id);
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <View style={styles.list}>
      {query.data.map((attachment) => (
        <Pressable
          key={attachment.id}
          accessibilityRole="button"
          // The filename alone would read as a label with no verb; the row is
          // the only way to reach the file, so it says so.
          accessibilityLabel={`Open ${attachment.filename}`}
          onPress={() => void open(attachment.id, attachment.download_url)}
          style={styles.row}
        >
          {isPreviewable(attachment.content_type) ? (
            <Image
              source={{ uri: attachment.download_url }}
              accessibilityLabel={attachment.filename}
              resizeMode="contain"
              // Sized from the stored dimensions when they exist so the row does
              // not jump when the image lands. `chat_message_attachments` allows
              // both to be null, so a fixed height is the fallback rather than
              // an aspect ratio computed from nothing.
              style={
                attachment.width && attachment.height
                  ? [
                      styles.preview,
                      { aspectRatio: attachment.width / attachment.height },
                    ]
                  : [styles.preview, styles.previewUnsized]
              }
            />
          ) : (
            <View style={styles.fileRow}>
              <Text style={styles.filename} numberOfLines={1}>
                {attachment.filename}
              </Text>
              {attachment.byte_size != null ? (
                <Text style={styles.size}>
                  {formatBytes(attachment.byte_size)}
                </Text>
              ) : null}
            </View>
          )}
        </Pressable>
      ))}
      {openFailed ? (
        <Text style={styles.error}>
          Couldn&apos;t open that file. Try again.
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    list: {
      marginTop: tokens.spacing.xs,
      gap: tokens.spacing.xs,
    },
    row: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    filename: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    size: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
    preview: {
      width: "100%",
      borderRadius: tokens.radius.control,
    },
    previewUnsized: {
      height: 180,
    },
    // Same token pair as the body, one step quieter — a note about the message,
    // not the message.
    noteTheirs: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.xs,
    },
    noteMine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.onHouse,
      marginTop: tokens.spacing.xs,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      marginTop: tokens.spacing.xs,
    },
  });
}
