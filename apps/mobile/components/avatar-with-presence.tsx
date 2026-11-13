import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { StatusDot } from "@/components/account/status-dot";

/** The dot's diameter for an avatar's size: web's 10pt, larger on a hero face. */
export function presenceDotSize(avatarSize: number): number {
  return avatarSize >= 64 ? 16 : 10;
}

/**
 * A member's avatar with their presence dot on its bottom-right corner
 * (#4633): the phone's one copy of web's `AvatarPresenceDot`
 * (`apps/web/components/members/presence-dot.tsx`), used by the Directory's
 * row and tile, the member sheet and the channel member sheet.
 *
 * `status: null` draws no dot: the honest answer before chapter presence has
 * synced, never a stand-in Offline. Read it with `usePresenceOf(userId)`
 * (`lib/presence/presence-store.ts`) in the row that draws this, so only that
 * row re-renders when the member's presence changes.
 *
 * Pinned as web pins it: the dot's own edge on the avatar's bounding corner,
 * the 2pt ring (`StatusDot`'s `ring`, in the surface behind) outside it.
 * The dot is decorative; whatever renders this names the status.
 *
 * `children` is the avatar itself, so a caller keeps its own photo, tint and
 * dimming.
 */
export function AvatarWithPresence({
  status,
  avatarSize,
  ring,
  style,
  children,
}: {
  status: PresenceStatus | null;
  avatarSize: number;
  /** The surface behind the avatar, painted as the dot's ring. */
  ring: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View style={style}>
      {children}
      {status ? (
        <View pointerEvents="none" style={styles.dot}>
          <StatusDot
            testID={`member-presence-${status}`}
            status={status}
            size={presenceDotSize(avatarSize)}
            ring={ring}
          />
        </View>
      ) : null}
    </View>
  );
}

// The ring is 2pt of padding round the dot, so -2 puts the dot's own edge on
// the corner and the ring just past it, as web's `ring-2` at `bottom-0 right-0`.
const styles = StyleSheet.create({
  dot: {
    position: "absolute",
    bottom: -2,
    right: -2,
  },
});
