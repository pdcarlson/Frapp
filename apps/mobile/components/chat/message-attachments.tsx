import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useOpenImageViewer, viewerImages } from "./image-viewer";

/**
 * Files attached to one message, in the s05 thread.
 *
 * Mirrors `apps/web/components/chat/message-attachments.tsx`. Fetched rather
 * than read off the message, because every bucket in this repo is private and a
 * download URL has to be signed per request; `count` comes from the message row,
 * so a message with no attachments never issues one.
 *
 * This replaces the "N attachments · open on web" placeholder #1228 shipped as a
 * stopgap. That line was honest but it was a dead end: a member on mobile could
 * not reach the file at all.
 *
 * **Callers must not mount this for a message with no attachments.** The query
 * hook reaches for `FrappClientProvider` the moment this renders, so mounting it
 * unconditionally would make every plain-text row — the overwhelming majority —
 * require a client context it has never needed. `MessageItem` guards on
 * `attachment_count` for that reason; the check below is belt and braces.
 *
 * Loading and error states are deliberately visible, for the same reason web
 * gives: this replaced a rendering where the filename was literal text in the
 * message body, so degrading to nothing would read as data loss to anyone who
 * remembers seeing the file.
 *
 * An image opens the thread's image viewer, stepping through the
 * message's other images (#2874). Any other file, and an image outside a
 * screen that hosts a viewer, opens through the signed URL in the browser.
 */
export interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
  /**
   * The message's own long-press (report, block — #2257), forwarded to each
   * file. A file row is a `Pressable` that claims the touch, so without it a
   * long press on a photo would end as a tap that opens the photo, and a
   * photo-only message would have no way to reach its actions at all.
   */
  onLongPress?: () => void;
}

export function MessageAttachments({
  channelId,
  messageId,
  count,
  onLongPress,
}: MessageAttachmentsProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const query = useMessageAttachments(channelId, messageId, count > 0);
  const openViewer = useOpenImageViewer();
  const [openFailed, setOpenFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const noteStyle = styles.note;

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

  const imageIds = new Set(viewerImages(query.data).map((image) => image.id));

  return (
    <View style={styles.list}>
      {query.data.map((attachment) => {
        const isImage = imageIds.has(attachment.id);
        return (
          <Pressable
            key={attachment.id}
            accessibilityRole="button"
            // The filename alone would read as a label with no verb; the row is
            // the only way to reach the file, so it says so.
            accessibilityLabel={
              isImage && openViewer
                ? `View ${attachment.filename}`
                : `Open ${attachment.filename}`
            }
            onPress={() =>
              isImage && openViewer
                ? openViewer({ channelId, messageId, imageId: attachment.id })
                : void open(attachment.id, attachment.download_url)
            }
            onLongPress={onLongPress}
            style={styles.row}
          >
            {isImage ? (
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
        );
      })}
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
      // Capped, matching web's `max-h-64`. Without it a tall screenshot — a
      // 400x2000 phone capture is the ordinary case — derives its height from
      // the aspect ratio and renders many times the column's width, pushing the
      // rest of the thread off screen. `contain` letterboxes inside the cap
      // rather than distorting.
      maxHeight: 240,
      borderRadius: tokens.radius.control,
    },
    previewUnsized: {
      height: 180,
    },
    // Same token pair as the body, one step quieter — a note about the message,
    // not the message.
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      marginTop: tokens.spacing.xs,
    },
  });
}
