import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, tint, typeRole, useFrappTheme } from "@/lib/theme";

const AVATAR_SIZE = 48;

/**
 * The card that opens s09 (`canvas-screens.dc.html:326`): avatar, name, a
 * line under it, and a chevron to s15.
 *
 * The board's line is a role chip ("President") then the points balance. No
 * role name is readable on mobile (`/v1/users/me/permissions` returns
 * permissions only, #1048), so the line is the balance alone rather than a
 * chip that would have to invent one.
 */
export function ProfileCard({
  displayName,
  initials,
  photoUrl,
  pointsLabel,
  accent,
}: {
  displayName: string | null;
  initials: string;
  photoUrl: string | null;
  /** "1,240 pts", or `null` while the balance is unknown. */
  pointsLabel: string | null;
  /** The chapter accent, which tints the initials avatar as s15's does. */
  accent: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // A photo that fails to load (an expired signed URL, no network) falls back
  // to initials rather than an empty circle. Keyed by URL: a refetch that
  // signs a new one tries again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!photoUrl && photoUrl !== failedUrl;
  const name = displayName ?? "Your profile";

  return (
    <Link href="/profile" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityValue={pointsLabel ? { text: pointsLabel } : undefined}
        accessibilityHint="Opens your profile."
        android_ripple={{ color: styles.ripple.color }}
        style={({ pressed }) => [
          styles.card,
          pressed && Platform.OS !== "android" ? styles.pressed : null,
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.avatar}
            onError={() => setFailedUrl(photoUrl)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: tint(accent, 0.13),
                borderColor: tint(accent, 0.3),
              },
            ]}
          >
            <Text style={[styles.initials, { color: accent }]}>{initials}</Text>
          </View>
        )}
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {pointsLabel ? <Text style={styles.meta}>{pointsLabel}</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      // Bounds the Android ripple to the card's rounded corners.
      overflow: "hidden",
    },
    pressed: {
      backgroundColor: tokens.color.surface.popover,
    },
    ripple: {
      color: tint(tokens.color.text.foreground, 0.12),
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    initials: {
      ...typeRole(tokens.typography.role.label),
    },
    text: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    name: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    chevron: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
  });
}
