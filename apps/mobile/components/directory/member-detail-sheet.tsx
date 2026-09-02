import { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useCustomRoles, useMember, usePermissionList, useRoles } from "@repo/hooks";
import { can } from "@repo/validation";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { ErrorState, SkeletonLines } from "@/components/state-block";
import {
  SheetGrabber,
  SheetHeader,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import {
  resolveCustomRoleNames,
  resolveRoleNames,
  selectMemberDetail,
} from "@/lib/directory/member-detail";

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
 * **No DM entry.** The issue that filed this scopes DM entry to #316
 * explicitly ("Distinct from #316 — this gap is mobile profile *viewing*").
 *
 * ## Fixed snap points, not `enableDynamicSizing`
 *
 * A bio can run to 500 characters (`packages/validation`'s `bio` schema),
 * custom fields are chapter-configurable and unbounded in count, and role
 * names can stack up — the same "grows without bound" shape `ask-sheet.tsx`
 * documents for why it does not use dynamic sizing. `BottomSheetScrollView`
 * is a **direct child** of the modal for the reason `new-task-sheet.tsx`
 * spells out at its second modal: nested inside a `BottomSheetView`, the view
 * and the scrollable write competing heights to the same animated value.
 */
const SNAP_POINTS = ["65%"];

export interface MemberDetailSheetProps {
  /** `null` while no row is selected; the sheet stays mounted regardless. */
  userId: string | null;
  onDismiss?: () => void;
}

export const MemberDetailSheet = forwardRef<
  BottomSheetModal,
  MemberDetailSheetProps
>(function MemberDetailSheet({ userId, onDismiss }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();

  // `useMember` is already `enabled: !!id`, so this stays idle until a row is
  // actually tapped rather than firing for every mounted-but-closed sheet.
  const memberQuery = useMember(userId ?? "");
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

  function dismiss() {
    if (typeof ref === "function" || !ref?.current) return;
    ref.current.dismiss();
  }

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing={false}
      snapPoints={SNAP_POINTS}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      onDismiss={onDismiss}
    >
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
      >
        <SheetHeader title="Member" onCancel={dismiss} cancelLabel="Done" />

        {memberQuery.isPending ? <SkeletonLines lines={4} showTile /> : null}

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

            <ListSection>
              <ListRow label="Email" value={detail.email ?? "Not set"} />
              <ListRow
                label="Role"
                value={
                  rolesStillLoading
                    ? "Loading…"
                    : allRoleNames.length > 0
                      ? allRoleNames.join(", ")
                      : "—"
                }
              />
              <ListRow label="Joined" value={detail.joinedLabel ?? "—"} />
            </ListSection>

            {detail.customFields.length > 0 ? (
              <>
                <SectionHeader>Custom fields</SectionHeader>
                <ListSection>
                  {detail.customFields.map((field) => (
                    <ListRow
                      key={field.fieldId}
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
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      padding: tokens.spacing.lg,
    },
    bioText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
  });
}
