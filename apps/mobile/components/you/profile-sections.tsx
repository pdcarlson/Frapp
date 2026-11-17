import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useCurrentUser,
  useMemberByUserId,
  usePermissionList,
  useViewerUserId,
  useOwnAvatarTint,
  profileIdentityLine,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { BIRTHDAY_COPY, can, formatBirthday } from "@repo/validation";
import {
  PROFILE_PHOTO_SIZE,
  ProfilePhoto,
} from "@/components/profile/profile-photo";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { useAuthSession } from "@/lib/auth-session";
import { selectMemberDetail } from "@/lib/directory/member-detail";
import { usePledgeClassRows } from "@/lib/directory/pledge-class";
import { type ViewerProfile } from "@/lib/more/profile";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * The member's own profile, drawn on the You tab (#3839): what was s15, the
 * pushed Profile screen, before the tab took it in. The head (photo, name and
 * the line under it) opens the tab; Details and Bio close it, under the hub's
 * rows.
 *
 * ## No stat cards (#5281)
 *
 * Canvas draws three cards under the name: points, service hours and "96%
 * attendance". The phone drew the first two until 2026-11-17, when Paul took
 * them off: "everybody will have zero service hours like most of the
 * semester", and the points card was "a lot of space just to say 0 points
 * ... Points is not the end-all be-all of this app". Points is now a quiet
 * figure at the top right of the screen (`PointsLabel`, the You tab's
 * `headerAction`), and service hours the trailing value of the Service hours
 * row, the way Study hours carries its week. Both say nothing at zero.
 * Attendance was never built: no member-readable rate exists
 * (`POST /v1/reports/attendance` is a chapter-wide `reports:export` report
 * with no per-member filter).
 *
 * ## The detail rows
 *
 * Canvas draws Email, Phone, Pledge class and Big brother. No big-brother
 * column exists, so that one is omitted. The rows are Email, Phone (#3711),
 * four more of the fields the API's `UpdateUserDto` lets a member edit
 * (major, graduation year, city, company), and after Graduation the member's
 * pledge class and order number (#3939), which live on the membership and are
 * drawn only when an officer has set them. Display name heads the screen and
 * bio gets its own card.
 *
 * ## Editing
 *
 * Tap what you want to change (#3711, Paul 2026-11-07: "The pencil button
 * isn't obvious; drop it"). Your name, the bio card, and every row that is
 * yours to set (Phone, Major, Graduation, City, Company, and Bio while it is
 * empty) call `onEdit`, which opens `EditProfileSheet` (#3387). Email is the
 * account's address and the pledge class rows are an officer's, so those
 * don't. The photo edits in place (#732): `ProfilePhoto` picks, uploads and
 * confirms it. The screen draws these only once the profile has loaded,
 * because a sheet opened on the loading or error state would prefill blanks
 * over fields already set.
 */

/** Photo, name and the line under it. */
export function ProfileHead({
  profile,
  onEdit,
}: {
  profile: ViewerProfile | null;
  onEdit: () => void;
}) {
  const { tokens } = useFrappTheme();
  // Your initials wear the color the chapter sees on them (#3860).
  const ownTint = useOwnAvatarTint();
  const styles = createStyles(tokens);
  const userQuery = useCurrentUser();
  const identityMeta = profile
    ? profileIdentityLine({
        major: profile.major,
        company: profile.currentCompany,
        graduationYear: profile.graduationYear,
      })
    : null;
  return (
    <>
      <View style={styles.identity}>
        <ProfilePhoto
          photoUrl={profile?.photoUrl ?? null}
          fetchedAt={userQuery.dataUpdatedAt}
          initials={profile?.initials ?? "?"}
          avatarTint={ownTint}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Edits your profile"
          onPress={onEdit}
          hitSlop={8}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text style={styles.name}>
            {profile?.displayName ?? "Your profile"}
          </Text>
        </Pressable>
        {identityMeta ? (
          <Text style={styles.identityMeta}>{identityMeta}</Text>
        ) : null}
      </View>
    </>
  );
}

/**
 * The member's points at the top right of the You tab (#5281, Paul
 * 2026-11-17: "maybe put it in the top right ... It doesn't need to be the
 * most prominent thing"). Plain text in the muted foreground, never the
 * chapter accent (foundations.md §6: a number is not an accent), and nothing
 * at all while the balance is unknown or zero, the way the Study and Service
 * rows say nothing at zero.
 */
export function PointsLabel({ points }: { points: number | null }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (points === null || points === 0) return null;
  const label = `${points.toLocaleString()} ${points === 1 ? "pt" : "pts"}`;
  return (
    <Text
      style={styles.points}
      accessibilityLabel={`${points.toLocaleString()} ${points === 1 ? "point" : "points"}`}
      testID="you-points"
    >
      {label}
    </Text>
  );
}

/** Details, then Bio when there is one. */
export function ProfileDetails({
  profile,
  onEdit,
}: {
  profile: ViewerProfile | null;
  onEdit: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { email: sessionEmail } = useAuthSession();
  const viewerUserId = useViewerUserId();
  // The viewer's pledge class and order number (#3939) live on their member
  // profile, not on `/v1/users/me`. Each row is drawn only when set, unlike
  // the "Not set" rows below: those are the member's own to fill in, and
  // these are an officer's, so an empty one would be a row the member can do
  // nothing about, in a chapter that may keep neither.
  //
  // That read and the class list both take `members:view`, the Directory's
  // gate, so a viewer without it is not asked for either (an empty id leaves
  // the query off) and sees neither row, as they see no Directory.
  const canViewMembers = can("members:view", usePermissionList());
  const memberQuery = useMemberByUserId(
    canViewMembers ? (viewerUserId ?? "") : "",
  );
  const membership = useMemo(
    () => selectMemberDetail(memberQuery.data),
    [memberQuery.data],
  );
  const classRows = usePledgeClassRows(membership);
  // The session's email is the one value available before `/v1/users/me`
  // resolves, and it is the same address — so the row never sits blank while
  // the profile loads.
  const email = profile?.email ?? sessionEmail ?? null;

  return (
    <>
      <SectionHeader>Details</SectionHeader>
      <ListSection>
        <ListRow variant="detail" label="Email" value={email ?? "Not set"} />
        <ListRow
          variant="detail"
          label="Phone"
          value={profile?.phone ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        <ListRow
          variant="detail"
          label={BIRTHDAY_COPY.label}
          value={ownBirthdayLabel(profile)}
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        <ListRow
          variant="detail"
          label="Major"
          value={profile?.major ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        <ListRow
          variant="detail"
          label="Graduation"
          value={
            profile?.graduationYear ? String(profile.graduationYear) : "Not set"
          }
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        {classRows.map((row) => (
          <ListRow
            key={row.key}
            variant="detail"
            label={row.label}
            value={row.value}
          />
        ))}
        <ListRow
          variant="detail"
          label="City"
          value={profile?.currentCity ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        <ListRow
          variant="detail"
          label="Company"
          value={profile?.currentCompany ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={onEdit}
        />
        {profile?.bio ? null : (
          <ListRow
            variant="detail"
            label="Bio"
            value="Not set"
            accessibilityHint={EDIT_HINT}
            onPress={onEdit}
          />
        )}
      </ListSection>

      {profile?.bio ? (
        <>
          <SectionHeader>Bio</SectionHeader>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={EDIT_HINT}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.bioCard,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.bioText}>{profile.bio}</Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

/** What a screen reader hears on every row a tap edits. */
const EDIT_HINT = "Opens a sheet to edit your profile";

/**
 * The head's loading state, on the loaded head's own styles: the photo's
 * circle with the name and meta lines under it. The
 * You tab draws its rows under it at once, since none of them waits on the
 * profile, and Details only once the profile has loaded.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function ProfileSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, headline } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading your profile" style={styles.skeletonStack}>
      <View style={styles.identity}>
        <SkeletonBlock
          width={PROFILE_PHOTO_SIZE}
          height={PROFILE_PHOTO_SIZE}
          radius={avatarRadius(PROFILE_PHOTO_SIZE)}
        />
        <SkeletonText role={headline} width="44%" />
        <SkeletonText role={caption} width="30%" />
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    // `ScreenShell`'s gap, which spaces the loaded screen's blocks.
    skeletonStack: {
      gap: tokens.spacing.md,
    },
    identity: {
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.md,
    },
    name: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    identityMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    points: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    bioCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.lg,
    },
    bioText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}

/**
 * Your birthday as "March 4", and who sees it (#4959), so the row answers
 * both questions a member has about it without opening the editor.
 */
function ownBirthdayLabel(profile: ViewerProfile | null | undefined): string {
  if (profile?.birthdayMonth == null || profile.birthdayDay == null) {
    return "Not set";
  }
  const day = formatBirthday(profile.birthdayMonth, profile.birthdayDay);
  return profile.birthdayVisibility === "chapter"
    ? day
    : `${day} · ${BIRTHDAY_COPY.visibility[profile.birthdayVisibility]}`;
}
