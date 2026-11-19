import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  meetingTypeLabel,
  type MeetingType,
} from "@repo/validation";
import { ForwardGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { PressableRow } from "@/components/list-section";
import { MinutesGlyph } from "@/components/more/more-glyphs";
import { HairlineChip, StatusChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Each meeting type's hue on the Minutes list (#5290): the chapter's own
 * accent for chapter meetings, the semantic blue and green for exec and
 * committee, neutral for anything else, so a long list reads by colour
 * before it reads by name (Paul's "colour over grey sameness"). The tile
 * says the type; its words are in the row's spoken label.
 */
export function useMeetingTypeHue(): (type: string) => string | undefined {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  return (type) =>
    type === "chapter"
      ? accent
      : type === "exec"
        ? tokens.color.semantic.info
        : type === "committee"
          ? tokens.color.semantic.success
          : undefined;
}

/** A meeting type's tile, in its hue: a row's lead, a chip's mark. */
export function MeetingTypeTile({
  type,
  size = "row",
}: {
  type: string;
  size?: "row" | "lead";
}) {
  const { tokens } = useFrappTheme();
  const hue = useMeetingTypeHue()(type);
  return (
    <LeadTile size={size} hue={hue}>
      <MinutesGlyph
        color={hue ?? tokens.color.text.mutedForeground}
        size={LEAD_TILE_GLYPH}
      />
    </LeadTile>
  );
}

/**
 * One row of the Minutes list, or of a series' list: the type's tile, the
 * title, the time on the right, and tags worked out from the minutes
 * themselves, never typed (#5291 is typed tags): Draft, Recorded, and how
 * many decisions and action items they hold.
 */
export function MinutesRow({
  title,
  type,
  otherLabel,
  time,
  draft,
  recorded,
  decisions,
  actionItems,
  byline,
  gist,
  showType = false,
  onPress,
}: {
  title: string;
  type: string;
  otherLabel: string | null;
  time: string;
  draft: boolean;
  recorded: boolean;
  decisions: number;
  actionItems: number;
  /** Someone else's draft says whose. */
  byline?: string | null;
  /** The TL;DR's first line: what happened, at a glance. */
  gist?: string | null;
  /** Say the type in words too (`showsTypeTag`). */
  showType?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const typeLabel = meetingTypeLabel(type as MeetingType, otherLabel);
  const tags = [
    showType ? typeLabel : null,
    draft ? MEETING_COPY.draftBadge : null,
    recorded ? MEETING_LIST_COPY.recorded : null,
    decisions > 0 ? MEETING_LIST_COPY.decisions(decisions) : null,
    actionItems > 0 ? MEETING_LIST_COPY.actionItems(actionItems) : null,
    byline ?? null,
  ].filter((tag): tag is string => !!tag);
  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={[
        title,
        `${typeLabel} meeting`,
        time,
        ...tags.filter((tag) => tag !== typeLabel),
        gist ?? null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      style={styles.row}
    >
      <MeetingTypeTile type={type} />
      <View style={styles.middle}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {tags.length > 0 ? (
          <View style={styles.tags}>
            {showType ? <HairlineChip label={typeLabel} /> : null}
            {draft ? (
              <StatusChip
                label={MEETING_COPY.draftBadge}
                hue={tokens.color.semantic.warning}
              />
            ) : null}
            {recorded ? (
              <StatusChip
                label={MEETING_LIST_COPY.recorded}
                hue={tokens.color.semantic.destructive}
              />
            ) : null}
            {decisions > 0 ? (
              <HairlineChip label={MEETING_LIST_COPY.decisions(decisions)} />
            ) : null}
            {actionItems > 0 ? (
              <HairlineChip
                label={MEETING_LIST_COPY.actionItems(actionItems)}
              />
            ) : null}
            {byline ? <HairlineChip label={byline} /> : null}
          </View>
        ) : null}
        {gist ? (
          <Text numberOfLines={2} style={styles.gist}>
            {gist}
          </Text>
        ) : null}
      </View>
      {time ? <Text style={styles.time}>{time}</Text> : null}
      <ForwardGlyph color={tokens.color.text.muted} size={16} />
    </PressableRow>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
    },
    middle: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
    },
    gist: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    time: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
  });
}
