import { StyleSheet, Text, View } from "react-native";
import {
  channelStartCopy,
  isSystemChannel,
  type ChannelStartType,
} from "@repo/hooks/channel-start";
import { SignetTokens } from "@repo/theme/signet";
import { isDirectChannel } from "@repo/validation";
import type { MemberAvatarTint } from "@repo/hooks";
import { MemberAvatar } from "@/components/member-avatar";
import { AuditGlyph } from "@/components/chat/card-glyphs";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/chat/display-name";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

const KNOWN_TYPES: readonly ChannelStartType[] = [
  "PUBLIC",
  "PRIVATE",
  "ROLE_GATED",
  "DM",
  "GROUP_DM",
];

function startType(type: string): ChannelStartType {
  return (KNOWN_TYPES as readonly string[]).includes(type)
    ? (type as ChannelStartType)
    : "PUBLIC";
}

/**
 * The start of a channel's history in the s05 thread (`writing.md` § Chat
 * (dashboard), Channel start), the same words web draws from `@repo/hooks/channel-start`.
 *
 * Not an empty state. An empty channel draws it at the bottom, where its first
 * message will land, and a channel with history draws it above the oldest
 * message once nothing earlier is left to load (`ThreadHistoryEdge`).
 *
 * The mark is a `#` for a channel and the audit shield for `#chapter-audit`.
 * A direct message takes the same mark its channel-list row draws (the other
 * member's photo, else their initials: `channel-row.tsx`), so one
 * conversation has one mark.
 * Mobile has no Chat admin, so there is no Edit channel here.
 */
export function ChannelStart({
  type,
  channelName,
  displayName,
  description,
  photoUrl = null,
  photoTint = null,
}: {
  /** The channel's `type` as the row carries it. */
  type: string;
  /** The channel's own name, which picks the audit mark. */
  channelName: string;
  /** The name the header shows, without `#`; a DM's is the other member. */
  displayName: string;
  description?: string | null;
  /** A 1:1 DM's other member's photo, drawn over their initials. */
  photoUrl?: string | null;
  /** A 1:1 DM's other member's initials paint (#3860). */
  photoTint?: MemberAvatarTint | null;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const kind = startType(type);
  const copy = channelStartCopy({ type: kind, name: displayName, description });
  const isDirect = isDirectChannel({ type: kind });

  return (
    <View style={styles.block} accessibilityRole="summary">
      <View
        style={styles.tile}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {isSystemChannel({ name: channelName }) && !isDirect ? (
          <AuditGlyph
            focused
            accent={brand.accent}
            muted={brand.accent}
            size={32}
          />
        ) : isDirect ? (
          <MemberAvatar
            uri={photoUrl}
            tint={photoTint}
            initials={initialsFor(displayName)}
            size={START_TILE_SIZE}
            style={styles.photoTile}
            textStyle={styles.mark}
          />
        ) : (
          <Text style={styles.mark}>#</Text>
        )}
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text style={styles.startLine}>{copy.startLine}</Text>
      {copy.description ? (
        <Text style={styles.description}>{copy.description}</Text>
      ) : null}
    </View>
  );
}

const START_TILE_SIZE = 64;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    block: {
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing["2xl"],
      paddingBottom: tokens.spacing.lg,
    },
    tile: {
      width: START_TILE_SIZE,
      height: START_TILE_SIZE,
      borderRadius: tokens.radius.cardLarge,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tint(brand.accent),
      marginBottom: tokens.spacing.xs,
    },
    // The DM mark fills the tile; the tile's own corners and fill carry over.
    photoTile: {
      width: START_TILE_SIZE,
      height: START_TILE_SIZE,
      borderRadius: tokens.radius.cardLarge,
      alignItems: "center",
      justifyContent: "center",
    },
    mark: {
      fontSize: 30,
      fontWeight: "700",
      color: brand.accent,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    startLine: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
