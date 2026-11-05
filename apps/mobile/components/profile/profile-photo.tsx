import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import {
  useActiveChapterId,
  useConfirmAvatar,
  useRemoveAvatar,
  useRequestAvatarUploadUrl,
} from "@repo/hooks";
import { onlineManager } from "@tanstack/react-query";
import { SignetTokens } from "@repo/theme/signet";
import { usePressFeedback } from "@/components/list-section";
import { useChapterBranding, type ChapterBranding } from "@/lib/chapter-branding";
import { pickAndSetProfilePhoto } from "@/lib/more/profile-photo";
import { avatarRadius, tint, typeRole, useFrappTheme } from "@/lib/theme";

const AVATAR_SIZE = 84;
const BADGE_SIZE = 28;
const BADGE_GLYPH_SIZE = 16;

export const CHOOSE_PHOTO = "Choose photo";
export const REMOVE_PHOTO = "Remove photo";
export const REMOVE_PHOTO_CONFIRM_TITLE = "Remove your profile photo?";

/**
 * s15's identity avatar, with the photo in it, and the control that changes
 * it (#732).
 *
 * Canvas draws the avatar and no control for it. The avatar is the control:
 * tapping it picks a photo, or, once there is one, offers the platform's own
 * choice of Choose photo or Remove photo (iOS's action sheet, an alert on
 * Android). A small camera badge in the accent marks it as tappable. It used
 * to be a line of text buttons ("Change photo", "Remove") between the avatar
 * and the name, which split the identity block the board draws as one, and
 * Remove deleted the photo on the spot.
 *
 * Removing confirms, in a native alert with a destructive button, because the
 * photo can't be brought back (`spec/ui/mobile/README.md` § Native-feel
 * rules). The screen has no toast, so a refusal or a failure is a line under
 * the avatar, cleared by the next attempt. A success shows itself in the
 * avatar, so it is only announced to a screen reader.
 */
export function ProfilePhoto({
  photoUrl,
  fetchedAt = 0,
  initials,
}: {
  /** Signed URL from `GET /v1/users/me`, or `null` for initials. */
  photoUrl: string | null;
  /** When that read last completed (`dataUpdatedAt`); a refetch retries a failed load. */
  fetchedAt?: number;
  initials: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const { accent } = brand;
  const styles = createStyles(tokens, brand);
  const feedback = usePressFeedback();
  const chapterId = useActiveChapterId();
  const requestUrl = useRequestAvatarUploadUrl();
  const confirm = useConfirmAvatar();
  const remove = useRemoveAvatar();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // An image that fails to load (an expired URL, no network) falls back to
  // initials rather than an empty circle. The failure is remembered per read,
  // not per URL: the API hands out the same signed URL for half an hour, so
  // a URL-keyed failure would hide the photo long after the network came
  // back. A refetch of the profile, or the device coming back online, tries
  // the image again.
  const [failed, setFailed] = useState<{ url: string; at: number } | null>(
    null,
  );
  const showPhoto =
    !!photoUrl && !(failed?.url === photoUrl && failed.at === fetchedAt);
  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) setFailed(null);
      }),
    [],
  );

  async function change() {
    setBusy(true);
    setNote(null);
    const result = await pickAndSetProfilePhoto({
      requestUploadUrl: (body) => requestUrl.mutateAsync(body),
      confirm: (path) => confirm.mutateAsync(path),
    });
    setBusy(false);
    if (result.status === "refused") setNote(result.reason);
    if (result.status === "updated") {
      AccessibilityInfo.announceForAccessibility("Photo updated.");
    }
  }

  async function clear() {
    setBusy(true);
    setNote(null);
    try {
      await remove.mutateAsync();
      AccessibilityInfo.announceForAccessibility("Photo removed.");
    } catch {
      setNote("Couldn't remove your photo. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    Alert.alert(REMOVE_PHOTO_CONFIRM_TITLE, undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void clear() },
    ]);
  }

  function openChoices() {
    // With nothing to remove there is nothing to choose between.
    if (!photoUrl) {
      void change();
      return;
    }
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [CHOOSE_PHOTO, REMOVE_PHOTO, "Cancel"],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
          userInterfaceStyle: "dark",
        },
        (index) => {
          if (index === 0) void change();
          if (index === 1) confirmRemove();
        },
      );
      return;
    }
    Alert.alert(
      "Profile photo",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: REMOVE_PHOTO, style: "destructive", onPress: confirmRemove },
        { text: CHOOSE_PHOTO, onPress: () => void change() },
      ],
      { cancelable: true },
    );
  }

  const canEdit = !!chapterId && !busy;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          photoUrl ? "Change profile photo" : "Add profile photo"
        }
        accessibilityState={{ disabled: !chapterId, busy }}
        disabled={!canEdit}
        onPress={openChoices}
        // A round ripple the avatar's size on Android; the avatar dims while
        // held on iOS, as an image button does there. The row lift
        // (`usePressFeedback`'s) would fill behind a circle and show nothing.
        android_ripple={{
          ...feedback.ripple,
          borderless: true,
          radius: AVATAR_SIZE / 2,
        }}
        style={({ pressed }) => [
          styles.button,
          pressed && Platform.OS !== "android" ? styles.pressed : null,
        ]}
      >
        <View style={[styles.avatar, { borderColor: accent }]}>
          {showPhoto ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onError={() => setFailed({ url: photoUrl, at: fetchedAt })}
            />
          ) : (
            <Text style={[styles.initials, { color: accent }]}>{initials}</Text>
          )}
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator
                color={tokens.color.text.foreground}
                accessibilityLabel="Updating your photo"
              />
            </View>
          ) : null}
        </View>
        {chapterId ? (
          <View style={styles.badge}>
            <CameraGlyph color={brand.accentOnPrimary} />
          </View>
        ) : null}
      </Pressable>
      {!chapterId ? (
        <Text style={styles.note}>
          Choose a chapter from More → Switch chapter to add a photo.
        </Text>
      ) : note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The badge's camera: s20's "Add photo proof" camera in iconography.md §1's
 * recipe (a 1.6 stroke on a 24 grid, the body filled with its own hue).
 * Decorative: the avatar's label names the control.
 */
function CameraGlyph({ color }: { color: string }) {
  return (
    <Svg
      width={BADGE_GLYPH_SIZE}
      height={BADGE_GLYPH_SIZE}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect
        x={3.5}
        y={6.5}
        width={17}
        height={13}
        rx={3}
        stroke={color}
        strokeWidth={1.6}
        fill={tint(color, 0.16)}
      />
      <Circle
        cx={12}
        cy={13}
        r={3.4}
        stroke={color}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M8.5 6.5L10 4h4l1.5 2.5"
        stroke={color}
        strokeWidth={1.6}
        fill="none"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    wrap: {
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    button: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
    },
    pressed: {
      opacity: 0.7,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      borderWidth: 1,
      backgroundColor: brand.accentSubtle,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    photo: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
    },
    initials: {
      ...typeRole(tokens.typography.role.headline),
    },
    busy: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tint(tokens.color.surface.background, 0.6),
    },
    // On the avatar's lower right, ringed in the screen's background so it
    // reads as cut out of the circle rather than stuck on it.
    badge: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: avatarRadius(BADGE_SIZE),
      borderWidth: 2,
      borderColor: tokens.color.surface.background,
      backgroundColor: brand.accentPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
