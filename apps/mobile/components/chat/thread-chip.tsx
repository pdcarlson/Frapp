import { Pressable, StyleSheet, Text, View } from "react-native";
import { threadChipLabel } from "@repo/chat-core/threads";
import type { ThreadSummary } from "@repo/chat-core/types";
import { memberAvatarHue, memberAvatarTint, useNow } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { MemberAvatar } from "@/components/member-avatar";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/chat/display-name";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/** The repliers' faces in the chip: small, overlapping. */
const CHIP_AVATAR_SIZE = 20;

export interface ThreadChipProps {
  summary: ThreadSummary;
  nameFor: (userId: string) => string | null;
  /** A replier's top role color, which picks their initials paint (#3860). */
  roleColorFor?: (userId: string) => string | null;
  /** Opens the thread. Omit and the chip is a plain label. */
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
 * Under a message that has thread replies (#3785, `spec/behavior/chat/README.md`
 * § Message threads): up to three repliers, "N replies" in the chapter accent
 * and "last reply 5m ago". A tap pushes the thread. Web's
 * `apps/web/components/chat/thread-chip.tsx` became a card with a connector
 * and "N new" in #4297; this one follows in that issue's mobile slice. The
 * words are chat-core's `threadChipLabel`, so the two read the same.
 */
export function ThreadChip({
  summary,
  nameFor,
  roleColorFor,
  onPress,
  align = "start",
  onImportantRow = false,
}: ThreadChipProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  // The app's one shared clock, so every chip ticks together.
  const now = useNow();
  const { replies, lastReply } = threadChipLabel(
    summary.reply_count,
    summary.last_reply_at,
    now,
  );
  const label = `${replies}${lastReply ? `, ${lastReply}` : ""}`;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={onPress ? `${label}. Open thread` : label}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
      testID="thread-chip"
      style={({ pressed }) => [
        styles.chip,
        align === "end" ? styles.end : null,
        pressed ? { backgroundColor: brand.accentSubtle } : null,
      ]}
    >
      {summary.recent_sender_ids.length > 0 ? (
        <View style={styles.faces}>
          {summary.recent_sender_ids.slice(0, 3).map((id, index) => (
            <MemberAvatar
              key={id}
              // Initials, as web's chip draws them: three photos loading
              // under every parent would cost more than they say.
              uri={null}
              initials={initialsFor(nameFor(id) ?? "?")}
              size={CHIP_AVATAR_SIZE}
              tint={memberAvatarTint(memberAvatarHue(id, roleColorFor?.(id)))}
              style={[styles.face, index > 0 ? styles.faceOverlap : null]}
              textStyle={styles.faceText}
            />
          ))}
        </View>
      ) : null}
      <Text
        style={[
          styles.replies,
          {
            color: onImportantRow ? tokens.color.text.foreground : brand.accent,
          },
        ]}
      >
        {replies}
      </Text>
      {lastReply ? (
        <Text style={styles.lastReply} numberOfLines={1}>
          {`· ${lastReply}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.xs,
      paddingVertical: 2,
      borderRadius: tokens.radius.chip,
    },
    end: {
      alignSelf: "flex-end",
    },
    faces: {
      flexDirection: "row",
    },
    face: {
      width: CHIP_AVATAR_SIZE,
      height: CHIP_AVATAR_SIZE,
      borderRadius: avatarRadius(CHIP_AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.surface.background,
      alignItems: "center",
      justifyContent: "center",
    },
    faceOverlap: {
      marginLeft: -6,
    },
    // Initials at caption, the smallest role, as the run's avatar draws them.
    faceText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    replies: {
      ...typeRole(tokens.typography.role.label),
    },
    lastReply: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      flexShrink: 1,
    },
  });
}
