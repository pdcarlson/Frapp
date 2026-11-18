import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { NavGlyph } from "@/components/nav-glyph";
import type { AwayRow } from "@/lib/chat/away-updates";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * "While you were away" at the top of Chat home (#5464; Paul picked the Chat
 * tab on 2026-11-18). After hours away, the few conversations that matter
 * since: a mention first, then announcements, then the busiest. Slack's
 * catch-up and Activity are the comparables.
 *
 * Show, don't write: each row is a tile in its kind's colour (mention red,
 * announcements house gold, a busy channel neutral), the channel, the real
 * last message, and a count. Pressing a row opens the channel. The card
 * leaves once every row is read, or on its close mark.
 */
export function AwayCard({
  rows,
  sinceLabel,
  onOpen,
  onClose,
}: {
  rows: readonly AwayRow[];
  sinceLabel: string;
  onOpen: (channelId: string) => void;
  onClose: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.card} testID="chat-away-card">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.eyebrow}>While you were away</Text>
          <Text numberOfLines={1} style={styles.since}>
            {sinceLabel}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={onClose}
          testID="chat-away-close"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={styles.closeMark}>×</Text>
        </Pressable>
      </View>
      {rows.map((row, index) => {
        const hue =
          row.kind === "mention"
            ? tokens.color.semantic.mention
            : row.kind === "announcement"
              ? tokens.color.gold.askText
              : undefined;
        return (
          <Pressable
            key={row.channelId}
            accessibilityRole="button"
            accessibilityLabel={`#${row.name}, ${row.count} ${
              row.kind === "mention"
                ? row.count === 1
                  ? "mention"
                  : "mentions"
                : "new"
            }`}
            onPress={() => onOpen(row.channelId)}
            testID={`chat-away-row-${row.channelId}`}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.rowRule,
              pressed && styles.pressed,
            ]}
          >
            <LeadTile size="lead" on="card" hue={hue}>
              <NavGlyph
                paths={NAV_GLYPHS.chat}
                color={hue ?? tokens.color.text.mutedForeground}
                size={LEAD_TILE_GLYPH}
              />
            </LeadTile>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.name}>
                #{row.name}
              </Text>
              {row.preview ? (
                <Text numberOfLines={1} style={styles.preview}>
                  {row.preview}
                </Text>
              ) : null}
            </View>
            <View
              style={[
                styles.badge,
                row.kind === "mention"
                  ? { backgroundColor: tokens.color.semantic.mention }
                  : row.kind === "announcement"
                    ? {
                        backgroundColor: tokens.color.gold.askFill,
                        borderColor: tokens.color.gold.askBorder,
                        borderWidth: 1,
                      }
                    : { backgroundColor: tokens.color.border.input },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  row.kind === "mention"
                    ? { color: tokens.color.semantic.mentionForeground }
                    : row.kind === "announcement"
                      ? { color: tokens.color.gold.askText }
                      : null,
                ]}
              >
                {row.count > 99 ? "99+" : row.count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingVertical: tokens.spacing.sm,
    },
    head: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    headText: { flex: 1, minWidth: 0, gap: 2 },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    since: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    close: { paddingHorizontal: tokens.spacing.xs },
    closeMark: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.mutedForeground,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      minHeight: 56,
    },
    rowRule: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    preview: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    badge: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      paddingHorizontal: 7,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      ...typeRole(tokens.typography.role.caption),
      fontWeight: "700",
      color: tokens.color.text.foreground,
    },
    pressed: { opacity: 0.7 },
  });
}
