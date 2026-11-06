import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  useBlockedUserIds,
  useCustomRoles,
  useGetOrCreateDm,
  useMember,
  usePermissionList,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { can } from "@repo/validation";
import {
  BLOCK_ROW_DESCRIPTION,
  confirmBlockMember,
  confirmUnblockMember,
  UNBLOCK_ROW_DESCRIPTION,
  useBlockActions,
} from "@/lib/chat/block-actions";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { ErrorState, SkeletonLines } from "@/components/state-block";
import {
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useTallSheetProps,
  SheetBackToClose,
  useSheetClose,
} from "@/components/sheet-scaffold";
import {
  resolveCustomRoleNames,
  resolveRoleNames,
  selectMemberDetail,
} from "@/lib/directory/member-detail";
import {
  dmChannelIdOf,
  messageRowDescription,
  messageRowState,
  otherRealMemberId,
  START_DM_FAILED_BODY,
  startDmFailedTitle,
} from "@/lib/directory/start-dm";

/**
 * s13 member profile detail — a sheet, not a route, per the issue's own scope
 * note: `app/(tabs)/_layout.tsx` is frozen and a new `Tabs.Screen` needs a
 * backing file, so this reaches the fields `spec/behavior/members.md`'s
 * detail view specifies (name, email, role, joined date) without one.
 *
 * **No point balance.** `GET /v1/points/members/{userId}` requires the
 * officer-only `points:view_all`, which most viewers of this sheet — any
 * ordinary member tapping a directory row — do not hold. Rather than gating
 * a row on a permission most viewers will silently fail, it is omitted here,
 * the same "omit, don't fake" call `profile.tsx` makes for the drawn
 * attendance stat no member can read.
 *
 * **Message** (#2773) opens a 1:1 DM with the member, or the one you already
 * have. It comes before the profile's details because starting a DM is the
 * thing a member most often opens a profile to do. Who it is offered for is
 * `spec/ui/mobile/screens.md` s13's rule, implemented in
 * `lib/directory/start-dm.ts`.
 *
 * **Block / Unblock** (#2257) sits at the foot of another member's profile,
 * because the directory is where a member you have blocked is still listed and
 * so where you would look for them.
 *
 * ## A tall sheet
 *
 * It opens at full height (`useTallSheetProps`,
 * `spec/ui/design-system/components.md` § Surface size): it holds a whole
 * profile, and the 65% box it used to open in cut the bio and Block off below
 * the fold. No "Member" title and no "Done": the member's name heads the
 * body, and the header's X closes it.
 *
 * ## Fixed snap points, not `enableDynamicSizing`
 *
 * A bio has no length cap (the API's `UpdateUserDto` bounds none of its
 * free-text fields), custom fields are chapter-configurable and unbounded in count, and role
 * names can stack up — the same "grows without bound" shape `ask-sheet.tsx`
 * documents for why it does not use dynamic sizing. `BottomSheetScrollView`
 * is a **direct child** of the modal for the reason `new-task-sheet.tsx`
 * spells out at its second modal: nested inside a `BottomSheetView`, the view
 * and the scrollable write competing heights to the same animated value.
 */
export interface MemberDetailSheetProps {
  /**
   * The tapped row's ids, or `null` while no row is selected; the sheet stays
   * mounted regardless. The profile is fetched by `memberId` (the route takes
   * the member row's id) and the stale-DM guard keys on `userId`.
   */
  member: { memberId: string; userId: string } | null;
  onDismiss?: () => void;
}

export const MemberDetailSheet = forwardRef<
  BottomSheetModal,
  MemberDetailSheetProps
>(function MemberDetailSheet({ member, onDismiss }, ref) {
  const userId = member?.userId ?? null;
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();

  // `useMember` is already `enabled: !!id`, so this stays idle until a row is
  // actually tapped rather than firing for every mounted-but-closed sheet.
  const memberQuery = useMember(member?.memberId ?? "");
  const rolesQuery = useRoles();

  // Custom roles (`chapter_custom_roles` — chapter-specific titles like
  // "Rush Chair", distinct from the seven seeded system roles `useRoles`
  // returns) need `chapter-config:view` to list, same gate `preferences.tsx`
  // already applies for its Chapter · Admin section. A viewer who lacks it
  // simply doesn't get custom-role names resolved, rather than firing a
  // request that comes back 403.
  const permissions = usePermissionList();
  const canViewCustomRoles = can("chapter-config:view", permissions);
  const customRolesQuery = useCustomRoles({ enabled: canViewCustomRoles });

  const detail = useMemo(
    () => selectMemberDetail(memberQuery.data),
    [memberQuery.data],
  );
  const roleNames = useMemo(
    () => resolveRoleNames(rolesQuery.data, detail?.roleIds ?? []),
    [rolesQuery.data, detail?.roleIds],
  );
  const customRoleNames = useMemo(
    () =>
      resolveCustomRoleNames(
        canViewCustomRoles ? customRolesQuery.data : undefined,
        detail?.customRoleIds ?? [],
      ),
    [canViewCustomRoles, customRolesQuery.data, detail?.customRoleIds],
  );
  const allRoleNames = [...roleNames, ...customRoleNames];
  // Distinct from "no role" (`[]` once both reads have settled): while either
  // read is still in flight, an empty list would otherwise flash a wrong
  // "—" that then flips to the real value a moment later.
  const rolesStillLoading =
    rolesQuery.isPending || (canViewCustomRoles && customRolesQuery.isPending);

  // Block/Unblock (#2257). The spec keeps a blocked member in the directory —
  // blocking is a chat control, not a membership one — so this is also where
  // someone you have blocked can be found and unblocked. Never on your own
  // profile (the API refuses a self-block) or the system actor's.
  const viewerUserId = useViewerUserId();
  const blockList = useBlockedUserIds();
  const blockActions = useBlockActions();
  const otherMemberId = otherRealMemberId(detail?.userId ?? null, viewerUserId);
  const blockTarget = detail && otherMemberId ? detail : null;
  // Read off the floor: an id on any list the server returned is blocked. A
  // list that has not loaded offers Block, which the API treats idempotently.
  const isBlocked = blockTarget ? blockList.ids.has(blockTarget.userId) : false;

  const router = useRouter();
  // Not waiting on the channel-list refetch: chat home observes it and picks
  // the DM up when it lands, and a refetch that fails offline would otherwise
  // hold this request pending until the app is back online.
  const dmMutation = useGetOrCreateDm({ awaitRefetch: false });
  const messageRow = messageRowState({ memberId: otherMemberId, blockList });
  // Every member a DM request is in flight for. The ref closes a double tap
  // inside one render (both taps would otherwise read the same state and send
  // twice, and the API's find-then-create can make two DMs for one pair, #2788);
  // the state disables those members' rows only. It is a set because the sheet
  // can move to another member and start a second request while the first is
  // still out, and neither may re-enable the other's row.
  const dmInFlightRef = useRef(new Set<string>());
  const [dmPending, setDmPending] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The sheet stays mounted and swaps `userId` as directory rows are tapped,
  // so a slow DM request for one member can resolve after the sheet has moved
  // to another. The ref lets that continuation see it is stale rather than
  // opening the wrong conversation (web's member sheet does the same).
  const openUserIdRef = useRef(userId);
  useEffect(() => {
    openUserIdRef.current = userId;
  }, [userId]);

  async function startDm(memberUserId: string, name: string) {
    if (dmInFlightRef.current.has(memberUserId)) return;
    dmInFlightRef.current.add(memberUserId);
    setDmPending(new Set(dmInFlightRef.current));
    try {
      const channelId = dmChannelIdOf(
        await dmMutation.mutateAsync({ member_id: memberUserId }),
      );
      if (openUserIdRef.current !== memberUserId) return;
      if (!channelId) throw new Error("No channel id returned");
      closeSheet();
      router.push({ pathname: "/chat-thread", params: { channelId } });
    } catch {
      if (openUserIdRef.current !== memberUserId) return;
      Alert.alert(startDmFailedTitle(name), START_DM_FAILED_BODY);
    } finally {
      dmInFlightRef.current.delete(memberUserId);
      setDmPending(new Set(dmInFlightRef.current));
    }
  }

  return (
    <BottomSheetModal
      ref={ref}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onDismiss}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        // The X stays pinned while a long profile scrolls under it: at full
        // height there is no scrim to tap, and the grabber scrolls away too.
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader onClose={closeSheet} />
        </View>

        {memberQuery.isPending ? (
          <SkeletonLines lines={4} showTile tone="list" />
        ) : null}

        {/* A cached member still renders through a background-refetch
            failure (TanStack keeps `data` on an errored refetch) — the error
            only takes over when there is nothing else to show, so a stale
            card is never buried under a contradictory "couldn't load"
            banner. */}
        {memberQuery.isError && !detail ? (
          <ErrorState
            title="Couldn't load this member"
            body="Their profile couldn't reach the server."
            onRetry={() => void memberQuery.refetch()}
            isRetrying={memberQuery.isFetching}
          />
        ) : null}

        {!detail && memberQuery.isSuccess ? (
          <ErrorState
            title="Couldn't read this member"
            body="Their profile came back in a shape this app doesn't recognize."
            onRetry={() => void memberQuery.refetch()}
            isRetrying={memberQuery.isFetching}
          />
        ) : null}

        {detail ? (
          <>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{detail.initials}</Text>
              </View>
              <Text style={styles.name}>{detail.displayName}</Text>
              {detail.meta ? (
                <Text style={styles.meta}>{detail.meta}</Text>
              ) : null}
            </View>

            {messageRow.kind !== "hidden" ? (
              <ListSection>
                <ListRow
                  label="Message"
                  description={messageRowDescription(messageRow)}
                  // Busy while the DM opens, so the row keeps its look and
                  // shows a spinner; disabled only while the block list
                  // can't vouch for a DM yet, which is the row being
                  // unavailable rather than working.
                  busy={
                    messageRow.kind === "ready" && dmPending.has(detail.userId)
                  }
                  disabled={
                    messageRow.kind !== "ready" && messageRow.kind !== "retry"
                  }
                  onPress={() => {
                    if (messageRow.kind === "retry") blockList.retry();
                    else void startDm(detail.userId, detail.displayName);
                  }}
                />
              </ListSection>
            ) : null}

            <ListSection>
              <ListRow
                variant="detail"
                label="Email"
                value={detail.email ?? "Not set"}
              />
              <ListRow
                variant="detail"
                label="Role"
                value={
                  rolesStillLoading
                    ? "Loading…"
                    : allRoleNames.length > 0
                      ? allRoleNames.join(", ")
                      : "—"
                }
              />
              <ListRow
                variant="detail"
                label="Joined"
                value={detail.joinedLabel ?? "—"}
              />
            </ListSection>

            {detail.customFields.length > 0 ? (
              <>
                <SectionHeader>Custom fields</SectionHeader>
                <ListSection>
                  {detail.customFields.map((field) => (
                    <ListRow
                      key={field.fieldId}
                      variant="detail"
                      label={field.label}
                      value={field.value}
                    />
                  ))}
                </ListSection>
              </>
            ) : null}

            {detail.bio ? (
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>{detail.bio}</Text>
              </View>
            ) : null}

            {blockTarget ? (
              <ListSection>
                {isBlocked ? (
                  <ListRow
                    label={`Unblock ${blockTarget.displayName}`}
                    description={UNBLOCK_ROW_DESCRIPTION}
                    action
                    disabled={blockActions.isPending}
                    onPress={() =>
                      confirmUnblockMember({
                        name: blockTarget.displayName,
                        run: () => blockActions.unblock(blockTarget.userId),
                      })
                    }
                  />
                ) : (
                  <ListRow
                    label={`Block ${blockTarget.displayName}`}
                    description={BLOCK_ROW_DESCRIPTION}
                    action
                    destructive
                    disabled={blockActions.isPending}
                    onPress={() =>
                      confirmBlockMember({
                        name: blockTarget.displayName,
                        // Listed in the directory: that is where this is.
                        inDirectory: true,
                        run: () => blockActions.block(blockTarget.userId),
                      })
                    }
                  />
                )}
              </ListSection>
            ) : null}
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  const avatarSize = 64;
  return StyleSheet.create({
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
      gap: tokens.spacing.md,
    },
    identity: {
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
    },
    avatar: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarRadius(avatarSize),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.mutedForeground,
    },
    name: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    bioCard: {
      // The ListSection recipe beside it, as Profile's own bio card draws it.
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
  });
}
