import { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
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
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import {
  PROFILE_PHOTO_SIZE,
  ProfilePhoto,
} from "@/components/profile/profile-photo";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { useAuthSession } from "@/lib/auth-session";
import { selectMemberDetail } from "@/lib/directory/member-detail";
import { usePledgeClassRows } from "@/lib/directory/pledge-class";
import { selectViewerProfile } from "@/lib/more/profile";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s15 — Profile (`canvas-screens.dc.html:497`).
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
 * empty) open `EditProfileSheet` (#3387). Email is the account's address and
 * the pledge class rows are an officer's, so those don't. The photo edits in
 * place (#732): `ProfilePhoto` picks, uploads and confirms it. The rows are
 * drawn only once the profile has loaded, because a sheet opened on the
 * loading or error state would prefill blanks over fields already set.
 */
export default function ProfileScreen() {
  const { tokens } = useFrappTheme();
  // Your initials wear the color the chapter sees on them (#3860).
  const ownTint = useOwnAvatarTint();
  const styles = createStyles(tokens);
  const { email: sessionEmail } = useAuthSession();

  const userQuery = useCurrentUser();
  const editSheetRef = useRef<BottomSheetModal>(null);
  const viewerUserId = useViewerUserId();
  // Points and approved service hours, read and summed as web's Profile does
  // them (`@repo/hooks` `profile-stats.ts`, #4137).
  const stats = useMyProfileStats();

  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  // The viewer's pledge class and order number (#3939) live on their member
  // profile, not on `/v1/users/me`. Each row is drawn only when set, unlike
  // the "Not set" rows below: those are the member's own to fill in under
  // Edit, and these are an officer's, so an empty one would be a row the
  // member can do nothing about, in a chapter that may keep neither.
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

  // The session's email is the one value available before `/v1/users/me`
  // resolves, and it is the same address — so the row never sits blank while
  // the profile loads.
  const email = profile?.email ?? sessionEmail ?? null;
  const openEditor = () => editSheetRef.current?.present();

  if (userQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_MORE} title="Profile">
        <ProfileSkeleton />
      </ScreenShell>
    );
  }

  // Only an error with nothing cached. TanStack keeps `data` through a failed
  // background refetch (a return to the app refetches a stale profile), and
  // bare `isError` would swap in this state over the Edit sheet and drop what
  // was typed. The web panel has the same guard (`profile-panel.tsx`).
  if (userQuery.isError && userQuery.data === undefined) {
    return (
      <ScreenShell back={BACK_TO_MORE} title="Profile">
        <ErrorState
          title="Couldn't load your profile"
          body="You're signed in, but we couldn't reach the server."
          onRetry={() => void userQuery.refetch()}
          isRetrying={userQuery.isFetching}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell back={BACK_TO_MORE} title="Profile">
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
          onPress={openEditor}
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
              Choose a chapter from More → Switch chapter to see your points.
            </Text>
          ) : statsNote ? (
            <Text style={styles.statNote}>{statsNote}</Text>
          ) : null}
        </>
      ) : null}

      <SectionHeader>Details</SectionHeader>
      <ListSection>
        <ListRow variant="detail" label="Email" value={email ?? "Not set"} />
        <ListRow
          variant="detail"
          label="Phone"
          value={profile?.phone ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={openEditor}
        />
        <ListRow
          variant="detail"
          label="Major"
          value={profile?.major ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={openEditor}
        />
        <ListRow
          variant="detail"
          label="Graduation"
          value={
            profile?.graduationYear ? String(profile.graduationYear) : "Not set"
          }
          accessibilityHint={EDIT_HINT}
          onPress={openEditor}
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
          onPress={openEditor}
        />
        <ListRow
          variant="detail"
          label="Company"
          value={profile?.currentCompany ?? "Not set"}
          accessibilityHint={EDIT_HINT}
          onPress={openEditor}
        />
        {profile?.bio ? null : (
          <ListRow
            variant="detail"
            label="Bio"
            value="Not set"
            accessibilityHint={EDIT_HINT}
            onPress={openEditor}
          />
        )}
      </ListSection>

      {profile?.bio ? (
        <>
          <SectionHeader>Bio</SectionHeader>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={EDIT_HINT}
            onPress={openEditor}
            style={({ pressed }) => [
              styles.bioCard,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.bioText}>{profile.bio}</Text>
          </Pressable>
        </>
      ) : null}

      <EditProfileSheet ref={editSheetRef} profile={profile} />
    </ScreenShell>
  );
}

/** What a screen reader hears on every row a tap edits. */
const EDIT_HINT = "Opens a sheet to edit your profile";

/**
 * The Details rows every profile draws: Email, Phone, Major, Graduation,
 * City, Company. The pledge class and order number rows are left out of the
 * count: most members have neither, and they arrive with a second read. So
 * is the empty-bio row, which most members' profiles don't draw.
 */
const DETAIL_ROWS = 6;

/**
 * The screen's loading state, on the loaded screen's own styles: the photo's
 * circle with the name and meta lines under it, the two stat cards, and the
 * Details list. The Details caption is fixed text, so it is drawn as itself.
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

      <SectionHeader>Details</SectionHeader>
      <ListSection>
        {Array.from({ length: DETAIL_ROWS }, (_, index) => (
          <ListRowSkeleton key={index} index={index} variant="detail" />
        ))}
      </ListSection>
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
