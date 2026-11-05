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
 * **Loading reserves a photo's room.** While the files are read, each one
 * draws a bare tile where a preview goes, as tall as an unsized preview
 * (`PREVIEW_FALLBACK_HEIGHT`), rather than a one-line caption that a photo up
 * to 240pt tall then replaced, pushing the thread with every one that landed
 * (components.md §10: the skeleton mirrors the layout it becomes).
 *
 * The count is all the row knows yet, not which files are photos: the message
 * carries only `metadata.attachment_count`, and type, name and dimensions
 * arrive with this query. So the tile is a bet, and it is placed on photos.
 * Mobile's composer attaches only photos; web's attaches photos and documents
 * (a PDF, say), and a document resolves to a one-line file row, so a web-sent
 * document shrinks by about 150pt when it lands. A file-row-height placeholder
 * would only move that jump onto every photo, which is the commoner case, and
 * grow it, as a photo can be up to 240pt.
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

  if (count === 0) return null;

  if (query.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={
          count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`
        }
        style={styles.list}
      >
        {Array.from({ length: count }, (_, index) => (
          <View
            key={index}
            testID="attachment-loading-tile"
            style={styles.imageRow}
          >
            <View style={styles.loadingTile} />
          </View>
        ))}
      </View>
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
        const aspect =
          attachment.width && attachment.height
            ? attachment.width / attachment.height
            : null;
        // A portrait photo takes the height cap and its own width, and the
        // row hugs it, so the rounded corners land on the photo rather than
        // on the empty sides `contain` would leave across the full width.
        const portrait = isImage && aspect !== null && aspect < 1;
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
            // A photo draws bare at the media radius; the framed row is for
            // files (components.md § Chrome weight).
            style={
              isImage
                ? [styles.imageRow, portrait ? styles.imageRowHug : null]
                : styles.row
            }
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
                  aspect === null
                    ? [
                        styles.preview,
                        styles.previewFull,
                        styles.previewUnsized,
                      ]
                    : portrait
                      ? [
                          styles.preview,
                          styles.previewPortrait,
                          { aspectRatio: aspect },
                        ]
                      : [
                          styles.preview,
                          styles.previewFull,
                          { aspectRatio: aspect },
                        ]
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

/**
 * An image preview's height when the attachment stores no dimensions, and the
 * loading tile's, so a photo replaces a box of its own likely size.
 */
const PREVIEW_FALLBACK_HEIGHT = 180;

/** The tallest a preview draws, matching web's `max-h-64`. */
const PREVIEW_MAX_HEIGHT = 240;

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
    imageRow: {
      alignSelf: "stretch",
      borderRadius: tokens.radius.control,
      overflow: "hidden",
    },
    imageRowHug: {
      alignSelf: "flex-start",
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
      // Capped, matching web's `max-h-64`. Without it a tall screenshot — a
      // 400x2000 phone capture is the ordinary case — derives its height from
      // the aspect ratio and renders many times the column's width, pushing the
      // rest of the thread off screen. `contain` letterboxes inside the cap
      // rather than distorting.
      maxHeight: PREVIEW_MAX_HEIGHT,
      borderRadius: tokens.radius.control,
    },
    // Width follows from the cap and the aspect ratio, so a portrait photo is
    // never letterboxed.
    previewPortrait: {
      height: PREVIEW_MAX_HEIGHT,
      maxWidth: "100%",
    },
    previewFull: {
      width: "100%",
    },
    previewUnsized: {
      height: PREVIEW_FALLBACK_HEIGHT,
    },
    // A preview's block, bare like the photo it stands in for, in the
    // skeleton's neutral elevated fill (components.md §10: neutral only).
    loadingTile: {
      height: PREVIEW_FALLBACK_HEIGHT,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.popover,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      marginTop: tokens.spacing.xs,
    },
  });
}
