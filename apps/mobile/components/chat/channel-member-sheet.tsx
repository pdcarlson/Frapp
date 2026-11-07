import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import {
  MEMBER_SEARCH_THRESHOLD,
  filterChannelMembers,
  groupChannelMembersByRole,
  memberLabel,
  useChannelMembers,
  useMemberDisplayNames,
} from "@repo/hooks";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { initialsFor } from "@/lib/chat/display-name";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
} from "@/components/state-block";
import { NavGlyph } from "@/components/nav-glyph";
import {
  SectionHeader,
  SectionHeaderSkeleton,
} from "@/components/list-section";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";

/**
 * Who can read the open channel (#3536), as a tall sheet from the thread
 * header: the mobile face of web's member column
 * (`apps/web/components/chat/channel-member-list.tsx`), from the same read
 * (`GET /v1/channels/{id}/members`), in the same role groups
 * (`groupChannelMembersByRole`) and with the same search past
 * `MEMBER_SEARCH_THRESHOLD` readers.
 *
 * **No presence.** Mobile does not join the chapter presence topic
 * (`spec/behavior/chat/README.md` § Online/offline presence), so rows carry
 * no dot, and no member is called Offline on the strength of a join this app
 * never made.
 *
 * Read-only rows, as on web: nothing here is a control yet, so a row is 32pt
 * rather than the 44pt touch floor (`components.md` § Chat member list).
 *
 * The reads live in {@link MemberRows}, a child of the modal, because gorhom
 * mounts a modal's children only while it is presented: the list is fetched
 * when the sheet opens, never by a thread nobody asked it of.
 */
export interface ChannelMemberSheetProps {
  channelId: string | null;
}

export const ChannelMemberSheet = forwardRef<
  BottomSheetModal,
  ChannelMemberSheetProps
>(function ChannelMemberSheet({ channelId }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();

  return (
    <BottomSheetModal
      ref={ref}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader title="Members" onClose={closeSheet} />
        </View>
        <MemberRows channelId={channelId} />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

/**
 * The thread header's trigger for the sheet: the Directory glyph, web's
 * members toggle (`iconography.md` §6.2.2), drawn at the ⋯ menu trigger's
 * geometry beside it (a 24pt glyph in a 44pt box) so the two header glyphs
 * line up. The glyph alone (`components.md` § Icon-only actions).
 */
export function ChannelMembersButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Members"
      accessibilityHint="Shows who can read this channel."
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed ? styles.pressed : null]}
    >
      <NavGlyph
        paths={NAV_GLYPHS.directory}
        color={tokens.color.text.foreground}
        size={24}
      />
    </Pressable>
  );
}

export interface ChannelMemberSheetRow {
  userId: string;
  name: string;
  roleColor: string | null;
  roleRank: number | null;
  roleId: string | null;
  roleName: string | null;
}

export function MemberRows({ channelId }: { channelId: string | null }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const membersQuery = useChannelMembers(channelId);
  const roster = useMemberDisplayNames();
  const { byId, roleColorFor } = roster;

  const [query, setQuery] = useState("");

  const rows = useMemo<ChannelMemberSheetRow[]>(
    () =>
      (membersQuery.data ?? []).map((member) => ({
        userId: member.user_id,
        // `memberLabel`, never a drop: a member who never set a name still
        // reads the channel, so they are listed as "Member 2f4a1c" (#2422).
        name: memberLabel(byId[member.user_id], member.user_id),
        roleColor: roleColorFor(member.user_id),
        roleRank: member.role_rank,
        roleId: member.role_id ?? null,
        roleName: member.role_name ?? null,
      })),
    [membersQuery.data, byId, roleColorFor],
  );
  const searchable = rows.length > MEMBER_SEARCH_THRESHOLD;
  const trimmed = searchable ? query.trim() : "";
  const groups = useMemo(
    () => groupChannelMembersByRole(filterChannelMembers(rows, trimmed)),
    [rows, trimmed],
  );

  // Names come from the roster, so a list without them isn't ready either.
  // A read fails the sheet only when it has nothing to draw: TanStack keeps
  // the last good data through a failed refetch, and a list the member just
  // saw shouldn't turn into an error on a background blip (the rule
  // `member-detail-sheet.tsx` follows). Retry reruns only what failed, and is
  // busy while that read is in flight.
  const membersFailed = membersQuery.isError && membersQuery.data === undefined;
  const rosterFailed = roster.isError && !roster.hasData;
  if (membersFailed || rosterFailed) {
    return (
      <ErrorState
        title="Couldn't load members"
        body="The list of who can read this channel couldn't reach the server."
        onRetry={() => {
          if (membersFailed) void membersQuery.refetch();
          if (rosterFailed) roster.refetch();
        }}
        isRetrying={
          (membersFailed && membersQuery.isFetching) ||
          (rosterFailed && roster.isFetching)
        }
      />
    );
  }
  if (!channelId || membersQuery.isPending || roster.isPending) {
    return <MemberRowsSkeleton />;
  }

  return (
    <View>
      {searchable ? (
        <BottomSheetTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${rows.length} members`}
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Search members"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={styles.search}
        />
      ) : null}
      {groups.length === 0 && trimmed ? (
        <Text style={styles.noMatch} accessibilityLiveRegion="polite">
          {`No one named \u201c${trimmed}\u201d`}
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.key}>
            <SectionHeader>{`${group.label} ${group.rows.length}`}</SectionHeader>
            {group.rows.map((row) => (
              <View
                key={row.userId}
                style={styles.row}
                accessible
                accessibilityLabel={row.name}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsFor(row.name)}</Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.name,
                    row.roleColor ? { color: row.roleColor } : null,
                  ]}
                >
                  {row.name}
                </Text>
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

const SKELETON_NAME_WIDTHS = [
  "45%",
  "60%",
  "38%",
  "52%",
  "44%",
  "30%",
] as const;

/**
 * The list's own shape while it loads: the count caption, then rows on the
 * row's geometry (a 24pt circle and a name bar), so the names land in place
 * (components.md §10), as web's column skeleton draws them.
 */
function MemberRowsSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <SkeletonRegion label="Loading members">
      <SectionHeaderSkeleton />
      {SKELETON_NAME_WIDTHS.map((width, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            radius={avatarRadius(AVATAR_SIZE)}
          />
          <SkeletonBlock width={width} height={tokens.spacing.md} />
        </View>
      ))}
    </SkeletonRegion>
  );
}

/** 32pt rows with a 24pt avatar: web's numbers, Paul's for this list. */
const ROW_HEIGHT = 32;
const AVATAR_SIZE = 24;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    trigger: {
      minHeight: 44,
      minWidth: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
    scroll: {
      flex: 1,
    },
    stickyHeader: {
      // Sticky, so it paints the sheet's own fill over the rows passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    row: {
      height: ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    search: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    noMatch: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      paddingVertical: tokens.spacing.lg,
    },
    // Role color or the foreground, never the chapter accent
    // (foundations.md §6), as the timeline paints the same names.
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
  });
}
