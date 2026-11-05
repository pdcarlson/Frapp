import { StyleSheet, Text, View } from "react-native";
import {
  channelStartCopy,
  type ChannelStartType,
} from "@repo/hooks/channel-start";
import { SignetTokens } from "@repo/theme/signet";
import { AuditGlyph } from "@/components/chat/card-glyphs";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";
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
 * The start of a channel's history in the s05 thread (`writing.md` § Chat,
 * Channel start), the same words web draws from `@repo/hooks/channel-start`.
 *
 * Not an empty state. An empty channel draws it at the bottom, where its first
 * message will land, and a channel with history draws it above the oldest
 * message once nothing earlier is left to load (`ThreadHistoryEdge`).
 *
 * The mark follows the channel list (`channel-row.tsx`): a `#` for a channel,
 * the audit shield for `#chapter-audit`, and the other member's initial for a
 * direct message. Mobile has no Chat admin, so there is no Edit channel here.
 */
export function ChannelStart({
  type,
  channelName,
  displayName,
  description,
}: {
  /** The channel's `type` as the row carries it. */
  type: string;
  /** The channel's own name, which picks the audit mark. */
  channelName: string;
  /** The name the header shows, without `#`; a DM's is the other member. */
  displayName: string;
  description?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const kind = startType(type);
  const copy = channelStartCopy({ type: kind, name: displayName, description });
  const isDirect = kind === "DM" || kind === "GROUP_DM";

  return (
    <View style={styles.block} accessibilityRole="summary">
      <View
        style={styles.tile}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {channelName === "chapter-audit" && !isDirect ? (
          <AuditGlyph
            focused
            accent={brand.accent}
            muted={brand.accent}
            size={32}
          />
        ) : (
          <Text style={styles.mark}>
            {isDirect ? displayName.trim().charAt(0).toUpperCase() || "#" : "#"}
          </Text>
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
      width: 64,
      height: 64,
      borderRadius: tokens.radius.cardLarge,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tint(brand.accent),
      marginBottom: tokens.spacing.xs,
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
