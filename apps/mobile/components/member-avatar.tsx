import { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { onlineManager } from "@tanstack/react-query";
import type { MemberAvatarTint } from "@repo/hooks";

/**
 * A member's avatar on every list surface: their profile photo, or their
 * initials when there is no photo or it fails to load (components.md §11,
 * "Avatar").
 *
 * The caller keeps its own circle (`style`, sized and filled as before) and
 * its own initials type (`textStyle`), so a surface that drew initials draws
 * the same circle with the photo filling it. The photo sits on top of the
 * initials rather than replacing them, so a row never draws an empty circle
 * while the image loads, and a failed load leaves the initials showing.
 *
 * ## Caching
 *
 * Photos are signed URLs that the API re-mints every half hour or so
 * (`ProfilePhotoUrlService`, `useAuthorAvatars`), so the URL alone is a poor
 * cache key: every re-mint would download the same photo again. The storage
 * path (the URL without its query string) is the key instead. A member's new
 * photo is uploaded to a fresh path (`users.avatar_url` gets a new uuid), so a
 * changed photo is never served stale. The disk cache means a chat of a few
 * hundred messages from a dozen people downloads a dozen small images once,
 * not once per row or per launch.
 *
 * ## Color
 *
 * A member's initials take their own color (#3860, Paul approved 2026-11-10):
 * pass `tint` from the roster's `avatarTintFor(userId)` and the circle draws
 * style A, the hue at 18% over `--popover` with the initials in the full hue,
 * over whatever fill and initials color the caller's styles carry. A photo
 * covers it exactly as it covers the initials.
 */
export function MemberAvatar({
  uri,
  initials,
  size,
  style,
  textStyle,
  tint,
  testID,
}: {
  /** A renderable photo URL, or `null` for initials only. */
  uri: string | null | undefined;
  initials: string;
  size: number;
  /** The circle: size, radius and fill, as the surface drew it before. */
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  /** The member's initials paint; omit for the caller's neutral circle. */
  tint?: MemberAvatarTint | null;
  testID?: string;
}) {
  const key = uri ? photoCacheKey(uri) : null;
  // A failed load is remembered per photo, not per URL, so a re-minted URL
  // doesn't retry a broken one on every refetch; coming back online does.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) setFailedKey(null);
      }),
    [],
  );
  const showPhoto = !!uri && !!key && failedKey !== key;

  return (
    <View
      style={[style, styles.clip, tint ? { backgroundColor: tint.fill } : null]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[textStyle, tint ? { color: tint.text } : null]}>
        {initials}
      </Text>
      {showPhoto ? (
        <Image
          testID={testID ? `${testID}-photo` : undefined}
          source={{ uri, cacheKey: key }}
          style={[StyleSheet.absoluteFill, { width: size, height: size }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={key}
          transition={0}
          accessibilityIgnoresInvertColors
          onError={() => setFailedKey(key)}
        />
      ) : null}
    </View>
  );
}

/**
 * The photo's identity without its signature: the URL up to its query string.
 * Exported for the spec.
 */
export function photoCacheKey(uri: string): string {
  const query = uri.indexOf("?");
  return query === -1 ? uri : uri.slice(0, query);
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
});
