import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ACTIVITY_GLYPH_NAV,
  ACTIVITY_SECTION_NAMES,
  type ActivityReview,
  type ActivityRow,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import type { SignetTokens } from "@repo/theme/signet";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { PressableRow } from "@/components/list-section";
import { NavGlyph } from "@/components/nav-glyph";
import { AccentChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  ActivityRowItem,
  type ActivityRowActions,
} from "./activity-row-action";

/** A queue this short is drawn open; a longer one opens on a press. */
const REVIEW_OPEN_LIMIT = 3;
/** How many rows the open card draws before "Show all". */
const REVIEW_ROW_LIMIT = 5;

/**
 * "To review" on the phone's Activity (#4766): what waits on an officer's
 * sign-off (finished tasks to confirm, service hours to approve) as one card
 * with one count, where two count tiles and a run of rows mixed into the
 * member's own list were. Google Classroom gives a teacher one "To review"
 * apart from their own to-dos; so does this. The week ring never counts
 * these: reviewing is the officer's queue, not their week.
 *
 * Closed, it is one row: the count and what it is made of. Pressed, it opens
 * in place to the rows, longest waiting first, each with its one-press
 * Confirm or Approve (#4437) and its sheet behind the rest of the row. A
 * queue of three or fewer starts open, so a chair's two confirmations are
 * still one press each; the president's fourteen wait behind the count. The
 * screen draws it only when something waits or a part behind it failed to
 * load (`activityReview` returns `null` otherwise), so a member, and an
 * officer with an empty queue, sees no card and no zero.
 */
export function ReviewCard({
  review,
  rowActions,
  onOpen,
}: {
  review: ActivityReview;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  // A short queue is open from the start, so its one-press Confirm stays
  // one press; a long one waits behind its count. A press either way sticks.
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? review.rows.length <= REVIEW_OPEN_LIMIT;
  const [all, setAll] = useState(false);
  const cappable = review.rows.length > REVIEW_ROW_LIMIT;
  const rows =
    cappable && !all ? review.rows.slice(0, REVIEW_ROW_LIMIT) : review.rows;
  const failed =
    review.unavailable.length > 0
      ? `Couldn't load ${review.unavailable
          .map((section) => ACTIVITY_SECTION_NAMES[section])
          .join(", ")}. Pull down to try again.`
      : null;
  return (
    <View style={styles.card} testID="activity-review-card">
      <PressableRow
        accessibilityRole="button"
        accessibilityLabel={`To review, ${review.count}`}
        accessibilityHint={review.detail || undefined}
        accessibilityState={{ expanded: open }}
        disabled={review.rows.length === 0}
        onPress={() => setPicked(!open)}
        onCard
        testID="activity-review-toggle"
        style={styles.head}
      >
        <LeadTile size="lead" on="card">
          <NavGlyph
            paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV.confirm]}
            color={tokens.color.text.mutedForeground}
            size={LEAD_TILE_GLYPH}
          />
        </LeadTile>
        <View style={styles.text}>
          <Text style={styles.title}>To review</Text>
          {review.detail ? (
            <Text numberOfLines={2} style={styles.detail}>
              {review.detail}
            </Text>
          ) : null}
        </View>
        {review.rows.length > 0 ? (
          <>
            <AccentChip label={review.count} />
            <DisclosureGlyph
              color={tokens.color.text.muted}
              direction={open ? "down" : "right"}
            />
          </>
        ) : null}
      </PressableRow>
      {failed ? <Text style={styles.warning}>{failed}</Text> : null}
      {open && rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            <ActivityRowItem
              key={row.key}
              row={row}
              // Every row, the first too, is ruled off from what is above it.
              isFirst={false}
              onCard
              actions={rowActions}
              onPress={() => onOpen(row)}
            />
          ))}
          {cappable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: all }}
              onPress={() => setAll((shown) => !shown)}
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: accent }]}>
                {all ? "Show fewer" : `Show all ${review.count}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
      overflow: "hidden",
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
    },
    text: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    warning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.md,
    },
    rows: {
      paddingHorizontal: tokens.spacing.lg,
    },
    // The touch floor, with the text on the card's padding line.
    showAll: {
      alignSelf: "flex-start",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    showAllText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
