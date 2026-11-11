import { StyleSheet, Text, View } from "react-native";
import {
  ACTIVITY_GLYPH_NAV,
  activityBadgeIsAsk,
  type ActivityRow,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import {
  gutterBleed,
  listRowHint,
  PressableRow,
} from "@/components/list-section";
import { NavGlyph } from "@/components/nav-glyph";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import { StatusChip } from "@/components/status-chip";
import { activityBadgeHue } from "@/lib/activity/badge-hue";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One Activity row on the phone (#4173, step 2): its lead (the kind's glyph,
 * or an event's date), its two lines, and what it asks of the member or the
 * state it is in. Web's row (`apps/web/components/activity/activity-page.tsx`)
 * on the phone's flush list recipe: on the screen background, split by
 * hairlines, the way the phone's Events and Tasks lists draw theirs
 * (`components/events/event-rows.tsx`), not in a rounded card.
 *
 * The whole row is the one hit target. A row with no `onPress` (a backwork
 * file, which the phone has no screen for) draws the same, with no chevron.
 */
export function ActivityListRow({
  row,
  isFirst,
  onPress,
}: {
  row: ActivityRow;
  /** The first row of its run draws no hairline above it. */
  isFirst: boolean;
  onPress?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  const rowStyle = [styles.row, isFirst ? null : styles.divider];
  const content = (
    <>
      <ActivityRowLead row={row} />
      <View style={styles.text}>
        {/* Two lines, not web's one: at a phone's width one line cut most
            task names short, and the old list wrapped them in full. */}
        <Text numberOfLines={2} style={styles.title}>
          {row.title}
        </Text>
        {row.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {row.detail}
          </Text>
        ) : null}
      </View>
      {row.badge ? (
        activityBadgeIsAsk(row) ? (
          <ActivityAsk label={row.badge.label} />
        ) : (
          <StatusChip
            label={row.badge.label}
            hue={activityBadgeHue(row.badge.variant, tokens)}
          />
        )
      ) : null}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );

  if (!onPress) {
    // One element to a screen reader, as a pressable row is.
    return (
      <View
        accessible
        accessibilityLabel={row.title}
        accessibilityValue={row.badge ? { text: row.badge.label } : undefined}
        accessibilityHint={listRowHint(row.detail || null, undefined)}
        style={rowStyle}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={row.title}
      // The ask or the state is the row's value: "Vote", "Overdue".
      accessibilityValue={row.badge ? { text: row.badge.label } : undefined}
      accessibilityHint={listRowHint(row.detail || null, undefined)}
      onPress={onPress}
      style={rowStyle}
    >
      {content}
    </PressableRow>
  );
}

/**
 * What leads a row: an event's date, month over day as a calendar draws it,
 * else its kind's glyph from the shared nav set (`ACTIVITY_GLYPH_NAV`), in
 * the same 40pt tile, so a row with either is the same height. Both are
 * neutral: colour on this screen is for what asks something of the member
 * and for status, never for a kind (`components.md` §5). Decoration only:
 * the row's detail says the day in words ("Tomorrow · 7:00 PM").
 */
export function ActivityRowLead({ row }: { row: ActivityRow }) {
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  if (row.dateBlock) {
    return (
      <View
        style={[styles.lead, styles.leadDate]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="activity-date-block"
      >
        <Text style={styles.leadMonth}>{row.dateBlock.month}</Text>
        <Text style={styles.leadDay}>{row.dateBlock.day}</Text>
      </View>
    );
  }
  return (
    <View
      style={styles.lead}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`activity-glyph-${row.glyph}`}
    >
      <NavGlyph
        paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV[row.glyph]]}
        color={tokens.color.text.mutedForeground}
        size={ACTIVITY_GLYPH_SIZE}
      />
    </View>
  );
}

/** iconography.md §2's size for a list row's leading icon. */
const ACTIVITY_GLYPH_SIZE = 20;

/**
 * A badge that asks the member to act (`Vote`, `Confirm`, `Approve`,
 * `Check in`), drawn as the action the row opens rather than as a status, so
 * it reads apart from `To do` or `Required` (#4173). Web's tinted button
 * recipe: the chapter's subtle accent fill, its border and its text, since
 * the accent belongs to the one action that matters (`components.md` §3),
 * never a solid status hue (§5). It is not its own control: the whole row is
 * the hit target, and this names what the row opens to.
 */
export function ActivityAsk({ label }: { label: string }) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createActivityRowStyles(tokens);
  return (
    <View
      style={[
        styles.ask,
        { backgroundColor: accentSubtle, borderColor: accentBorder },
      ]}
    >
      <Text style={[styles.askText, { color: accent }]}>{label}</Text>
    </View>
  );
}

/** A row that hasn't loaded, on the loaded row's own frame. */
export function ActivityRowSkeleton({
  index,
  isFirst,
}: {
  index: number;
  isFirst: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  const { label, caption } = tokens.typography.role;
  return (
    <View style={[styles.row, isFirst ? null : styles.divider]}>
      <SkeletonBlock
        width={LEAD_SIZE}
        height={LEAD_SIZE}
        radius={tokens.radius.chipLarge}
      />
      <View style={styles.text}>
        <SkeletonText role={label} width={SKELETON_WIDTHS[index % 4]} />
        <SkeletonText role={caption} width="34%" />
      </View>
    </View>
  );
}

const SKELETON_WIDTHS = ["58%", "42%", "66%", "48%"] as const;

/** The lead tile: web's 40px (`h-10 w-10`). */
const LEAD_SIZE = 40;

/** The ask's height: web's `h-7`, a badge's line rather than a button's. */
const ASK_HEIGHT = 28;

function createActivityRowStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
      // Square and hairline-split, as the Events list's flat rows bleed:
      // content on the gutter line, press feedback clear of it.
      ...gutterBleed(tokens, { rounded: false }),
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    text: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    chevron: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
    lead: {
      width: LEAD_SIZE,
      height: LEAD_SIZE,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    leadDate: {
      gap: 2,
    },
    leadMonth: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      // Leading 1, as web's `leading-none`, so month and day fit the tile.
      lineHeight: tokens.typography.role.caption.size,
      textTransform: "uppercase",
      color: tokens.color.text.mutedForeground,
    },
    leadDay: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.bold,
      }),
      lineHeight: tokens.typography.role.label.size,
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    ask: {
      height: ASK_HEIGHT,
      flexShrink: 0,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
    },
    askText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
    },
  });
}
