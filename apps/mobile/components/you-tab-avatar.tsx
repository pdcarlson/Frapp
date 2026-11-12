import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { useCurrentUser, useOwnAvatarTint } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { StatusDot } from "@/components/account/status-dot";
import { useOwnStatus } from "@/lib/account/own-status";
import { selectViewerProfile } from "@/lib/more/profile";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/** The glyph slot every tab draws in (`tab-glyphs.tsx`). */
export const YOU_AVATAR_SIZE = 24;
/** The active ring's stroke, and the gap between it and the avatar. */
const RING = 1.5;

/**
 * The You tab's icon (#3839): the member's own avatar, as Instagram, Slack
 * and Discord draw their last tab. Their photo, else their initials in their
 * member tint (#3860), on `surface.popover` with a hairline, like every
 * avatar in the app.
 *
 * A photo can't take the chapter accent, so the active state is a ring in the
 * accent with a 1.5pt gap, and the bold accent label and the
 * capsule the bar draws for every active tab. The avatar itself is never
 * filled with the accent (foundations.md §6, "Where the accent goes").
 *
 * The member's picked status (#3845) sits bottom-right, as Discord draws it
 * on its own last tab, and is hidden while Online, the status nobody picks.
 * The tab bar names it (`GlassTabBar`), since this glyph is hidden from a
 * screen reader.
 *
 * The photo falls back to initials when it fails to load, retried on a
 * refetch or when the phone comes back online, as Chat home's avatar did.
 */
export function YouTabAvatar({
  focused,
  accent,
}: {
  focused: boolean;
  accent: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const tint = useOwnAvatarTint();
  const own = useOwnStatus();
  const shownStatus = own && own.status !== "online" ? own.status : null;
  const photoUrl = profile?.photoUrl ?? null;
  const fetchedAt = userQuery.dataUpdatedAt;
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

  return (
    <View
      testID="you-tab-avatar"
      style={styles.slot}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {focused ? (
        <View
          testID="you-tab-ring"
          pointerEvents="none"
          style={[styles.ring, { borderColor: accent }]}
        />
      ) : null}
      <View
        style={[
          styles.avatar,
          !showPhoto && tint ? { backgroundColor: tint.fill } : null,
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            onError={() => setFailed({ url: photoUrl, at: fetchedAt })}
          />
        ) : (
          <Text
            style={[styles.initials, tint ? { color: tint.text } : null]}
            numberOfLines={1}
          >
            {profile?.initials ?? ""}
          </Text>
        )}
      </View>
      {shownStatus ? (
        <View pointerEvents="none" style={styles.status}>
          <StatusDot
            testID={`you-tab-status-${shownStatus}`}
            status={shownStatus}
            size={8}
            ring={tokens.color.surface.background}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const ringSize = YOU_AVATAR_SIZE + 4 * RING;
  return StyleSheet.create({
    slot: {
      width: YOU_AVATAR_SIZE,
      height: YOU_AVATAR_SIZE,
      alignItems: "center",
      justifyContent: "center",
    },
    ring: {
      position: "absolute",
      top: -2 * RING,
      left: -2 * RING,
      width: ringSize,
      height: ringSize,
      borderRadius: avatarRadius(ringSize),
      borderWidth: RING,
    },
    avatar: {
      width: YOU_AVATAR_SIZE,
      height: YOU_AVATAR_SIZE,
      borderRadius: avatarRadius(YOU_AVATAR_SIZE),
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    status: {
      position: "absolute",
      bottom: -3,
      right: -3,
    },
    photo: {
      width: YOU_AVATAR_SIZE,
      height: YOU_AVATAR_SIZE,
    },
    initials: {
      ...typeRole({ size: 9.5, weight: tokens.typography.weight.bold }),
      color: tokens.color.text.foreground,
    },
  });
}
