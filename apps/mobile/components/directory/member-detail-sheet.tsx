import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  useBlockedUserIds,
  useGetOrCreateDm,
  useMemberByUserId,
  useMemberDisplayNames,
  usePermissionList,
  useRemoveMember,
  groupsOfMember,
  useGroups,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { can, resolveRoleChips, roleColorOrNull } from "@repo/validation";
import { usePledgeClassRows } from "@/lib/directory/pledge-class";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusDot } from "@/components/account/status-dot";
import { presenceLabel } from "@repo/hooks/presence-status";
import { useChapterPresence } from "@/lib/presence/presence-store";
import {
  confirmBlockMember,
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { ListRow, ListSection } from "@/components/list-section";
import { useChapterBranding } from "@/lib/chapter-branding";
import { ErrorState, SkeletonLines } from "@/components/state-block";
import {
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useTallSheetProps,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { selectMemberDetail } from "@/lib/directory/member-detail";
import { parseRoleOptions } from "@/lib/directory/role-editor";
import {
  MemberRolesSheet,
  type MemberRolesSession,
} from "@/components/directory/member-roles-sheet";
import {
  MemberClassSheet,
  type MemberClassSession,
} from "@/components/directory/member-class-sheet";
import {
  MemberCorrectionSheet,
  type MemberCorrectionSession,
} from "@/components/directory/member-correction-sheet";
import { showPhoneActions } from "@/lib/directory/phone-actions";
import {
  confirmRemoveMember,
  memberMenuActions,
  showMemberMenu,
} from "@/lib/directory/member-menu";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  memberMenuButtonLabel,
  removeFailedTitle,
} from "@repo/hooks/member-removal-copy";
import { IconButton, ICON_BUTTON_SIZE } from "@/components/icon-button";
import { OverflowGlyph } from "@/components/chat/overflow-glyph";
import { dmChannelIdOf } from "@repo/hooks";
import {
  messageRowDescription,
  messageRowState,
  otherRealMemberId,
  START_DM_FAILED_BODY,
  startDmFailedTitle,
} from "@/lib/directory/start-dm";

/**
 * A member's profile — a sheet, not a route, per s13's own scope
 * note: the route layouts are frozen (`spec/ui/mobile/navigation.md`
 * § Hotspot freeze), so this reaches the fields `spec/behavior/members.md`'s
 * detail view specifies (name, email, role, joined date) without one.
 *
 * **No point balance.** `GET /v1/points/members/{userId}` requires the
 * officer-only `points:view_all`, which most viewers of this sheet — any
 * ordinary member tapping a directory row — do not hold. Rather than gating
 * a row on a permission most viewers will silently fail, it is omitted here,
 * the same "omit, don't fake" call `profile.tsx` makes for the drawn
 * attendance stat no member can read.
 *
 * **One profile, every door.** The directory row, a sender's name or photo in
 * chat, and an `@mention` all open this same sheet, keyed by `users.id` (the
 * id chat carries), so a member sees the same card wherever they tap a name.
 * It leads with what an everyday member opens a profile for: who this is
 * (photo, name, grad year), a way to reach them (Message, then phone and
 * email), and their roles; officer controls ride the same rows rather than a
 * separate screen.
 *
 * **A contact card first** (#3711). Phone, email and member since sit right
 * under Message, before roles (Evan, 2026-11-10: "Contact info in the
 * profile"). The phone is the member's own (s15's Edit sheet); a tap offers
 * Call or Text, as a number in Contacts does. The chapter's custom fields
 * (T-shirt size, dietary, emergency contact) are logistics, not why a profile
 * is opened, so they sit behind a More details row, folded on every member
 * (Shawn, 2026-11-09).
 *
 * **Message** (#2773) opens a 1:1 DM with the member, or the one you already
 * have. It is the sheet's one accent button, under the name, because starting
 * a DM is the thing a member most often opens a profile to do. Who it is offered for is
 * `spec/ui/mobile/screens.md` s13's rule, implemented in
 * `lib/directory/start-dm.ts`.
 *
 * **Roles** are chips in the chapter's rank order (`resolveRoleChips`), each
 * with its role color. A viewer holding `roles:manage` (the gate on
 * `PATCH /v1/members/{id}/roles`) gets Edit, which opens
 * {@link MemberRolesSheet}: the one role editor on mobile (Paul, 2026-11-07),
 * now reachable from chat too; for everyone else the chips are read-only.
 *
 * **Pledge class and order number** (#3939) show to everyone when set. The
 * same `roles:manage` holder, the officer `PUT /v1/pledge-classes/assignments`
 * lets set them, always sees both rows ("Not set" when unset) and taps either
 * to open {@link MemberClassSheet} (#3991), as web's profile sheet offers Edit
 * beside the role editor.
 *
 * **The `⋯` menu** beside the header's X holds what a viewer reaches for only
 * now and then (Paul, 2026-11-11: nobody opens a profile to remove someone).
 * Edit name and graduation year (#4367) opens {@link MemberCorrectionSheet}
 * for an officer the API says may fix them (`viewer_can_edit_profile`).
 * Block / Unblock (#2257) for another member, and Remove from chapter where
 * the API says this viewer may (`viewer_can_remove`: `members:remove`, not
 * their own profile, and the member ranks below them). Neither is offered on
 * your own profile, so there the `⋯` isn't drawn. Block sat at the foot of the
 * profile as a red row until then.
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
   * Whose profile, by `users.id`, or `null` while nobody is selected; the
   * sheet stays mounted regardless. The profile is read by user id
   * (`GET /v1/members/by-user/{userId}`), which also hands back the membership
   * id a role edit needs, so chat can open it with only a sender or mention id.
   */
  member: { userId: string } | null;
  onDismiss?: () => void;
  /**
   * The channel on screen under the sheet, when it is opened from a thread.
   * Message for the member whose DM this already is just closes the sheet,
   * rather than stacking a second copy of the same thread.
   */
  openChannelId?: string | null;
}

export const MemberDetailSheet = forwardRef<
  BottomSheetModal,
  MemberDetailSheetProps
>(function MemberDetailSheet({ member, onDismiss, openChannelId }, ref) {
  const userId = member?.userId ?? null;
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();

  // `useMemberByUserId` is already `enabled: !!userId`, so this stays idle until a row is
  // actually tapped rather than firing for every mounted-but-closed sheet.
  const memberQuery = useMemberByUserId(userId ?? "");
  // The same role-color resolution chat's name uses (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const { accent } = useChapterBranding();
  const rolesQuery = useRoles();
  // Their dot and custom line (#3917), off chapter presence: nothing until it
  // has synced, never a stand-in Offline.
  const presence = useChapterPresence();
  const status = presence.isReady && userId ? presence.statusOf(userId) : null;
  const statusLine =
    presence.isReady && userId ? presence.lineOf(userId) : null;

  const permissions = usePermissionList();

  const detail = useMemo(
    () => selectMemberDetail(memberQuery.data),
    [memberQuery.data],
  );
  const roleChips = useMemo(
    () => resolveRoleChips(rolesQuery.data, detail?.roleIds ?? []),
    [rolesQuery.data, detail?.roleIds],
  );
  const groupsQuery = useGroups({ enabled: !!userId });
  const memberGroups = useMemo(
    () => groupsOfMember(groupsQuery.data, userId),
    [groupsQuery.data, userId],
  );

  const canEditRoles = can("roles:manage", permissions);
  // The member's pledge class and order number (#3939): each drawn only when
  // set, except to an officer who sets them here (the same `roles:manage`).
  const canEditClass = canEditRoles && !!detail?.memberId;
  const classRows = usePledgeClassRows(detail, { canEdit: canEditClass });
  const classSheetRef = useRef<BottomSheetModal>(null);
  const [classSession, setClassSession] = useState<MemberClassSession | null>(
    null,
  );
  const roleOptions = useMemo(
    () => parseRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );
  const rolesSheetRef = useRef<BottomSheetModal>(null);
  const [rolesSession, setRolesSession] = useState<MemberRolesSession | null>(
    null,
  );
  const correctionSheetRef = useRef<BottomSheetModal>(null);
  const [correctionSession, setCorrectionSession] =
    useState<MemberCorrectionSession | null>(null);
  // Whose More details are open. Keyed by member, as the sheet swaps members
  // in place, so the custom fields start folded on every one.
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const detailsOpen = userId !== null && detailsUserId === userId;
  // Closing the sheet clears its member; fold the details then, so reopening
  // the same member starts folded too.
  if (userId === null && detailsUserId !== null) setDetailsUserId(null);
  // Distinct from "no role" (`[]` once the read has settled): while it is
  // still in flight, an empty list would otherwise flash a wrong "—" that
  // then flips to the real value a moment later.
  const rolesStillLoading = rolesQuery.isPending;

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

  const removeMutation = useRemoveMember();
  const menuActions = memberMenuActions({
    // The server's answer, as for removal below.
    canEdit:
      !!detail?.canEditProfile && !!detail.memberId && otherMemberId !== null,
    canBlock: blockTarget !== null,
    isBlocked,
    // The server's answer already excludes the viewer's own profile; the
    // `otherMemberId` check keeps it so if a cached read ever says otherwise.
    canRemove:
      !!detail?.canRemove && !!detail.memberId && otherMemberId !== null,
  });

  function openMenu() {
    if (!detail) return;
    const target = detail;
    showMemberMenu(target.displayName, menuActions, (action) => {
      if (action === "edit" && target.memberId) {
        setCorrectionSession({
          memberId: target.memberId,
          label: target.displayName,
          name: target.storedName,
          graduationYear: target.graduationYear,
        });
        correctionSheetRef.current?.present();
      } else if (action === "block") {
        confirmBlockMember({
          name: target.displayName,
          // Listed in the directory: that is where this is.
          inDirectory: true,
          run: () => blockActions.block(target.userId),
        });
      } else if (action === "unblock") {
        confirmUnblockMember({
          name: target.displayName,
          run: () => blockActions.unblock(target.userId),
        });
      } else if (action === "remove" && target.memberId) {
        const memberId = target.memberId;
        confirmRemoveMember({
          name: target.displayName,
          run: () => {
            removeMutation.mutate(memberId, {
              onSuccess: () => closeSheet(),
              onError: (error) =>
                Alert.alert(
                  removeFailedTitle(target.displayName),
                  errorCopy(error, "Try again in a moment.", {
                    // The route's refusals are sentences for members ("You
                    // can only remove members ranked below you.").
                    serverWritesForMembers: true,
                  }),
                ),
            });
          },
        });
      }
    });
  }

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
      if (channelId === openChannelId) return;
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
    <>
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
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
            <TallSheetHeader
              onClose={closeSheet}
              actions={
                detail && menuActions.length > 0 ? (
                  <IconButton
                    label={memberMenuButtonLabel(detail.displayName)}
                    onPress={openMenu}
                    // Held while a block or a removal is out, rather than
                    // dropping a row from the menu, so the ⋯ never jumps.
                    disabled={
                      blockActions.isPending || removeMutation.isPending
                    }
                  >
                    <OverflowGlyph
                      color={tokens.color.text.mutedForeground}
                      size={ICON_BUTTON_SIZE}
                    />
                  </IconButton>
                ) : null
              }
            />
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
                <View>
                  <MemberAvatar
                    uri={detail.avatarUrl}
                    initials={detail.initials}
                    size={DETAIL_AVATAR_SIZE}
                    tint={userId ? avatarTintFor(userId) : null}
                    style={styles.avatar}
                    textStyle={styles.avatarText}
                  />
                  {status ? (
                    <View pointerEvents="none" style={styles.presenceDot}>
                      <StatusDot
                        testID={`member-presence-${status}`}
                        status={status}
                        size={PRESENCE_DOT_SIZE}
                        ring={tokens.color.surface.popover}
                      />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={styles.name}
                  accessibilityRole="header"
                  accessibilityLabel={
                    status
                      ? `${detail.displayName}, ${presenceLabel(status)}`
                      : undefined
                  }
                >
                  {detail.displayName}
                </Text>
                {statusLine ? (
                  <Text style={styles.statusLine} numberOfLines={2}>
                    {statusLine}
                  </Text>
                ) : null}
                {detail.meta ? (
                  <Text style={styles.meta}>{detail.meta}</Text>
                ) : null}
              </View>

              {messageRow.kind !== "hidden" ? (
                <View style={styles.messageBlock}>
                  <SheetPrimaryButton
                    label="Message"
                    accent={accent}
                    onAccent={tokens.color.gold.onHouse}
                    // Busy while the DM opens; disabled only while the block
                    // list can't vouch for a DM yet.
                    busy={
                      messageRow.kind === "ready" &&
                      dmPending.has(detail.userId)
                    }
                    disabled={
                      messageRow.kind !== "ready" && messageRow.kind !== "retry"
                    }
                    accessibilityHint={
                      messageRowDescription(messageRow) ?? undefined
                    }
                    onPress={() => {
                      if (messageRow.kind === "retry") blockList.retry();
                      else void startDm(detail.userId, detail.displayName);
                    }}
                  />
                  {messageRowDescription(messageRow) ? (
                    <Text style={styles.messageNote}>
                      {messageRowDescription(messageRow)}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <ListSection>
                {detail.phone ? (
                  <ListRow
                    variant="detail"
                    label="Phone"
                    value={detail.phone}
                    accessibilityHint="Offers to call or text them"
                    onPress={() =>
                      showPhoneActions(detail.displayName, detail.phone ?? "")
                    }
                  />
                ) : null}
                {detail.email ? (
                  <ListRow
                    variant="detail"
                    label="Email"
                    value={detail.email}
                    accessibilityHint="Opens a new email to them"
                    onPress={() =>
                      void Linking.openURL(`mailto:${detail.email}`).catch(
                        () => undefined,
                      )
                    }
                  />
                ) : null}
                <ListRow
                  variant="detail"
                  label="Member since"
                  value={detail.joinedLabel ?? "—"}
                />
              </ListSection>

              <View style={styles.rolesBlock}>
                <View style={styles.rolesHeader}>
                  <Text style={styles.sectionLabel} accessibilityRole="header">
                    Roles
                  </Text>
                  {canEditRoles && rolesQuery.isSuccess && detail.memberId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${detail.displayName}'s roles`}
                      // Held while a DM with this member opens. The roles
                      // editor stacks over the profile (`SHEET_STACK_BEHAVIOR`),
                      // so a DM landing under it would close the profile, open
                      // the thread and leave the editor drawn over it (#3790).
                      accessibilityState={
                        dmPending.has(detail.userId)
                          ? { disabled: true }
                          : undefined
                      }
                      disabled={dmPending.has(detail.userId)}
                      hitSlop={12}
                      onPress={() => {
                        setRolesSession({
                          memberId: detail.memberId ?? "",
                          name: detail.displayName,
                          heldIds: detail.roleIds,
                          fetchedAt: memberQuery.dataUpdatedAt,
                        });
                        rolesSheetRef.current?.present();
                      }}
                    >
                      <Text
                        style={[
                          styles.editLink,
                          { color: accent },
                          dmPending.has(detail.userId)
                            ? styles.editLinkDisabled
                            : null,
                        ]}
                      >
                        Edit
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {rolesStillLoading ? (
                  <Text style={styles.meta}>Loading roles</Text>
                ) : roleChips.length > 0 ? (
                  <View style={styles.chips}>
                    {roleChips.map((chip) => (
                      <View key={chip.id} style={styles.chip}>
                        <View
                          style={[
                            styles.chipDot,
                            chip.color
                              ? { backgroundColor: chip.color }
                              : styles.chipDotPlain,
                          ]}
                        />
                        <Text style={styles.chipText}>{chip.name}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  // Everyone draws no chip (#4191): as Discord says it.
                  <Text style={styles.meta}>No roles</Text>
                )}
              </View>

              {/*
                Groups (#4076): read-only here, as Slack's profile lists a
                person's user groups; officers edit them in Chapter settings
                on web. Left out until the list loads, and on a failed read,
                rather than claiming "No groups".
              */}
              {groupsQuery.data ? (
                <View style={styles.rolesBlock}>
                  <View style={styles.rolesHeader}>
                    <Text
                      style={styles.sectionLabel}
                      accessibilityRole="header"
                    >
                      Groups
                    </Text>
                  </View>
                  {memberGroups.length > 0 ? (
                    <View style={styles.chips}>
                      {memberGroups.map((group) => {
                        const hex = roleColorOrNull(group.color);
                        return (
                          <View key={group.id} style={styles.chip}>
                            <View
                              style={[
                                styles.chipDot,
                                hex
                                  ? { backgroundColor: hex }
                                  : styles.chipDotPlain,
                              ]}
                            />
                            <Text style={styles.chipText}>{group.name}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.meta}>No groups</Text>
                  )}
                </View>
              ) : null}

              {classRows.length > 0 ? (
                <ListSection>
                  {classRows.map((row) => (
                    <ListRow
                      key={row.key}
                      variant="detail"
                      label={row.label}
                      value={row.value}
                      accessibilityHint={
                        canEditClass
                          ? `Edits ${detail.displayName}'s ${row.label}`
                          : undefined
                      }
                      // Held while a DM opens, as the roles Edit is (#3790).
                      disabled={canEditClass && dmPending.has(detail.userId)}
                      onPress={
                        canEditClass
                          ? () => {
                              setClassSession({
                                memberId: detail.memberId ?? "",
                                name: detail.displayName,
                                pledgeClassId: detail.pledgeClassId,
                                orderNumber: detail.orderNumber,
                              });
                              classSheetRef.current?.present();
                            }
                          : undefined
                      }
                    />
                  ))}
                </ListSection>
              ) : null}

              {detail.customFields.length > 0 ? (
                <ListSection>
                  <ListRow
                    label="More details"
                    value={detailsOpen ? "Hide" : "Show"}
                    action
                    accessibilityHint={
                      detailsOpen
                        ? "Hides the chapter's other fields"
                        : "Shows the chapter's other fields"
                    }
                    onPress={() =>
                      setDetailsUserId(detailsOpen ? null : detail.userId)
                    }
                  />
                  {detailsOpen
                    ? detail.customFields.map((field) => (
                        <ListRow
                          key={field.fieldId}
                          variant="detail"
                          label={field.label}
                          value={field.value}
                        />
                      ))
                    : null}
                </ListSection>
              ) : null}

              {detail.bio ? (
                <View style={styles.bioCard}>
                  <Text style={styles.bioText}>{detail.bio}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetModal>
      {/* Stacked over the profile, a sibling as `new-task-sheet.tsx` stacks
        its picker. */}
      <MemberRolesSheet
        ref={rolesSheetRef}
        session={rolesSession}
        options={roleOptions}
      />
      <MemberClassSheet ref={classSheetRef} session={classSession} />
      <MemberCorrectionSheet
        ref={correctionSheetRef}
        session={correctionSession}
      />
    </>
  );
});

/** The identity block's avatar diameter. */
const DETAIL_AVATAR_SIZE = 80;
/** The status dot on the 80pt avatar. */
const PRESENCE_DOT_SIZE = 16;

function createStyles(tokens: SignetTokens) {
  const avatarSize = DETAIL_AVATAR_SIZE;
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
    // Bottom-right on the avatar, ringed in the sheet's fill, as the rows draw it.
    presenceDot: {
      position: "absolute",
      bottom: 0,
      right: 0,
    },
    statusLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    messageBlock: {
      gap: tokens.spacing.xs,
    },
    messageNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
    },
    rolesBlock: {
      gap: tokens.spacing.sm,
    },
    rolesHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    editLink: {
      ...typeRole(tokens.typography.role.label),
    },
    editLinkDisabled: {
      opacity: 0.5,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    chipDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    chipDotPlain: {
      backgroundColor: tokens.color.text.muted,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
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
