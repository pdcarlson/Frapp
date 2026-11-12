import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  threadCardLabel,
  threadChipLabel,
  threadPreviewParts,
} from "@repo/chat-core/threads";
import type { ThreadLastReply, ThreadSummary } from "@repo/chat-core/types";
import {
  authorInitialsFallback,
  memberAvatarHue,
  memberAvatarTint,
  resolveAuthorLabel,
  resolveAuthorName,
  useNow,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { MemberAvatar } from "@/components/member-avatar";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/chat/display-name";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/** The repliers' faces on the card, side by side (web's 24px). */
const FACE_SIZE = 24;
/** The latest replier's face on the preview line: the faces' size, which the smallest type role's initials fit. */
const PREVIEW_FACE_SIZE = 24;
/** One caption line, the box "last reply" wraps out of when it can't fit. */
const CAPTION_LINE = 18;
/**
 * The preview line's cap, a fixed width like web's 24rem: a long reply stops
 * there rather than stretching the card across the column.
 */
const PREVIEW_MAX_WIDTH = 384;
/**
 * Half the card's height, where the cozy connector meets its edge
 * (`MessageItem`'s `threadSpine`): one 24pt row inside 6pt padding and a
 * hairline, and the preview line's 24 and its 4pt gap below that.
 */
export function threadCardMiddle(hasPreview: boolean): number {
  const height =
    1 + 6 + FACE_SIZE + (hasPreview ? 4 + PREVIEW_FACE_SIZE : 0) + 6 + 1;
  return height / 2;
}

export interface ThreadChipProps {
  summary: ThreadSummary;
  nameFor: (userId: string) => string | null;
  /** A replier's top role color, which picks their initials paint (#3860). */
  roleColorFor?: (userId: string) => string | null;
  /** A replier's photo, when they have one; initials otherwise. */
  avatarFor?: (userId: string) => string | null;
  /** Replies new to the viewer, from the threads they follow (#4297). */
  unread?: number;
  /**
   * The latest reply to preview, already cleared against the viewer's block
   * list (`threadPreviewVisible`); `null` draws no preview line.
   */
  preview?: ThreadLastReply | null;
  /** Whose reply reads "You". */
  viewerId?: string | null;
  /** Opens the thread. Omit and the card is a plain label. */
  onPress?: () => void;
  /** Which side it hugs: Bubbles puts the viewer's own on the right. */
  align?: "start" | "end";
  /**
   * The row is flagged Important (#3921): the count draws in the foreground
   * tone, since the chapter accent misses AA on the danger tint for most
   * seeds (components.md § A flagged row).
   */
  onImportantRow?: boolean;
}

/**
 * The thread card under a message that has thread replies (#3785, a card
 * since #4297, as web's `apps/web/components/chat/thread-chip.tsx`): the
 * repliers' faces side by side, "N replies" in the chapter accent, "● 2 new"
 * when the viewer follows the thread and has unread replies, "last reply 5m
 * ago" and a chevron, then a line previewing the latest reply (its replier's
 * face, first name and words). A tap pushes the thread. In cozy a connector
 * runs to it from the author's photo (`MessageItem`).
 *
 * On a narrow card "last reply" drops out whole first (measured, since React
 * Native can't keep text from wrapping), then the faces one at a time, each
 * wrapping onto a clipped second line; the count, "new" and the chevron always
 * show. The words are chat-core's `threadChipLabel`, `threadPreviewParts` and
 * `threadCardLabel`, which web's card reads too, so the two read alike.
 */
export function ThreadChip({
  summary,
  nameFor,
  roleColorFor,
  avatarFor,
  unread = 0,
  preview = null,
  viewerId = null,
  onPress,
  align = "start",
  onImportantRow = false,
}: ThreadChipProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  // The app's one shared clock, so every card ticks together.
  const now = useNow();
  const { replies, lastReply } = threadChipLabel(
    summary.reply_count,
    summary.last_reply_at,
    now,
  );
  const fresh = unread > 0 ? `${unread} new` : null;

  const previewSender = preview?.sender_id ?? null;
  // Named as the timeline names an author, by the rule web's card shares.
  const parts = preview
    ? threadPreviewParts(preview, viewerId, {
        nameOf: (id) =>
          resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
        fallbackLabel: (id) =>
          resolveAuthorLabel(
            { sender_id: id, author_name: null },
            nameFor,
            null,
          ),
      })
    : null;
  const label = threadCardLabel({ replies, fresh, lastReply, preview: parts });

  // "last reply 5m ago" shows whole or not at all. React Native has no
  // no-wrap for text, so its natural width is measured off screen and the
  // phrase draws only where its box has that much room; the box gives way
  // first when the row is short.
  const [lastReplyWidth, setLastReplyWidth] = useState(0);
  const [lastReplyRoom, setLastReplyRoom] = useState(0);
  const lastReplyFits =
    lastReplyWidth > 0 && lastReplyRoom >= lastReplyWidth - 0.5;

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={onPress ? `${label}. Open thread` : label}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
      testID="thread-chip"
      style={({ pressed }) => [
        styles.card,
        align === "end" ? styles.end : null,
        pressed ? { backgroundColor: tokens.color.surface.popover } : null,
      ]}
    >
      <View style={styles.row}>
        {summary.recent_sender_ids.length > 0 ? (
          <View style={styles.faces}>
            <View style={styles.lead} />
            {summary.recent_sender_ids.slice(0, 3).map((id) => (
              <MemberAvatar
                key={id}
                uri={avatarFor?.(id) ?? null}
                initials={initialsFor(nameFor(id) ?? "?")}
                size={FACE_SIZE}
                tint={memberAvatarTint(
                  memberAvatarHue(id, roleColorFor?.(id) ?? null),
                )}
                style={styles.face}
                textStyle={styles.faceText}
              />
            ))}
          </View>
        ) : null}
        <Text
          style={[
            styles.replies,
            {
              color: onImportantRow
                ? tokens.color.text.foreground
                : brand.accent,
            },
          ]}
        >
          {replies}
        </Text>
        {fresh ? (
          <View style={styles.fresh} testID="thread-unread">
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: onImportantRow
                    ? tokens.color.text.foreground
                    : brand.accent,
                },
              ]}
            />
            <Text style={styles.freshText}>{fresh}</Text>
          </View>
        ) : null}
        {lastReply ? (
          <View
            style={[
              styles.lastReplyBox,
              lastReplyWidth > 0 ? { width: lastReplyWidth } : null,
            ]}
            onLayout={(event) =>
              setLastReplyRoom(event.nativeEvent.layout.width)
            }
          >
            {/* Off screen in a wide box, so it measures at its full width. */}
            <View style={styles.measure} pointerEvents="none">
              <Text
                style={styles.lastReply}
                onLayout={(event) =>
                  setLastReplyWidth(event.nativeEvent.layout.width)
                }
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {lastReply}
              </Text>
            </View>
            {lastReplyFits ? (
              <Text style={styles.lastReply} numberOfLines={1}>
                {lastReply}
              </Text>
            ) : null}
          </View>
        ) : null}
        <DisclosureGlyph
          color={tokens.color.text.mutedForeground}
          size={14}
          direction="right"
        />
      </View>
      {preview ? (
        <View style={styles.preview} testID="thread-preview">
          {previewSender ? (
            <MemberAvatar
              uri={avatarFor?.(previewSender) ?? null}
              initials={
                parts?.fullName
                  ? initialsFor(parts.fullName)
                  : authorInitialsFallback({
                      sender_id: previewSender,
                      author_name: null,
                    })
              }
              size={PREVIEW_FACE_SIZE}
              tint={memberAvatarTint(
                memberAvatarHue(
                  previewSender,
                  roleColorFor?.(previewSender) ?? null,
                ),
              )}
              style={styles.previewFace}
              textStyle={styles.previewFaceText}
            />
          ) : null}
          {parts?.name ? (
            <Text style={styles.previewName} numberOfLines={1}>
              {parts.name}
            </Text>
          ) : null}
          <Text style={styles.previewText} numberOfLines={1}>
            {parts?.text}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      minWidth: 0,
      gap: tokens.spacing.xs,
      marginTop: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.card,
    },
    end: {
      alignSelf: "flex-end",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minWidth: 0,
    },
    // A clipped wrapping box: a face that doesn't fit wraps out of sight,
    // one at a time from the right, behind a zero-width lead (a line's
    // first item never wraps).
    faces: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 2,
      height: FACE_SIZE,
      overflow: "hidden",
      flexShrink: 1,
      minWidth: 0,
    },
    lead: { width: 0, height: FACE_SIZE, marginRight: -2 },
    face: {
      width: FACE_SIZE,
      height: FACE_SIZE,
      borderRadius: avatarRadius(FACE_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    // Initials at caption, the smallest role, as the run's avatar draws them.
    faceText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    replies: {
      ...typeRole(tokens.typography.role.label),
      flexShrink: 0,
    },
    fresh: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      flexShrink: 0,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    freshText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // All or nothing, measured (above): it gives way first of all.
    lastReplyBox: {
      height: CAPTION_LINE,
      overflow: "hidden",
      flexShrink: 10000,
      minWidth: 0,
    },
    measure: {
      position: "absolute",
      top: 0,
      left: 0,
      width: 1000,
      flexDirection: "row",
      opacity: 0,
    },
    lastReply: {
      ...typeRole(tokens.typography.role.caption),
      lineHeight: CAPTION_LINE,
      color: tokens.color.text.mutedForeground,
    },
    preview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: PREVIEW_MAX_WIDTH,
      minWidth: 0,
    },
    previewFace: {
      width: PREVIEW_FACE_SIZE,
      height: PREVIEW_FACE_SIZE,
      borderRadius: avatarRadius(PREVIEW_FACE_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    previewFaceText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    previewName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 0,
      maxWidth: "40%",
    },
    previewText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
      minWidth: 0,
    },
  });
}
