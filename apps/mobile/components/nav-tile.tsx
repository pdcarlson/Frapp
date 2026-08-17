import { ReactNode } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { asRoute } from "@/lib/href";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A More-hub row.
 *
 * Takes either an `href` (the common case) or an `onPress`, because the admin
 * rows added in C4 cannot use a plain href: s22 reads an `eventId` param, so it
 * is reached with the object form of `router.push` — which is also the only
 * navigation form `lib/routes.spec.ts` can see. Note the guard cannot see this
 * component's own `href` at all, since it arrives as a prop
 * (`spec/ui/mobile/navigation.md`); only the literals at the call sites are
 * checked.
 */
type NavTileProps = {
  title: string;
  description: string;
  accessibilityHint?: string;
  /** Trailing status — an unread badge, a resolved event name. */
  trailing?: ReactNode;
} & (
  | { href: string; onPress?: never; disabled?: boolean }
  | { href?: never; onPress: () => void; disabled?: boolean }
  // A row with no destination at all, which is only honest when it says so:
  // `description` carries the reason, the way C2 shipped s07's RSVP row.
  | { href?: never; onPress?: never; disabled: true }
);

export function NavTile({
  href,
  onPress,
  title,
  description,
  accessibilityHint,
  trailing,
  disabled = false,
}: NavTileProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const body = (
    <View style={styles.tileRow}>
      <View style={styles.tileText}>
        <Text style={[styles.tileTitle, disabled ? styles.muted : null]}>
          {title}
        </Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
      {trailing}
    </View>
  );

  if (disabled) {
    return (
      <View
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: true }}
        style={[styles.tile, styles.tileDisabled]}
      >
        {body}
      </View>
    );
  }

  const pressable = (
    <Pressable
      style={styles.tile}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint ?? description}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );

  return href ? (
    <Link href={asRoute(href)} asChild>
      {pressable}
    </Link>
  ) : (
    pressable
  );
}

/** The unread count drawn on the Notifications row. */
export function CountBadge({ count }: { count: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      justifyContent: "center",
    },
    tileDisabled: {
      backgroundColor: tokens.color.surface.surface1,
    },
    tileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    tileText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    tileTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    muted: {
      color: tokens.color.text.muted,
    },
    tileDescription: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    badge: {
      minWidth: tokens.spacing.xl,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.gold.house,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.onHouse,
    },
  });
}
