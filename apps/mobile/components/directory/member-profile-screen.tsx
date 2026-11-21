import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type GestureResponderEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  chipToggleName,
  cutChips,
  dmChannelIdOf,
  memberGroupChips,
  memberRoleChips,
  useBlockedUserIds,
  useGetOrCreateDm,
  useGroups,
  useMemberByUserId,
  useMemberDisplayNames,
  useMemberPhoneReach,
  usePermissionList,
  useRemoveMember,
  useRoles,
  useViewerUserId,
  type AssignmentChip,
} from "@repo/hooks";
import {
  PHONE_REACH_LABEL,
  phoneReachLastOpened,
  phoneReachSummary,
} from "@repo/validation";
import { BIRTHDAY_COPY, can } from "@repo/validation";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  memberMenuButtonLabel,
  removeFailedTitle,
} from "@repo/hooks/member-removal-copy";
import { presenceLabel } from "@repo/hooks/presence-status";
import { ScreenShell } from "@/components/screen-shell";
import { useRolesData } from "@/lib/roles/use-roles-data";
import { BACK_TO_DIRECTORY } from "@/components/back-row";
import { MemberAvatar } from "@/components/member-avatar";
import { AvatarWithPresence } from "@/components/avatar-with-presence";
import { ListRow, ListSection } from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { ChatGlyph } from "@/components/tab-glyphs";
import { pageSurfaces } from "@/lib/surfaces";
import { IconButton, ICON_BUTTON_SIZE } from "@/components/icon-button";
import { OverflowGlyph } from "@/components/chat/overflow-glyph";
import { pressAt } from "@/components/item-actions-menu";
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
import { usePresenceOf } from "@/lib/presence/presence-store";
import {
  confirmBlockMember,
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import { usePledgeClassRows } from "@/lib/directory/pledge-class";
import { selectMemberDetail } from "@/lib/directory/member-detail";
import { showPhoneActions } from "@/lib/directory/phone-actions";
import {
  confirmRemoveMember,
  memberMenuActions,
  showMemberMenu,
} from "@/lib/directory/member-menu";
import {
  messageRowDescription,
  messageRowState,
  otherRealMemberId,
  START_DM_FAILED_BODY,
  startDmFailedTitle,
} from "@/lib/directory/start-dm";
import { leaveScreen } from "@/lib/back-target";
import { firstParam } from "@/lib/route-params";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * A member's profile: a pushed screen (#5568, Paul 2026-11-19), the way iOS
 * Contacts pushes a contact and Slack's mobile app pushes a member's profile.
 * It was a full-height bottom sheet until then, which held a whole profile
 * in a surface meant for a short task.
 *
 * Route: `/member?userId=<users.id>`, with `channelId` when it is opened from
 * a chat thread. The back capsule names the screen under it (`‹ Directory`,
 * `‹ Chat`), and falls back to the Directory on a cold open.
 *
 * **One profile, every door.** The Directory's rows, a sender's name or photo
 * in chat, an `@mention` and a row of a channel's member list all push this
 * screen, keyed by `users.id` (`GET /v1/members/by-user/{userId}`, which also
 * hands back the membership id a role edit needs), so a member sees the same
 * page wherever they tap a name. It leads with what an everyday member opens
 * a profile for: who this is (photo, name, grad year), a way to reach them
 * (Message, then phone and email), and their roles; officer controls ride the
 * same rows rather than a separate screen.
 *
 * **The header** is the shell's own: the member's face on the title row
 * (`titleMark`, with their presence dot), their name as the title, and the
 * meta line (class, grad year) as the subtitle. Their custom status line
 * opens the body.
 *
 * **No point balance.** `GET /v1/points/members/{userId}` requires the
 * officer-only `points:view_all`, which most viewers do not hold, so it is
 * omitted rather than gated on a permission most viewers would silently fail.
 *
 * **A contact card first** (#3711). Phone, email and member since sit right
 * under Message, before roles (Evan, 2026-11-10). A phone tap offers Call or
 * Text, as a number in Contacts does. The chapter's custom fields sit behind
 * a More details row, folded on every visit (Shawn, 2026-11-09).
 *
 * **Message** (#2773) opens a 1:1 DM with the member, or the one you already
 * have: a small button sized to its label, under the header, never a
 * full-width bar (Paul, 2026-11-20: "not a big huge button guy"; Slack's and
 * iOS Contacts' profiles draw it the same size, as web's does). Opened from that
 * very DM, it goes back instead of stacking a second copy of the thread. Who
 * it is offered for is `spec/ui/mobile/screens.md` s13's rule, implemented in
 * `lib/directory/start-dm.ts`.
 *
 * **Roles, then groups**, right under Message (Paul, 2026-11-19, the same
 * order as web's card and profile): chips in the chapter's rank order
 * (`memberRoleChips`, as web's card), each with its color, the top three
 * shown and "+N more" opening the rest in place (#5783, `cutChips`). A viewer holding `roles:manage`
 * or `groups:manage` gets "+ Add role" and "+ Add to group", which open
 * {@link MemberRolesSheet}, the one roles-and-groups editor on mobile.
 *
 * **Pledge class and order number** (#3939) show to everyone when set; the
 * same `roles:manage` holder always sees both rows and taps either to open
 * {@link MemberClassSheet} (#3991).
 *
 * **The `⋯` menu** at the back row's far end holds what a viewer reaches for
 * only now and then (Paul, 2026-11-11): Edit name and graduation year
 * (#4367), Block / Unblock (#2257), and Remove from chapter where the API
 * says this viewer may. None of them applies to your own profile, so there
 * the `⋯` isn't drawn.
 */
export function MemberProfileScreen() {
  const params = useLocalSearchParams<{
    userId?: string | string[];
    channelId?: string | string[];
  }>();
  const userId = firstParam(params.userId);
  const openChannelId = firstParam(params.channelId);

  if (!userId) {
    return (
      <ScreenShell back={BACK_TO_DIRECTORY} title="Member">
        <InlineNote>Open a member from the Directory.</InlineNote>
      </ScreenShell>
    );
  }
  return <MemberProfile userId={userId} openChannelId={openChannelId} />;
}

export function MemberProfile({
  userId,
  openChannelId,
}: {
  userId: string;
  /** The thread this was pushed from, if any. */
  openChannelId: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  // A removal or a DM can settle after the member has gone back or on to
  // another screen: each acts only while this screen is still the one shown.
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const isShown = () => mountedRef.current && focusedRef.current;

  const memberQuery = useMemberByUserId(userId);
  // Whether Frapp's notifications reach this member's phone, as web's member
  // sheet shows it. The server sends every member's only to officers who can
  // invite or manage roles, and anyone else only their own, so a missing
  // entry draws no row.
  const { reach: phoneReachMap } = useMemberPhoneReach();
  const phoneReach = phoneReachMap?.byUserId.get(userId);
  // The same role-color resolution chat's name uses (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const rolesQuery = useRoles();
  // Their dot and custom line (#3917), off chapter presence: nothing until it
  // has synced, never a stand-in Offline.
  const { status, line: statusLine } = usePresenceOf(userId);
  const permissions = usePermissionList();

  const detail = useMemo(
    () => selectMemberDetail(memberQuery.data),
    [memberQuery.data],
  );
  const rolesData = useRolesData();
  // Ordered as web's card orders them (`memberRoleChips`): by rank
  // (`compareRolesByRank`), the Everyone role left out.
  const roleChips = useMemo(
    () =>
      memberRoleChips({
        roles: rolesData.roles,
        tiers: rolesData.tiers,
        heldRoleIds: detail?.roleIds ?? [],
        reach: rolesData.reach,
        canManageRoles: false,
      }),
    [rolesData.roles, rolesData.tiers, rolesData.reach, detail?.roleIds],
  );
  const groupsQuery = useGroups({ enabled: true });
  // The chapter's own groups first, then the pledge class's, class year's and
  // major's.
  const memberGroups = useMemo(
    () => memberGroupChips(groupsQuery.data ?? [], userId, false),
    [groupsQuery.data, userId],
  );

  const canEditRoles = can("roles:manage", permissions);
  const canManageGroups = can("groups:manage", permissions);
  // The sheet opens for whoever may change either, once the profile and the
  // roles list it starts from are in.
  const canOpenAssignments =
    !!detail?.memberId &&
    rolesQuery.isSuccess &&
    (canEditRoles || canManageGroups);
  // The member's pledge class and order number (#3939): each drawn only when
  // set, except to an officer who sets them here (the same `roles:manage`).
  const canEditClass = canEditRoles && !!detail?.memberId;
  const classRows = usePledgeClassRows(detail, { canEdit: canEditClass });
  const classSheetRef = useRef<BottomSheetModal>(null);
  const [classSession, setClassSession] = useState<MemberClassSession | null>(
    null,
  );
  const roleOptions = useMemo(
    () => parseChapterRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const rolesSheetRef = useRef<BottomSheetModal>(null);
  const [rolesSession, setRolesSession] = useState<MemberRolesSession | null>(
    null,
  );
  const correctionSheetRef = useRef<BottomSheetModal>(null);
  const [correctionSession, setCorrectionSession] =
    useState<MemberCorrectionSession | null>(null);
  // Folded on every visit: logistics are a tap away, not the first read.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Distinct from "no role" (`[]` once the read has settled): while it is
  // still in flight, an empty list would otherwise flash a wrong "No roles".
  const rolesStillLoading = rolesQuery.isPending;

  // Block/Unblock (#2257). Blocking is a chat control, not a membership one,
  // so a blocked member stays in the directory and is unblocked from here.
  // Never on your own profile (the API refuses a self-block) or the system
  // actor's.
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

  const leave = () => leaveScreen(router, BACK_TO_DIRECTORY.href);

  function openAssignments(focus: "roles" | "groups") {
    if (!detail?.memberId) return;
    setRolesSession({
      memberId: detail.memberId,
      userId: detail.userId,
      focus,
      canManageRoles: canEditRoles,
      canManageGroups,
      name: detail.displayName,
      heldIds: detail.roleIds,
      fetchedAt: memberQuery.dataUpdatedAt,
    });
    rolesSheetRef.current?.present();
  }

  function openMenu(event?: GestureResponderEvent) {
    if (!detail) return;
    const target = detail;
    const at = pressAt(event);
    showMemberMenu(
      target.displayName,
      menuActions,
      (action) => {
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
                // They are no longer a member, so their page goes; only while
                // it is still the one on screen (#3405).
                onSuccess: () => {
                  if (isShown()) leave();
                },
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
      },
      at,
    );
  }

  // Not waiting on the channel-list refetch: chat home observes it and picks
  // the DM up when it lands, and a refetch that fails offline would otherwise
  // hold this request pending until the app is back online.
  const dmMutation = useGetOrCreateDm({ awaitRefetch: false });
  const messageRow = messageRowState({ memberId: otherMemberId, blockList });
  // The ref closes a double tap inside one render (both taps would read the
  // same state and send twice, and the API's find-then-create can make two
  // DMs for one pair, #2788); the state holds the button busy.
  const dmInFlightRef = useRef(false);
  const [dmPending, setDmPending] = useState(false);

  async function startDm(memberUserId: string, name: string) {
    if (dmInFlightRef.current) return;
    dmInFlightRef.current = true;
    setDmPending(true);
    try {
      const channelId = dmChannelIdOf(
        await dmMutation.mutateAsync({ member_id: memberUserId }),
      );
      if (!channelId) throw new Error("No channel id returned");
      // Gone back or on since: that visit asked for nothing, and a thread
      // opening over whatever is shown now would surprise. Message again
      // finds the same DM.
      if (!isShown()) return;
      // Pushed from this very DM: back to it rather than a second copy.
      if (channelId === openChannelId) leave();
      else router.push({ pathname: "/chat-thread", params: { channelId } });
    } catch {
      // Quiet once the member has moved on, as the success path is: an
      // alert over an unrelated screen would surprise.
      if (!isShown()) return;
      Alert.alert(startDmFailedTitle(name), START_DM_FAILED_BODY);
    } finally {
      dmInFlightRef.current = false;
      if (mountedRef.current) setDmPending(false);
    }
  }

  const menuButton =
    detail && menuActions.length > 0 ? (
      <IconButton
        label={memberMenuButtonLabel(detail.displayName)}
        onPress={openMenu}
        // Held while a block or a removal is out, rather than dropping a row
        // from the menu, so the ⋯ never jumps; and while a DM opens, as the
        // roles Edit is (#3790): its editor sheet would stay drawn over the
        // thread the DM pushes.
        disabled={
          blockActions.isPending || removeMutation.isPending || dmPending
        }
      >
        <OverflowGlyph
          color={tokens.color.text.mutedForeground}
          size={ICON_BUTTON_SIZE}
        />
      </IconButton>
    ) : undefined;

  if (!detail) {
    // A cached member still renders through a background-refetch failure
    // (TanStack keeps `data` on an errored refetch): the error only takes
    // over when there is nothing else to show.
    return (
      <ScreenShell back={BACK_TO_DIRECTORY} title="Member">
        {memberQuery.isPending ? (
          <MemberProfileSkeleton />
        ) : memberQuery.isError ? (
          <ErrorState
            title="Couldn't load this member"
            body="Their profile couldn't reach the server."
            onRetry={() => void memberQuery.refetch()}
            isRetrying={memberQuery.isFetching}
          />
        ) : (
          <ErrorState
            title="Couldn't read this member"
            body="Their profile came back in a shape this app doesn't recognize."
            onRetry={() => void memberQuery.refetch()}
            isRetrying={memberQuery.isFetching}
          />
        )}
      </ScreenShell>
    );
  }

  return (
    <>
      <ScreenShell
        back={BACK_TO_DIRECTORY}
        backAction={menuButton}
        title={detail.displayName}
        subtitle={detail.meta ?? undefined}
        titleMark={
          // The status read with the name it belongs to ("Ada, Online"),
          // as the sheet's name heading read it, since the shell's title
          // carries no label of its own.
          <View
            accessible={!!status}
            accessibilityLabel={
              status
                ? `${detail.displayName}, ${presenceLabel(status)}`
                : undefined
            }
          >
            <AvatarWithPresence
              status={status}
              avatarSize={PROFILE_AVATAR_SIZE}
              ring={tokens.color.surface.background}
            >
              <MemberAvatar
                uri={detail.avatarUrl}
                initials={detail.initials}
                size={PROFILE_AVATAR_SIZE}
                tint={avatarTintFor(userId)}
                style={styles.avatar}
                textStyle={styles.avatarText}
              />
            </AvatarWithPresence>
          </View>
        }
      >
        <View style={styles.body}>
          {statusLine ? (
            <Text style={styles.statusLine} numberOfLines={2}>
              {statusLine}
            </Text>
          ) : null}

          {messageRow.kind !== "hidden" ? (
            <View style={styles.messageBlock}>
              <MessageButton
                label="Message"
                // Busy while the DM opens; disabled only while the block list
                // can't vouch for a DM yet.
                busy={messageRow.kind === "ready" && dmPending}
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

          {/*
            Roles, then groups (Paul, 2026-11-19: one place for both, set
            from the person, the same rows as web's card and profile). A
            viewer who may change them gets "+ Add role" and "+ Add to group",
            which open one sheet of roles and groups ticked to give or take.
          */}
          <View style={styles.chipBlock}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              Roles
            </Text>
            {rolesStillLoading ? (
              <Text style={styles.meta}>Loading roles</Text>
            ) : (
              <View style={styles.chips}>
                <FoldedChips chips={roleChips} noun="roles" />
                {canOpenAssignments ? (
                  <AddChip
                    label="Add role"
                    disabled={dmPending}
                    onPress={() => openAssignments("roles")}
                  />
                ) : roleChips.length === 0 ? (
                  // Everyone draws no chip (#4191): as Discord says it.
                  <Text style={styles.meta}>No roles</Text>
                ) : null}
              </View>
            )}
          </View>

          {groupsQuery.data ? (
            <View style={styles.chipBlock}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                Groups
              </Text>
              <View style={styles.chips}>
                <FoldedChips chips={memberGroups} noun="groups" />
                {canOpenAssignments ? (
                  <AddChip
                    label="Add to group"
                    disabled={dmPending}
                    onPress={() => openAssignments("groups")}
                  />
                ) : memberGroups.length === 0 ? (
                  <Text style={styles.meta}>No groups</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <ListSection>
            {detail.phone ? (
              <ListRow
                variant="detail"
                label="Phone"
                value={detail.phone}
                accessibilityHint="Offers to call or text them"
                onPress={(event) =>
                  showPhoneActions(
                    detail.displayName,
                    detail.phone ?? "",
                    event,
                  )
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
            {detail.birthday ? (
              <ListRow
                variant="detail"
                label={BIRTHDAY_COPY.label}
                value={detail.birthday}
              />
            ) : null}
            <ListRow
              variant="detail"
              label="Member since"
              value={detail.joinedLabel ?? "—"}
            />
            {phoneReach ? (
              <ListRow
                variant="detail"
                label={PHONE_REACH_LABEL}
                value={phoneReachSummary(phoneReach)}
                description={phoneReachLastOpened(phoneReach)}
              />
            ) : null}
          </ListSection>

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
                  disabled={canEditClass && dmPending}
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
                onPress={() => setDetailsOpen((open) => !open)}
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
        </View>
      </ScreenShell>
      <MemberRolesSheet
        ref={rolesSheetRef}
        session={rolesSession}
        options={roleOptions}
        groups={groupsQuery.data ?? []}
      />
      <MemberClassSheet ref={classSheetRef} session={classSession} />
      <MemberCorrectionSheet
        ref={correctionSheetRef}
        session={correctionSession}
      />
    </>
  );
}

/**
 * Message: a compact outlined button sized to its label, under the header,
 * web's `secondary` `sm` button on the phone.
 */
function MessageButton({
  label,
  busy,
  disabled,
  accessibilityHint,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  accessibilityHint?: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.messageButton,
        pressed ? styles.messageButtonPressed : null,
        disabled ? styles.addChipDim : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={tokens.color.text.mutedForeground}
        />
      ) : (
        <ChatGlyph
          focused={false}
          accent={tokens.color.text.foreground}
          muted={tokens.color.text.foreground}
          size={16}
        />
      )}
      <Text style={styles.messageButtonText}>{label}</Text>
    </Pressable>
  );
}

/**
 * "+ Add role" or "+ Add to group": a dashed chip beside the member's own,
 * opening the one roles-and-groups sheet. Held while a DM with this member
 * opens, so the sheet never lands over the thread (#3790).
 */
function AddChip({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        styles.addChip,
        pressed || disabled ? styles.addChipDim : null,
      ]}
    >
      <Text style={[styles.chipText, styles.addChipText]}>+ {label}</Text>
    </Pressable>
  );
}

/**
 * A roles or groups row's chips: the top three, then "+N more" opening the
 * rest in place, and "Show less" folding them back (#5783, the same cut as
 * web's, `cutChips`). Editing happens in the sheet, which lists every role.
 */
function FoldedChips({
  chips,
  noun,
}: {
  chips: readonly AssignmentChip[];
  noun: "roles" | "groups";
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [expanded, setExpanded] = useState(false);
  const cut = cutChips(chips, expanded);
  return (
    <>
      {cut.shown.map((chip) => (
        <ColorChip key={chip.id} name={chip.name} color={chip.color} />
      ))}
      {cut.toggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chipToggleName(cut.toggle, noun)}
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => setExpanded(cut.toggle?.expands ?? false)}
          style={({ pressed }) => [
            styles.moreChip,
            pressed ? styles.addChipDim : null,
          ]}
        >
          <Text style={styles.moreChipText}>{cut.toggle.label}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** A role or a group: its color as a dot, its name beside it. */
function ColorChip({ name, color }: { name: string; color: string | null }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.chip}>
      <View
        style={[
          styles.chipDot,
          color ? { backgroundColor: color } : styles.chipDotPlain,
        ]}
      />
      <Text style={styles.chipText}>{name}</Text>
    </View>
  );
}

/**
 * The profile while it loads, in its own layout: the face and name on the
 * title row's line, the Message button, then the contact rows.
 */
export function MemberProfileSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading member" style={styles.body} flush>
      <View style={styles.skeletonIdentity}>
        <SkeletonBlock
          width={PROFILE_AVATAR_SIZE}
          height={PROFILE_AVATAR_SIZE}
          radius={avatarRadius(PROFILE_AVATAR_SIZE)}
        />
        <View style={styles.skeletonIdentityText}>
          <SkeletonText role={label} width="55%" />
          <SkeletonText role={caption} width="35%" />
        </View>
      </View>
      <SkeletonBlock
        width="100%"
        height={tokens.touch.buttonLarge}
        radius={tokens.radius.control}
      />
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonText role={label} width="30%" />
          <SkeletonText role={label} width="40%" />
        </View>
      ))}
    </SkeletonRegion>
  );
}

/** The face on the title row, the headline's companion. */
const PROFILE_AVATAR_SIZE = 56;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.md,
    },
    avatar: {
      width: PROFILE_AVATAR_SIZE,
      height: PROFILE_AVATAR_SIZE,
      borderRadius: avatarRadius(PROFILE_AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.mutedForeground,
    },
    statusLine: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    // At the header's start, under the name it belongs to: the phone's
    // header is left-aligned where web's sheet centers its own.
    messageBlock: {
      gap: tokens.spacing.xs,
      alignItems: "flex-start",
    },
    messageButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: 36,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      backgroundColor: pageSurfaces(tokens).card,
    },
    messageButtonPressed: {
      backgroundColor: pageSurfaces(tokens).raised,
    },
    messageButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    messageNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    chipBlock: {
      gap: tokens.spacing.sm,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    addChip: {
      borderStyle: "dashed",
    },
    addChipText: {
      color: tokens.color.text.mutedForeground,
    },
    addChipDim: {
      opacity: 0.5,
    },
    // "+N more" and "Show less": the chip's step with no box, quieter than
    // the chips it stands for.
    moreChip: {
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
    },
    moreChipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
    skeletonIdentity: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    skeletonIdentityText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    skeletonRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
  });
}
