import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useCurrentUser,
  useMemberByUserId,
  useMyProfileStats,
  usePermissionList,
  useViewerUserId,
  useOwnAvatarTint,
  profileIdentityLine,
  profileStatsErrorNote,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import {
  PROFILE_PHOTO_SIZE,
  ProfilePhoto,
} from "@/components/profile/profile-photo";
import {
  ListRow,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
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

/**
 * The member's own profile, drawn on the You tab (#3839): what was s15, the
 * pushed Profile screen, before the tab took it in. The head (photo, name,
 * the line under it, and the points and service-hours cards) opens the tab;
 * Details and Bio close it, under the hub's rows.
 *
 * ## Two stat cards, not three
 *
 * Canvas draws points, service hours, and "96% attendance". The third is not
 * built and is not buildable by a member: `POST /v1/reports/attendance` is a
 * chapter-wide report generator gated on `reports:export`, its rows carry
 * `member_name` and no `user_id`, it takes no per-member filter, and there is
 * no denominator of events a member owed. `spec/ui/mobile/screens.md` also
 * records that reports stay web-only. Filed rather than invented.
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

/** Photo, name, the line under it, and the two stat cards. */
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
  // Points and approved service hours, read and summed as web's Profile does
  // them (`@repo/hooks` `profile-stats.ts`, #4137).
  const stats = useMyProfileStats();
  const identityMeta = profile
    ? profileIdentityLine({
        major: profile.major,
        company: profile.currentCompany,
        graduationYear: profile.graduationYear,
      })
    : null;
  const statsNote = profileStatsErrorNote(
    stats.pointsFailed,
    stats.serviceFailed,
  );

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

      {stats.visible ? (
        <>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              {/* Both stats in the foreground text: a number is never the chapter
              accent (foundations.md §6, "Where the accent goes"). */}
              <Text style={styles.statValue}>
                {stats.points === null ? "—" : stats.points.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>points</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.serviceHours ?? "—"}</Text>
              <Text style={styles.statLabel}>service hrs</Text>
            </View>
          </View>

          {!stats.hasChapter ? (
            // Points are chapter-scoped, so without one the card would sit on a
            // dash forever with nothing explaining why. The claim is absent until
            // a membership exists (and during a hook-off incident), so this is
            // the empty-prod case rather than an edge one.
            <Text style={styles.statNote}>
              Your points show here once you&apos;re in a chapter.
            </Text>
          ) : statsNote ? (
            <Text style={styles.statNote}>{statsNote}</Text>
          ) : null}
        </>
      ) : null}
    </>
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
 * circle with the name and meta lines under it, and the two stat cards. The
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

      <View style={styles.statRow}>
        {[0, 1].map((index) => (
          <View key={index} style={styles.statCard}>
            <SkeletonText role={headline} width="36%" />
            <SkeletonText role={caption} width="48%" />
          </View>
        ))}
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
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
    statRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    statCard: {
      flex: 1,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      // The Details list's tone (`card`, as every grouped list since
      // 2026-11-05), as s15 draws both in one.
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    statValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    statLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    statNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.xs,
    },
    bioCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
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
