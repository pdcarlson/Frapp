import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  useBlockedUserIds,
  useCustomRoles,
  useGetOrCreateDm,
  useMemberByUserId,
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
} from "@/components/sheet-scaffold";
import {
  resolveCustomRoleNames,
  resolveRoleChips,
  selectMemberDetail,
  type MemberRoleChip,
} from "@/lib/directory/member-detail";
import { parseRoleOptions } from "@/lib/directory/role-editor";
import {
  MemberRolesSheet,
  type MemberRolesSession,
} from "@/components/directory/member-roles-sheet";
import {
  dmChannelIdOf,
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
 * (photo, name, grad year), a way to reach them (Message, email), and their
 * roles; officer controls ride the same rows rather than a separate screen.
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
  const { accent } = useChapterBranding();
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
  const roleChips = useMemo(
    () => resolveRoleChips(rolesQuery.data, detail?.roleIds ?? []),
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
  // Custom titles carry no color or rank in this read, so they follow the
  // ranked roles as plain chips.
  const allRoleChips: MemberRoleChip[] = [
    ...roleChips,
    ...customRoleNames.map((name) => ({ id: `custom:${name}`, name, color: null })),
  ];

  const canEditRoles = can("roles:manage", permissions);
  const roleOptions = useMemo(
    () => parseRoleOptions(rolesQuery.data),
    [rolesQuery.data],
  );
  const rolesSheetRef = useRef<BottomSheetModal>(null);
  const [rolesSession, setRolesSession] = useState<MemberRolesSession | null>(
    null,
  );
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
                <MemberPhoto
                  url={detail.avatarUrl}
                  initials={detail.initials}
                  styles={styles}
                />
                <Text style={styles.name} accessibilityRole="header">
                  {detail.displayName}
                </Text>
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

              <View style={styles.rolesBlock}>
                <View style={styles.rolesHeader}>
                  <Text style={styles.sectionLabel} accessibilityRole="header">
                    Roles
                  </Text>
                  {canEditRoles && rolesQuery.isSuccess && detail.memberId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${detail.displayName}'s roles`}
                      hitSlop={12}
                      onPress={() => {
                        setRolesSession({
                          memberId: detail.memberId ?? "",
                          name: detail.displayName,
                          heldIds: detail.roleIds,
                          customRoleNames,
                          fetchedAt: memberQuery.dataUpdatedAt,
                        });
                        rolesSheetRef.current?.present();
                      }}
                    >
                      <Text style={[styles.editLink, { color: accent }]}>
                        Edit
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {rolesStillLoading ? (
                  <Text style={styles.meta}>Loading roles</Text>
                ) : allRoleChips.length > 0 ? (
                  <View style={styles.chips}>
                    {allRoleChips.map((chip) => (
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
                  <Text style={styles.meta}>No roles yet</Text>
                )}
              </View>

              <ListSection>
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
      {/* Stacked over the profile, a sibling as `new-task-sheet.tsx` stacks
        its picker. */}
      <MemberRolesSheet
        ref={rolesSheetRef}
        session={rolesSession}
        options={roleOptions}
      />
    </>
  );
});

/** The member's photo, or their initials when there is none or it fails. */
function MemberPhoto({
  url,
  initials,
  styles,
}: {
  url: string | null;
  initials: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && failedUrl !== url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.avatar}
        onError={() => setFailedUrl(url)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const avatarSize = 80;
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
