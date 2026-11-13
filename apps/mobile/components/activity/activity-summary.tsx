import { StyleSheet, Text, View } from "react-native";
import {
  activityNeedsYouHeadline,
  activityNextUpLine,
  type ActivityFilter,
  type ActivitySummary as Summary,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { PressableRow } from "@/components/list-section";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * The top of the phone's Activity (#4173, step 2), web's `ActivitySummary` on
 * the phone: how much is waiting on the member, the next event, and a count
 * tile per kind of ask (Apple Reminders' tiles), two to a row.
 *
 * A tile sets the chip of its kind, and pressing the lit one again clears
 * it, as a chip does. A tile at zero dims rather than hides, so the tiles
 * never jump as the member clears their list; a tile whose section could not
 * be read shows a dash, never 0, and the headline never says "caught up"
 * then either (`activityNeedsYouHeadline`).
 */
export function ActivitySummary({
  summary,
  filter,
  onFilter,
}: {
  summary: Summary;
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);
  const nextLine = activityNextUpLine(summary);
  return (
    <View style={styles.summary}>
      <View style={styles.lines}>
        <Text accessibilityRole="header" style={styles.headline}>
          {activityNeedsYouHeadline(summary)}
        </Text>
        {nextLine ? <Text style={styles.next}>{nextLine}</Text> : null}
      </View>
      {summary.tiles.length > 0 ? (
        <View style={styles.tiles}>
          {pairs(summary.tiles).map((pair) => (
            <View key={pair[0].id} style={styles.tileRow}>
              {pair.map((tile) => {
                const pressed = filter === tile.filter;
                return (
                  <PressableRow
                    key={tile.id}
                    accessibilityRole="button"
                    accessibilityLabel={tile.label}
                    // A section that could not be read is unknown, never 0.
                    accessibilityValue={{ text: tile.count ?? "Couldn't load" }}
                    accessibilityState={{ selected: pressed }}
                    // A React Native view can't name a group of buttons the
                    // way web names its tile group, so each tile says what
                    // pressing it does.
                    accessibilityHint={
                      pressed
                        ? "Shows everything again."
                        : "Shows only these in the list below."
                    }
                    onPress={() => onFilter(pressed ? "all" : tile.filter)}
                    onCard
                    testID={`activity-tile-${tile.id}`}
                    style={[
                      styles.tile,
                      pressed ? { borderColor: accentBorder } : null,
                      tile.zero && !pressed ? styles.tileZero : null,
                    ]}
                  >
                    <Text style={styles.tileCount}>{tile.count ?? "–"}</Text>
                    <Text numberOfLines={1} style={styles.tileLabel}>
                      {tile.label}
                    </Text>
                  </PressableRow>
                );
              })}
              {/* A lone last tile keeps half the row, as the others do. */}
              {pair.length === 1 ? <View style={styles.tileSpacer} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The summary before the first read: the headline's line and two tiles. */
export function ActivitySummarySkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.summary}>
      <SkeletonText role={tokens.typography.role.title} width="52%" />
      <View style={styles.tileRow}>
        {[0, 1].map((index) => (
          <View key={index} style={styles.tileSpacer}>
            <SkeletonBlock
              width="100%"
              height={TILE_MIN_HEIGHT}
              radius={tokens.radius.control}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Web's `min-h-16`: the count over its label. */
const TILE_MIN_HEIGHT = 64;

/** Two tiles to a row on a phone, in the order the summary gives them. */
function pairs<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    out.push(items.slice(index, index + 2));
  }
  return out;
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    summary: {
      gap: tokens.spacing.md,
    },
    lines: {
      gap: tokens.spacing.xs,
    },
    headline: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    next: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    tiles: {
      gap: tokens.spacing.sm,
    },
    tileRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    tile: {
      flex: 1,
      minHeight: TILE_MIN_HEIGHT,
      justifyContent: "space-between",
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
    },
    tileSpacer: {
      flex: 1,
    },
    tileZero: {
      opacity: 0.6,
    },
    tileCount: {
      ...typeRole(tokens.typography.role.headline),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    tileLabel: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
  });
}
