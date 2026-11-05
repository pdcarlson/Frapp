import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { onlineManager } from "@tanstack/react-query";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, tint, typeRole, useFrappTheme } from "@/lib/theme";
import { PressableRow } from "@/components/list-section";

const AVATAR_SIZE = 48;

/**
 * The card that opens s09 (`canvas-screens.dc.html:326`): avatar, name, a
 * line under it, and a chevron to s15.
 *
 * The board's line is a role chip ("President") then the points balance. No
 * role name is readable on mobile (`/v1/users/me/permissions` returns
 * permissions only, #1048), so the line is the balance alone rather than a
 * chip that would have to invent one.
 *
 * It navigates with `router.push` in `onPress`, never `<Link asChild>`: on
 * native, Link's slot merges the child's props with an object spread, which
 * turns a function-form `style` into `{}` and drops every card style.
 */
export function ProfileCard({
  displayName,
  initials,
  photoUrl,
  fetchedAt = 0,
  pointsLabel,
  accent,
}: {
  displayName: string | null;
  initials: string;
  photoUrl: string | null;
  /** When that read last completed (`dataUpdatedAt`); a refetch retries a failed load. */
  fetchedAt?: number;
  /** "1,240 pts", or `null` while the balance is unknown. */
  pointsLabel: string | null;
  /** The chapter accent, which tints the initials avatar. */
  accent: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  // A photo that fails to load (an expired signed URL, no network) falls back
  // to initials rather than an empty circle. The failure is remembered per
  // read, not per URL, for the reason `components/profile/profile-photo.tsx`
  // gives: the API serves the same signed URL for half an hour, so a
  // URL-keyed failure would hide the photo long after the network came back.
  // A refetch, or the device coming back online, tries again.
  const [failed, setFailed] = useState<{ url: string; at: number } | null>(
    null,
  );
  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) setFailed(null);
      }),
    [],
  );
  const showPhoto =
    !!photoUrl && !(failed?.url === photoUrl && failed.at === fetchedAt);
  const name = displayName ?? "Your profile";

  return (
    <PressableRow
      // The card is `surface1`, like the ListSections under it, so its iOS
      // lift is the default one step, to `card`.
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityValue={pointsLabel ? { text: pointsLabel } : undefined}
      accessibilityHint="Opens your profile."
      onPress={() => router.push("/profile")}
      style={styles.card}
    >
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.avatar}
          onError={() => setFailed({ url: photoUrl, at: fetchedAt })}
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
    </PressableRow>
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
      // The More list's tone, so the card and the rows under it read as one
      // surface (s09). It was the warmer `card`, a step browner than them.
      backgroundColor: tokens.color.surface.surface1,
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
    // `ListRow`'s chevron, so the two on More are the same size.
    chevron: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
  });
}
