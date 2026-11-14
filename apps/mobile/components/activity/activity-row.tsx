import { createContext, useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ACTIVITY_GLYPH_NAV,
  activityBadgeIsAsk,
  activityDetailParts,
  type ActivityFace,
  type ActivityRow,
} from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import {
  gutterBleed,
  listRowHint,
  PressableRow,
} from "@/components/list-section";
import { ForwardGlyph } from "@/components/control-glyphs";
import {
  LEAD_TILE_GLYPH,
  LEAD_TILE_SIZE,
  LeadTile,
  LeadTileSkeleton,
  leadRowStyles,
} from "@/components/lead-tile";
import { MemberAvatar } from "@/components/member-avatar";
import { NavGlyph } from "@/components/nav-glyph";
import { SkeletonText } from "@/components/state-block";
import { HairlineChip, StatusChip } from "@/components/status-chip";
import { tintedControlStyles } from "@/components/tinted-control";
import { createUnreadDotStyles } from "@/components/unread-dot";
import { activityBadgeHue } from "@/lib/activity/badge-hue";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/chat/display-name";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Resolves a row's `faceId` on the chapter roster (#4402, item 4). The screen
 * provides it from `useActivityFaces`; without a provider, and for an id
 * the roster doesn't hold (a member who left), a row leads with its glyph.
 */
export const ActivityFaces = createContext<
  (userId: string) => ActivityFace | null
>(() => null);

/**
 * One Activity row on the phone (#4173, step 2): its lead (the face of who
 * it's from, its kind's glyph, or an event's date: `ActivityRowLead`), its
 * two lines, and what it asks of the member or the
 * state it is in. Web's row (`apps/web/components/activity/activity-page.tsx`)
 * on the phone's flush list recipe: on the screen background, split by
 * hairlines, the way the phone's Events and Tasks lists draw theirs
 * (`components/events/event-rows.tsx`), not in a rounded card.
 *
 * Every row opens something. A row whose ask is one press (Confirm,
 * Approve) carries it as a button where the ask was drawn (`action`, #4437),
 * so the common case takes one tap and the rest of the row still opens the
 * sheet, as web's rows do.
 */
/** What a row's long press opens: its label, and how to open it. */
export interface ActivityRowMenu {
  label: string;
  open: () => void;
}

/**
 * The screen's long press for a row (#4982): Snooze, or nothing. Provided by
 * the Activity screen, so the week card, the To review card and every list
 * get it without threading it through each.
 */
export const ActivityRowMenuContext = createContext<
  (row: ActivityRow) => ActivityRowMenu | null
>(() => null);

export function ActivityListRow({
  row,
  isFirst,
  action = null,
  onCard = false,
  solo = false,
  onPress,
  menu = null,
}: {
  row: ActivityRow;
  /** The first row of its run draws no hairline above it. */
  isFirst: boolean;
  /** The row's ask as a button (`components/activity/activity-row-action.tsx`). */
  action?: ActivityRowActionControl | null;
  /**
   * The row sits in a card (the week card's Next row, the To review card's
   * rows; #4766): it keeps to the card's own padding rather than bleeding
   * into the screen gutter, and its press lift is the step above the card.
   */
  onCard?: boolean;
  /**
   * The row stands alone as the week card's Next row (#4766): its ask is
   * filled with the chapter accent, the one primary action on the screen
   * (`foundations.md` § Where the accent goes); its detail may take a second
   * line, since "Due in 2 hours" must not be cut; and it keeps no slot for
   * the unread dot once read, having no other row to line up with.
   */
  solo?: boolean;
  onPress: () => void;
  /**
   * What a long press does (#4982): Snooze on a row that waits, Unsnooze on
   * a snoozed one. Also offered as a named action to VoiceOver and TalkBack,
   * where a long press is out of reach.
   */
  menu?: ActivityRowMenu | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  const dotStyles = createUnreadDotStyles(tokens);
  // A poll's detail is its channel, so its poster, shown only as the face,
  // is said after the title ("…, from Olive Officer"); every other row's
  // detail already names the person.
  const faceFor = useContext(ActivityFaces);
  const poster =
    row.kind === "poll" && row.faceId ? faceFor(row.faceId)?.name : null;
  const label = poster ? `${row.title}, from ${poster}` : row.title;
  const rowStyle = [
    styles.row,
    onCard ? styles.rowOnCard : null,
    isFirst ? null : styles.divider,
  ];
  const content = (
    <>
      {/* The unread mark (#4405): the notification list's dot, in a slot of
          its own that stays when read so rows don't shift. */}
      {solo && !row.unread ? null : (
        <View
          style={row.unread ? dotStyles.dot : dotStyles.spacer}
          testID={row.unread ? "activity-unread-dot" : undefined}
        />
      )}
      <ActivityRowLead row={row} onCard={onCard} />
      <View style={styles.text}>
        {/* Two lines, not web's one: at a phone's width one line cut most
            task names short, and the old list wrapped them in full. */}
        <Text numberOfLines={2} style={styles.title}>
          {row.title}
        </Text>
        <ActivityRowDetail row={row} lines={solo ? 2 : 1} />
      </View>
      {row.badge ? (
        action ? (
          <ActivityAskButton action={action} filled={solo} />
        ) : activityBadgeIsAsk(row) ? (
          <ActivityAsk label={row.badge.label} filled={solo} />
        ) : row.badge.variant === "outline" ? (
          <HairlineChip label={row.badge.label} />
        ) : (
          <StatusChip
            label={row.badge.label}
            hue={activityBadgeHue(row.badge.variant, tokens)}
          />
        )
      ) : null}
      <ForwardGlyph color={tokens.color.text.mutedForeground} />
    </>
  );

  const accessibilityActions = [
    ...(action && !action.disabled
      ? [{ name: "rowAction", label: action.label }]
      : []),
    ...(menu ? [{ name: "rowMenu", label: menu.label }] : []),
  ];
  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={row.unread ? `Unread: ${label}` : label}
      // The ask or the state is the row's value: "Vote", "Overdue".
      accessibilityValue={row.badge ? { text: row.badge.label } : undefined}
      // Offline, why its button is held, after the detail: the button is no
      // focus stop of its own, so the row says it.
      accessibilityHint={listRowHint(row.detail || null, action?.hint)}
      // The button's press as a named action, one swipe up on VoiceOver and
      // in TalkBack's actions menu, as the Tasks row offers its checkbox;
      // the row's own tap still opens the sheet. Left off while the button
      // is disabled, so it can't offer what it would refuse.
      accessibilityActions={
        accessibilityActions.length > 0 ? accessibilityActions : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "rowAction" && action) {
          if (!action.disabled) action.run();
        }
        if (event.nativeEvent.actionName === "rowMenu") menu?.open();
      }}
      onPress={onPress}
      onLongPress={menu?.open}
      onCard={onCard}
      style={rowStyle}
    >
      {content}
    </PressableRow>
  );
}

/**
 * What leads a row: an event's date, month over day as a calendar draws it;
 * the face of who the row is from, with its kind's glyph small on the corner
 * (#4402, item 4); else its kind's glyph from the shared nav set
 * (`ACTIVITY_GLYPH_NAV`). All are 40pt, so every row is the same height, and
 * all are neutral apart from the member's own tint: colour on this screen is
 * for what asks something of the member and for status, never for a kind
 * (`components.md` §5). Decoration only: the detail says the day in words
 * ("Tomorrow · 7:00 PM") and names the person, and a poll's poster is in the
 * row's label (`ActivityListRow`).
 */
function ActivityRowLead({
  row,
  onCard,
}: {
  row: ActivityRow;
  onCard: boolean;
}) {
  const on = onCard ? "card" : "background";
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  const faceFor = useContext(ActivityFaces);
  const face = !row.dateBlock && row.faceId ? faceFor(row.faceId) : null;
  if (face) {
    // The face of who the row is from, with its kind's glyph small on the
    // corner, as Teams' and Slack's Activity draw the actor (#4402, item 4).
    return (
      <View
        style={styles.face}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`activity-face-${row.glyph}`}
      >
        <MemberAvatar
          uri={face.avatarUrl}
          initials={initialsFor(face.name ?? "?")}
          size={LEAD_SIZE}
          tint={face.tint}
          style={styles.faceCircle}
          textStyle={styles.faceText}
        />
        <View style={styles.faceGlyph} testID="activity-face-glyph">
          <NavGlyph
            paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV[row.glyph]]}
            color={tokens.color.text.mutedForeground}
            size={FACE_GLYPH_SIZE}
          />
        </View>
      </View>
    );
  }
  if (row.dateBlock) {
    return (
      <LeadTile size="lead" on={on} testID="activity-date-block">
        <View style={styles.leadDate}>
          <Text style={styles.leadMonth}>{row.dateBlock.month}</Text>
          <Text style={styles.leadDay}>{row.dateBlock.day}</Text>
        </View>
      </LeadTile>
    );
  }
  return (
    <LeadTile size="lead" on={on} testID={`activity-glyph-${row.glyph}`}>
      <NavGlyph
        paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV[row.glyph]]}
        color={tokens.color.text.mutedForeground}
        size={LEAD_TILE_GLYPH}
      />
    </LeadTile>
  );
}

/** The kind's glyph on a face's corner: web's 12px in a 20px disc. */
const FACE_GLYPH_SIZE = 12;
const FACE_GLYPH_DISC = 20;

/**
 * A row's second line. A closing time or due time less than a day away
 * (`row.soon`, "closes in 2 hours") is drawn in the warning hue, so what runs
 * out soon reads apart from what runs out next week (#4402, item 4).
 */
function ActivityRowDetail({
  row,
  lines,
}: {
  row: ActivityRow;
  lines: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createActivityRowStyles(tokens);
  if (!row.detail) return null;
  const { lead, soon } = activityDetailParts(row);
  return (
    <Text numberOfLines={lines} style={styles.detail}>
      {lead}
      {lead && soon ? " · " : null}
      {soon ? (
        <Text style={styles.soon} testID="activity-soon">
          {soon}
        </Text>
      ) : null}
    </Text>
  );
}

/**
 * A badge that asks the member to act (`Vote`, `Confirm`, `Approve`,
 * `Check in`), drawn as the action the row opens rather than as a status, so
 * it reads apart from `To do` or `Required` (#4173). Web's tinted button
 * recipe: the chapter's subtle accent fill, its border and its text, since
 * the accent belongs to the one action that matters (`components.md` §3),
 * never a solid status hue (§5). It is not its own control: the row is the
 * hit target, and this names what the row opens to. `Vote` and `Check in`
 * stay this; `Confirm` and `Approve` draw as `ActivityAskButton` while the
 * plan allows them (#4437).
 */
export function ActivityAsk({
  label,
  filled = false,
}: {
  label: string;
  /** The filled accent button: the week card's Next row only (#4766). */
  filled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const branding = useChapterBranding();
  const styles = createActivityRowStyles(tokens);
  const tinted = askTinted(tokens, branding);
  return (
    <View
      testID={filled ? "activity-ask-filled" : undefined}
      style={[
        styles.ask,
        tinted.surface,
        filled
          ? {
              backgroundColor: branding.accentPrimary,
              borderColor: branding.accentPrimary,
            }
          : null,
      ]}
    >
      <Text
        style={[
          tinted.label,
          filled ? { color: branding.accentOnPrimary } : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** What a row's one-press ask needs to draw and run (#4437). */
export interface ActivityRowActionControl {
  label: string;
  /** In flight, done, offline, or the chapter still loading. */
  disabled: boolean;
  /** Why it is disabled, when that is the connection. */
  hint: string | undefined;
  run: () => void;
}

/**
 * The ask as its own control (#4437): the same tinted chip `ActivityAsk`
 * draws, now pressable, with its hit area grown to the touch floor. Hidden
 * from screen readers, since the row carries it as a named action rather
 * than a second focus stop nested in the row's. Disabled, it doesn't claim
 * the touch, so a tap on it opens the sheet as the ask did.
 */
export function ActivityAskButton({
  action,
  filled = false,
}: {
  action: ActivityRowActionControl;
  /** `ActivityAsk`'s filled accent: the week card's Next row (#4766, #4427). */
  filled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const branding = useChapterBranding();
  const tinted = askTinted(tokens, branding);
  const styles = createActivityRowStyles(tokens);
  const slop = Math.max(0, (tokens.touch.minimum - ASK_HEIGHT) / 2);
  return (
    <Pressable
      testID="activity-row-action"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      disabled={action.disabled}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      onPress={action.run}
      style={({ pressed }) => [
        styles.ask,
        tinted.surface,
        // Disabled is the one recipe for every variant (tinted-control.ts);
        // the filled ask keeps its accent fill otherwise, and a press dims
        // it as the PR drew it, since the tinted press tint is for the
        // subtle fill.
        filled && !action.disabled
          ? {
              backgroundColor: branding.accentPrimary,
              borderColor: branding.accentPrimary,
            }
          : null,
        action.disabled
          ? tinted.disabled
          : pressed
            ? filled
              ? { opacity: 0.7 }
              : tinted.pressed
            : null,
      ]}
    >
      <Text
        style={[
          tinted.label,
          action.disabled
            ? tinted.disabledLabel
            : filled
              ? { color: branding.accentOnPrimary }
              : null,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
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
      <View style={createUnreadDotStyles(tokens).spacer} />
      <LeadTileSkeleton />
      <View style={styles.text}>
        <SkeletonText role={label} width={SKELETON_WIDTHS[index % 4]} />
        <SkeletonText role={caption} width="34%" />
      </View>
    </View>
  );
}

const SKELETON_WIDTHS = ["58%", "42%", "66%", "48%"] as const;

/** The lead: web's 40px (`h-10 w-10`), the two-line row's `LeadTile`. */
const LEAD_SIZE = LEAD_TILE_SIZE.lead;

/** The ask's height: web's `h-7`, a badge's line rather than a button's. */
const ASK_HEIGHT = 28;

/** The ask's tinted recipe, at caption size to fit its badge-height line. */
function askTinted(
  tokens: SignetTokens,
  branding: Parameters<typeof tintedControlStyles>[1],
) {
  return tintedControlStyles(tokens, branding, tokens.typography.role.caption);
}

function createActivityRowStyles(tokens: SignetTokens) {
  // The frame the Calendar's rows share (`leadRowStyles`).
  const lead = leadRowStyles(tokens);
  return StyleSheet.create({
    row: {
      ...lead.row,
      // Square and hairline-split, as the Events list's flat rows bleed:
      // content on the gutter line, press feedback clear of it.
      ...gutterBleed(tokens, { rounded: false }),
    },
    // In a card the card's padding is the gutter: no bleed.
    rowOnCard: {
      paddingHorizontal: 0,
      marginHorizontal: 0,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    text: lead.text,
    title: lead.title,
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // The caption's size, at semibold: a weight is its own Figtree family.
    soon: {
      fontFamily: typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }).fontFamily,
      color: tokens.color.semantic.warning,
    },
    face: {
      width: LEAD_SIZE,
      height: LEAD_SIZE,
      flexShrink: 0,
    },
    faceCircle: {
      width: LEAD_SIZE,
      height: LEAD_SIZE,
      borderRadius: avatarRadius(LEAD_SIZE),
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      backgroundColor: tokens.color.surface.popover,
    },
    faceText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    faceGlyph: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: FACE_GLYPH_DISC,
      height: FACE_GLYPH_DISC,
      borderRadius: avatarRadius(FACE_GLYPH_DISC),
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    leadDate: {
      alignItems: "center",
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
    },
  });
}
