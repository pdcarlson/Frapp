import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The sign-in screen's picture of the product (#3349).
 *
 * Three small cards, stacked, showing what a chapter does in Frapp before the
 * person has an account: a meeting to check in to, points earned, an
 * announcement. The owner asked for onboarding that conveys what the app is
 * "before the user even touches the surfaces"; these are drawn, not data.
 *
 * Decorative: hidden from screen readers, because the tagline above says the
 * same thing in words. Each card names a feature that ships today (events
 * check-in, points, read-only #announcements). Ask is not one of them, for
 * the reason the tagline isn't the brand line (#2298).
 */

interface Moment {
  key: string;
  /** Text in the badge; `null` draws the calendar glyph instead. */
  badge: string | null;
  kicker: string;
  title: string;
  pill?: string;
}

const SIGN_IN_MOMENTS: readonly Moment[] = [
  {
    key: "meeting",
    badge: null,
    kicker: "Tonight",
    title: "Chapter meeting",
    pill: "Check in",
  },
  { key: "points", badge: "+15", kicker: "Points", title: "Philanthropy 5K" },
  {
    key: "announcement",
    badge: "#",
    kicker: "#announcements",
    title: "Formal is Saturday at 8",
  },
];

/**
 * Each card steps back a little: narrower and fainter, so the column reads as
 * a feed with the newest on top. No tilt: a fanned stack read as staged on
 * the first web render (the owner's "manufactured", 2026-11-04).
 */
const DEPTH = [
  { inset: 0, opacity: 1 },
  { inset: 8, opacity: 0.8 },
  { inset: 16, opacity: 0.6 },
] as const;

export function SignInMoments() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View
      style={styles.stack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {SIGN_IN_MOMENTS.map((moment, index) => {
        const depth = DEPTH[index % DEPTH.length];
        return (
          <View
            key={moment.key}
            style={[
              styles.card,
              { marginHorizontal: depth.inset, opacity: depth.opacity },
            ]}
          >
            <View style={[styles.badge, index === 0 ? styles.badgeGold : null]}>
              {moment.badge === null ? (
                <CalendarGlyph color={tokens.color.gold.house} size={16} />
              ) : (
                <Text
                  style={[
                    styles.badgeText,
                    index === 0 ? styles.badgeTextGold : null,
                  ]}
                >
                  {moment.badge}
                </Text>
              )}
            </View>
            <View style={styles.copy}>
              <Text style={styles.kicker} numberOfLines={1}>
                {moment.kicker}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                {moment.title}
              </Text>
            </View>
            {moment.pill ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{moment.pill}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: {
      width: "100%",
      maxWidth: 320,
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xl,
    },
    // Elevation is a lighter surface, never a shadow (foundations.md §10).
    card: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    badge: {
      width: 32,
      height: 32,
      borderRadius: tokens.radius.control - 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.surface.surface1,
    },
    badgeGold: {
      backgroundColor: tint(tokens.color.gold.house, 0.16),
    },
    badgeText: {
      // The label face (600) at caption size: a weight with a loaded face.
      ...typeRole(tokens.typography.role.label),
      fontSize: tokens.typography.role.caption.size,
      color: tokens.color.text.foreground,
    },
    badgeTextGold: {
      color: tokens.color.gold.house,
    },
    copy: {
      flex: 1,
      minWidth: 0,
    },
    kicker: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pill: {
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: tokens.color.gold.house,
    },
    pillText: {
      // The label face (600) at caption size: a weight with a loaded face.
      ...typeRole(tokens.typography.role.label),
      fontSize: tokens.typography.role.caption.size,
      color: tokens.color.gold.onHouse,
    },
  });
}
