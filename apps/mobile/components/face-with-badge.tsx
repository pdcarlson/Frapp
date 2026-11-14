import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MemberAvatarTint } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { MemberAvatar } from "@/components/member-avatar";
import { initialsFor } from "@/lib/chat/display-name";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The badge's measurements, one recipe for every face that wears one
 * (`iconography.md` §6.2.5b, #4476), web's in points: a disc half the face's
 * size, the glyph inside at three fifths of the disc, its edge 4pt past the
 * face's lower corner, with a hairline border. The hairline, not a ring in
 * the ground's colour, so the disc reads on every ground a face sits on (the
 * screen, a card, a pressed row) without a halo.
 */
export function faceBadgeSize(faceSize: number): number {
  return Math.round(faceSize / 2);
}

export function faceBadgeGlyphSize(faceSize: number): number {
  return Math.round((faceBadgeSize(faceSize) * 3) / 5);
}

/** What a glyph inside the badge is drawn at. */
export interface FaceBadgeGlyph {
  size: number;
  color: string;
}

/**
 * A member's face (their photo, else their initials on their own tint) with a
 * small badge on its lower corner naming the kind of thing it leads, as
 * Slack's and Teams' Activity draw the actor. Shared by the Notifications
 * screen and the Activity rows (#4476); each keeps its own face size.
 *
 * Decoration: hidden from screen readers, since the row around it says the
 * kind and the person in words.
 */
export function FaceWithBadge({
  size,
  avatarUrl,
  name,
  tint,
  badge,
  tone,
  testID,
  badgeTestID,
}: {
  /** The face's diameter in points; the badge is sized from it. */
  size: number;
  avatarUrl: string | null | undefined;
  /** Whose face: read for the initials. */
  name: string | null | undefined;
  tint?: MemberAvatarTint | null;
  /**
   * The badge's content: a short mark ("@", "#") drawn in the badge's ink, or
   * a glyph drawn at the size and colour it is handed.
   */
  badge: string | ((glyph: FaceBadgeGlyph) => ReactNode);
  /** The disc's fill and ink; neutral (`surface1`, muted) when omitted. */
  tone?: { fill: string; ink: string };
  testID?: string;
  badgeTestID?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, size);
  const fill = tone?.fill ?? tokens.color.surface.surface1;
  const ink = tone?.ink ?? tokens.color.text.mutedForeground;
  return (
    <View
      style={styles.face}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <MemberAvatar
        uri={avatarUrl}
        initials={name ? initialsFor(name) : ""}
        size={size}
        tint={tint}
        style={styles.circle}
        textStyle={styles.initials}
      />
      <View
        style={[styles.badge, { backgroundColor: fill }]}
        testID={badgeTestID}
      >
        {typeof badge === "string" ? (
          <Text style={[styles.mark, { color: ink }]}>{badge}</Text>
        ) : (
          badge({ size: faceBadgeGlyphSize(size), color: ink })
        )}
      </View>
    </View>
  );
}

/** How far the disc sits past the face's corner: clear of the initials. */
const BADGE_OFFSET = 4;

function createStyles(tokens: SignetTokens, size: number) {
  const badge = faceBadgeSize(size);
  return StyleSheet.create({
    face: {
      width: size,
      height: size,
      flexShrink: 0,
    },
    circle: {
      width: size,
      height: size,
      borderRadius: avatarRadius(size),
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      backgroundColor: tokens.color.surface.popover,
    },
    initials: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    badge: {
      position: "absolute",
      right: -BADGE_OFFSET,
      bottom: -BADGE_OFFSET,
      width: badge,
      height: badge,
      borderRadius: badge / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      alignItems: "center",
      justifyContent: "center",
    },
    mark: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      lineHeight: badge - 2,
    },
  });
}
