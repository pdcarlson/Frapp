import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useActiveChapterId,
  useConfirmAvatar,
  useRemoveAvatar,
  useRequestAvatarUploadUrl,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pickAndSetProfilePhoto } from "@/lib/more/profile-photo";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

const AVATAR_SIZE = 84;

/**
 * s15's identity avatar, now with the photo in it and the controls to change
 * it (#732).
 *
 * Canvas draws the avatar and no control for it. The two text actions under it
 * are the smallest affordance that works one-handed, and they sit where a
 * member looks for them. TODO-DESIGN: the drawn edit affordance.
 *
 * The screen has no toast, so an outcome is a line of text under the actions,
 * and cleared by the next attempt.
 */
export function ProfilePhoto({
  photoUrl,
  initials,
}: {
  /** Signed URL from `GET /v1/users/me`, or `null` for initials. */
  photoUrl: string | null;
  initials: string;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();
  const requestUrl = useRequestAvatarUploadUrl();
  const confirm = useConfirmAvatar();
  const remove = useRemoveAvatar();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // An image that fails to load (an expired URL, no network) falls back to
  // initials rather than an empty circle.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!photoUrl && photoUrl !== failedUrl;

  async function change() {
    setBusy(true);
    setNote(null);
    const result = await pickAndSetProfilePhoto({
      requestUploadUrl: (body) => requestUrl.mutateAsync(body),
      confirm: (path) => confirm.mutateAsync(path),
    });
    setBusy(false);
    if (result.status === "refused") setNote(result.reason);
    if (result.status === "updated") setNote("Photo updated.");
  }

  async function clear() {
    setBusy(true);
    setNote(null);
    try {
      await remove.mutateAsync();
      setNote("Photo removed.");
    } catch {
      setNote("Couldn't remove your photo. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.avatar, { borderColor: accent }]}>
        {showPhoto ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            accessibilityLabel="Your profile photo"
            onError={() => setFailedUrl(photoUrl)}
          />
        ) : (
          <Text style={[styles.initials, { color: accent }]}>{initials}</Text>
        )}
      </View>
      <View style={styles.actions}>
        {busy ? (
          <ActivityIndicator
            color={accent}
            accessibilityLabel="Updating your photo"
          />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !chapterId }}
              disabled={!chapterId}
              onPress={() => void change()}
              style={styles.hit}
            >
              <Text
                style={[
                  styles.action,
                  { color: chapterId ? accent : tokens.color.text.muted },
                ]}
              >
                {photoUrl ? "Change photo" : "Add photo"}
              </Text>
            </Pressable>
            {photoUrl ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void clear()}
                style={styles.hit}
              >
                <Text style={[styles.action, styles.remove]}>Remove</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
      {!chapterId ? (
        <Text style={styles.note}>
          Choose a chapter from More → Chapter to add a photo.
        </Text>
      ) : note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    wrap: {
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      borderWidth: 1,
      backgroundColor: tokens.color.gold.askFill,
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
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.lg,
    },
    // The 44pt touch floor, which the caption-sized label alone falls short of.
    hit: {
      minHeight: 44,
      justifyContent: "center",
    },
    action: {
      ...typeRole(tokens.typography.role.caption),
    },
    remove: {
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
