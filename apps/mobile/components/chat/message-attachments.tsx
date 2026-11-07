import { useState, type ComponentProps } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useOpenImageViewer, viewerImages } from "./image-viewer";
import {
  attachmentMatchKey,
  localPhotosFor,
  type LocalPhoto,
} from "@/lib/chat/local-photos";

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
 * to 256pt tall then replaced, pushing the thread with every one that landed
 * (components.md §10: the skeleton mirrors the layout it becomes).
 *
 * The count is all the row knows yet, not which files are photos: the message
 * carries only `metadata.attachment_count`, and type, name and dimensions
 * arrive with this query. So the tile is a bet, and it is placed on photos.
 * Mobile's composer attaches only photos; web's attaches photos and documents
 * (a PDF, say), and a document resolves to a one-line file row, so a web-sent
 * document shrinks by about 150pt when it lands. A file-row-height placeholder
 * would only move that jump onto every photo, which is the commoner case, and
 * grow it, as a photo can be up to 256pt.
 *
 * An image opens the thread's image viewer, stepping through the
 * message's other images (#2874). Any other file, and an image outside a
 * screen that hosts a viewer, opens through the signed URL in the browser.
 *
 * **Two or more photos draw as one grid**, two across in squares, the fourth
 * carrying "+N" when there are more, as iMessage and Discord do. A batch of
 * six photos from a formal is one block in the thread, not six screens of it.
 *
 * **The sender's own photos come from the phone** (`lib/chat/local-photos.ts`).
 * While the message is still sending there is no server row to read, so the
 * pictures the member picked draw at once, at their real shape; once it is
 * confirmed, each server row that matches a local photo still draws the local
 * file in the thread, so the sender's thread never downloads back what they
 * just uploaded (the full-screen viewer still reads the server copy).
 */
export interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
  /** The row's `client_message_id`, which finds the sender's local photos. */
  clientMessageId?: string | null;
  /**
   * False while the message is still sending: there is no server row to read
   * yet, so nothing is fetched and the local photos (if any) draw alone.
   */
  confirmed?: boolean;
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
  clientMessageId,
  confirmed = true,
  onLongPress,
}: MessageAttachmentsProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const query = useMessageAttachments(
    channelId,
    messageId,
    count > 0 && confirmed,
  );
  const local = localPhotosFor(clientMessageId);
  const localPhotos = local && local.length === count ? local : undefined;
  const openViewer = useOpenImageViewer();
  const [openFailed, setOpenFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  if (count === 0) return null;

  if ((!confirmed || query.isPending) && localPhotos) {
    return (
      <View style={styles.list}>
        <PhotoLayout
          photos={localPhotos.map((photo, index) => ({
            key: String(index),
            uri: photo.uri,
            width: photo.width,
            height: photo.height,
            label: `Photo ${index + 1}`,
          }))}
          onLongPress={onLongPress}
          styles={styles}
        />
      </View>
    );
  }

  if (!confirmed) return null;

  if (query.isPending) {
    // Two or more files are bet to be photos, drawn as the grid they become
    // (components.md §10: the skeleton mirrors the layout it becomes).
    const tiles = Math.min(count, GRID_MAX_TILES);
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={
          count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`
        }
        style={styles.list}
      >
        {count === 1 ? (
          <View testID="attachment-loading-tile" style={styles.imageRow}>
            <View style={styles.loadingTile} />
          </View>
        ) : (
          <View style={styles.grid}>
            {Array.from({ length: tiles }, (_, index) => (
              <View
                key={index}
                testID="attachment-loading-tile"
                style={[
                  styles.tile,
                  tiles === 3 && index === 2 ? styles.tileWide : null,
                ]}
              />
            ))}
          </View>
        )}
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
  const localByMatch = new Map<string, LocalPhoto>();
  for (const photo of localPhotos ?? []) {
    if (photo.match) localByMatch.set(photo.match, photo);
  }
  const images = query.data
    .filter((attachment) => imageIds.has(attachment.id))
    .map<GridPhoto>((attachment) => {
      const mine = localByMatch.get(
        attachmentMatchKey(attachment.filename, attachment.byte_size),
      );
      return {
        key: attachment.id,
        uri: mine?.uri ?? attachment.download_url,
        fallbackUri: mine ? attachment.download_url : undefined,
        width: mine?.width ?? attachment.width ?? null,
        height: mine?.height ?? attachment.height ?? null,
        label: attachment.filename,
        verb: openViewer ? "View" : "Open",
        onPress: openViewer
          ? () => openViewer({ channelId, messageId, imageId: attachment.id })
          : () => void open(attachment.id, attachment.download_url),
      };
    });
  const files = query.data.filter((attachment) => !imageIds.has(attachment.id));

  return (
    <View style={styles.list}>
      {images.length > 0 ? (
        <PhotoLayout
          photos={images}
          onLongPress={onLongPress}
          styles={styles}
        />
      ) : null}
      {files.map((attachment) => (
        <Pressable
          key={attachment.id}
          accessibilityRole="button"
          // The filename alone would read as a label with no verb; the row is
          // the only way to reach the file, so it says so.
          accessibilityLabel={`Open ${attachment.filename}`}
          onPress={() => void open(attachment.id, attachment.download_url)}
          onLongPress={onLongPress}
          // The framed row is for files; a photo draws bare at the media
          // radius (components.md § Chrome weight).
          style={styles.row}
        >
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

/** One picture in a message, from the phone or from storage. */
interface GridPhoto {
  key: string;
  uri: string;
  /** The server copy, tried when a local file is gone (the OS cleaned it up). */
  fallbackUri?: string;
  width: number | null;
  height: number | null;
  label: string;
  /** "View" in the thread's viewer, "Open" in the browser. */
  verb?: "View" | "Open";
  /** Omitted while the message is still sending: nothing to open yet. */
  onPress?: () => void;
}

/** How many tiles a grid draws before the last one says "+N". */
const GRID_MAX_TILES = 4;

function PhotoLayout({
  photos,
  onLongPress,
  styles,
}: {
  photos: GridPhoto[];
  onLongPress?: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  if (photos.length === 1) {
    const photo = photos[0]!;
    const aspect =
      photo.width && photo.height ? photo.width / photo.height : null;
    // A sized photo's row is the photo's own box: full column width at its
    // aspect ratio, narrowed to the width at which it reaches the height cap.
    // The row hugs the picture at every shape, so `contain` never leaves
    // empty sides and the rounded corners land on the photo.
    return (
      <Pressable
        accessibilityRole={photo.onPress ? "button" : "image"}
        accessibilityLabel={
          photo.onPress ? `${photo.verb ?? "View"} ${photo.label}` : photo.label
        }
        disabled={!photo.onPress}
        onPress={photo.onPress}
        onLongPress={onLongPress}
        style={
          aspect !== null
            ? [
                styles.imageRow,
                styles.imageRowSized,
                { maxWidth: PREVIEW_MAX_HEIGHT * aspect, aspectRatio: aspect },
              ]
            : styles.imageRow
        }
      >
        <PhotoImage
          photo={photo}
          // Sized from the stored dimensions when they exist so the row does
          // not jump when the image lands; otherwise a fixed height.
          style={
            aspect !== null
              ? [styles.preview, styles.previewFill]
              : [styles.preview, styles.previewFull, styles.previewUnsized]
          }
          resizeMode="contain"
        />
      </Pressable>
    );
  }

  const shown = photos.slice(0, GRID_MAX_TILES);
  const hidden = photos.length - shown.length;
  return (
    <View style={styles.grid}>
      {shown.map((photo, index) => {
        const more = index === shown.length - 1 && hidden > 0 ? hidden : 0;
        return (
          <Pressable
            key={photo.key}
            accessibilityRole={photo.onPress ? "button" : "image"}
            accessibilityLabel={
              more > 0
                ? `View ${photos.length} photos`
                : photo.onPress
                  ? `${photo.verb ?? "View"} ${photo.label}`
                  : photo.label
            }
            disabled={!photo.onPress}
            onPress={photo.onPress}
            onLongPress={onLongPress}
            style={[
              styles.tile,
              // Three photos: the third spans the row, as iMessage lays them.
              shown.length === 3 && index === 2 ? styles.tileWide : null,
            ]}
          >
            <PhotoImage
              photo={photo}
              style={styles.previewFill}
              resizeMode="cover"
            />
            {more > 0 ? (
              <View style={styles.tileMore}>
                <Text style={styles.tileMoreText}>+{more}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** An image that falls back to the server copy when the local file is gone. */
function PhotoImage({
  photo,
  style,
  resizeMode,
}: {
  photo: GridPhoto;
  style: ComponentProps<typeof Image>["style"];
  resizeMode: "contain" | "cover";
}) {
  const [failedLocal, setFailedLocal] = useState(false);
  const uri = failedLocal && photo.fallbackUri ? photo.fallbackUri : photo.uri;
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      resizeMode={resizeMode}
      onError={() => {
        if (photo.fallbackUri) setFailedLocal(true);
      }}
      style={style}
    />
  );
}

/**
 * An image preview's height when the attachment stores no dimensions, and the
 * loading tile's, so a photo replaces a box of its own likely size.
 */
const PREVIEW_FALLBACK_HEIGHT = 180;

/** The tallest a preview draws: web's `max-h-64`, 256px. */
const PREVIEW_MAX_HEIGHT = 256;

/** A grid's width: two 128pt squares and the gap, so a row is half a single photo's height cap. */
const GRID_GAP = 2;
const GRID_MAX_WIDTH = 258;

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
    // Two across, squares, a hairline apart: the grid reads as one picture
    // block, capped at the single photo's height budget per row.
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: GRID_GAP,
      maxWidth: GRID_MAX_WIDTH,
      borderRadius: tokens.radius.control,
      overflow: "hidden",
    },
    tile: {
      width: (GRID_MAX_WIDTH - GRID_GAP) / 2,
      aspectRatio: 1,
      backgroundColor: tokens.color.surface.popover,
    },
    tileWide: {
      width: GRID_MAX_WIDTH,
      aspectRatio: 2,
    },
    // Photo-overlay ink, fixed in both themes: it sits on the picture.
    tileMore: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    tileMoreText: {
      ...typeRole({
        ...tokens.typography.role.title,
        weight: tokens.typography.weight.semibold,
      }),
      color: "#FFFFFF",
    },
    imageRow: {
      alignSelf: "stretch",
      borderRadius: tokens.radius.control,
      overflow: "hidden",
    },
    // Its width, max width and aspect ratio come from the photo (above).
    imageRowSized: {
      alignSelf: "flex-start",
      width: "100%",
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
      // Capped, matching web's `max-h-64`. Without it a tall screenshot (a
      // 400x2000 phone capture is the ordinary case) would derive its height
      // from the aspect ratio and render many times the column's width,
      // pushing the rest of the thread off screen. A sized photo's row already
      // stops at the cap; an unsized one letterboxes inside it rather than
      // distorting.
      maxHeight: PREVIEW_MAX_HEIGHT,
      borderRadius: tokens.radius.control,
    },
    previewFill: {
      width: "100%",
      height: "100%",
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
