import { useEffect, useState } from "react";
import {
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ActivityNudge } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { isMemberNudgePraise } from "@repo/validation";
import { openItemMenu, pressAt } from "@/components/item-actions-menu";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { NavGlyph } from "@/components/nav-glyph";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

type GlyphName = keyof typeof NAV_GLYPHS;

/** Each kind's glyph and hue: what it is, at a glance, before a word is read. */
function kindLook(
  kind: string,
  tokens: SignetTokens,
): { glyph: GlyphName; hue: string } {
  const { semantic, gold } = tokens.color;
  switch (kind) {
    case "event_soon":
      return { glyph: "events", hue: semantic.infoText };
    case "mention_unread":
      return { glyph: "chat", hue: semantic.mention };
    case "announcement_unread":
      return { glyph: "chat", hue: gold.askText };
    case "signup_open":
      return { glyph: "signup", hue: semantic.success };
    case "officer_queue":
      return { glyph: "confirm", hue: gold.askText };
    case "minutes_new":
      return { glyph: "meetings", hue: semantic.infoText };
    case "study_behind":
      return { glyph: "study", hue: semantic.warning };
    case "task_due_soon":
    case "task_overdue":
    case "task_sent_back":
    case "task_praise":
      return { glyph: "tasks", hue: semantic.success };
    default:
      // A kind from a newer server: a neutral glyph, never a blank.
      return { glyph: "activity", hue: tokens.color.text.mutedForeground };
  }
}

/**
 * The card at the top of the phone's Activity (#5464, `spec/behavior/ai.md`
 * § The card and its tray): the one most useful thing waiting on the member,
 * and a tray of the next few. Paul picked this shape on 2026-11-18 (one
 * spotlight with a tray). Bevel's daily card is the reference: always at the
 * top under the day's stats, one specific thing from the member's own data.
 * Linear's Inbox gives the coloured kind tiles, Apple Fitness the row of
 * small coloured stats.
 *
 * - **Show, don't write.** A tile whose glyph and colour say what it is, the
 *   thing's own name, its time or count, and one button that settles it.
 *   That is the whole card without AI. With AI on, one sentence sits under
 *   it on Frapp's gold rule.
 * - **The tray.** Up to three chips, each in its kind's colour. Pressing one
 *   brings that item into the card in place; nothing opens over the page.
 * - **No filled button.** The card's buttons are outlined, as every action on
 *   Activity is since the week card's filled Next went (#5779).
 * - **Waving off.** The close mark waves off what the card shows, and it is
 *   not raised again. "More" holds turning the card off.
 */
export function NudgeCard({
  card,
  tray,
  canAsk,
  onOpen,
  onAsk,
  onDismiss,
  onTurnOff,
  onSeen,
}: {
  card: ActivityNudge;
  tray: readonly ActivityNudge[];
  /** Ask Frapp is on for this member. Off: no "Ask about this". */
  canAsk: boolean;
  onOpen: (item: ActivityNudge) => void;
  onAsk: (item: ActivityNudge) => void;
  onDismiss: (item: ActivityNudge) => void;
  onTurnOff: () => void;
  onSeen: (id: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // Which item the card shows: the server's pick until a chip is pressed.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const all = [card, ...tray];
  const keyOf = (item: ActivityNudge) => `${item.kind}:${item.subject_key}`;
  const shown = all.find((item) => keyOf(item) === pickedKey) ?? card;
  const others = all.filter((item) => item !== shown);
  const look = kindLook(shown.kind, tokens);
  const praise = isMemberNudgePraise(shown.kind);

  // On screen is seen: the card sits at the top of the page.
  const { id, seen } = card;
  useEffect(() => {
    if (id && !seen) onSeen(id);
    // Once per card; `onSeen` is read when the card arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, seen]);

  const more = (event?: GestureResponderEvent) =>
    openItemMenu(
      {
        title: "This card",
        actions: [
          { key: "hide", label: "Hide this one", run: () => onDismiss(shown) },
          {
            key: "turn-off",
            label: "Turn these off",
            destructive: true,
            run: onTurnOff,
          },
        ],
      },
      pressAt(event),
    );

  return (
    <View style={styles.card} testID="activity-nudge-card">
      <View style={styles.head}>
        <LeadTile
          size="lead"
          on="card"
          hue={look.hue}
          testID={`activity-nudge-tile-${shown.kind}`}
        >
          <NavGlyph
            paths={NAV_GLYPHS[look.glyph]}
            color={look.hue}
            size={LEAD_TILE_GLYPH}
          />
        </LeadTile>
        <View style={styles.headText}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={styles.headline}
          >
            {shown.headline}
          </Text>
          <Text
            numberOfLines={2}
            style={[styles.meta, shown.urgent ? { color: look.hue } : null]}
          >
            {shown.meta}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          accessibilityHint="Hide this one, or turn these cards off."
          hitSlop={12}
          onPress={more}
          testID="activity-nudge-more"
          style={({ pressed }) => [
            styles.moreButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.moreDots}>···</Text>
        </Pressable>
      </View>
      {shown.line ? (
        <Text style={styles.line} testID="activity-nudge-line">
          {shown.line}
        </Text>
      ) : null}
      {shown.start_here ? (
        <Text style={styles.line} testID="activity-nudge-start">
          {shown.start_here}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <CardButton
          label={shown.action}
          onPress={() => (praise ? onDismiss(shown) : onOpen(shown))}
          testID="activity-nudge-open"
        />
        {canAsk && !praise ? (
          <CardButton
            label="Ask about this"
            onPress={() => onAsk(shown)}
            testID="activity-nudge-ask"
          />
        ) : null}
      </View>
      {others.length > 0 ? (
        <View style={styles.tray} testID="activity-nudge-tray">
          {others.map((item) => {
            const itemLook = kindLook(item.kind, tokens);
            return (
              <Pressable
                key={keyOf(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.headline}, ${item.meta}`}
                onPress={() => setPickedKey(keyOf(item))}
                testID={`activity-nudge-chip-${item.kind}`}
                style={({ pressed }) => [
                  styles.chip,
                  { borderColor: itemLook.hue },
                  pressed && styles.pressed,
                ]}
              >
                <NavGlyph
                  paths={NAV_GLYPHS[itemLook.glyph]}
                  color={itemLook.hue}
                  size={16}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.chipLabel, { color: itemLook.hue }]}
                >
                  {item.chip}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function CardButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Text numberOfLines={1} style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
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
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    headText: { flex: 1, minWidth: 0, gap: 2 },
    headline: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.label),
      fontWeight: "400",
      color: tokens.color.text.mutedForeground,
    },
    moreButton: {
      alignSelf: "flex-start",
      paddingHorizontal: tokens.spacing.xs,
    },
    moreDots: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.mutedForeground,
    },
    line: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      borderLeftWidth: 2,
      // Frapp's own voice keeps the fixed house gold (`components.md` §11).
      borderLeftColor: tokens.color.gold.askText,
      paddingLeft: tokens.spacing.md,
    },
    actions: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    button: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      // The edge that says "this is a control" (`foundations.md` §3).
      borderColor: tokens.color.border.control,
      paddingHorizontal: tokens.spacing.md,
    },
    buttonLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    tray: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
      paddingTop: tokens.spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 32,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: tokens.spacing.md,
    },
    chipLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: { opacity: 0.7 },
  });
}
