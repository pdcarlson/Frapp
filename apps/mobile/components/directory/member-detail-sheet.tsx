import { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useMember, useRoles } from "@repo/hooks";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { ListRow, ListSection } from "@/components/list-section";
import { ErrorState, SkeletonLines } from "@/components/state-block";
import {
  SheetGrabber,
  SheetHeader,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { resolveRoleNames, selectMemberDetail } from "@/lib/directory/member-detail";

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
 */
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

  const detail = useMemo(
    () => selectMemberDetail(memberQuery.data),
    [memberQuery.data],
  );
  const roleNames = useMemo(
    () => resolveRoleNames(rolesQuery.data, detail?.roleIds ?? []),
    [rolesQuery.data, detail],
  );

  function dismiss() {
    if (typeof ref === "function" || !ref?.current) return;
    ref.current.dismiss();
  }

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      onDismiss={onDismiss}
    >
      <BottomSheetView style={styles.body}>
        <SheetHeader title="Member" onCancel={dismiss} cancelLabel="Done" />

        {memberQuery.isPending ? <SkeletonLines lines={4} showTile /> : null}

        {memberQuery.isError ? (
          <ErrorState
            title="Couldn't load this member"
            body="Their profile couldn't reach the server."
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
                value={roleNames.length > 0 ? roleNames.join(", ") : "—"}
              />
              <ListRow label="Joined" value={detail.joinedLabel ?? "—"} />
            </ListSection>

            {detail.bio ? (
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>{detail.bio}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  const avatarSize = 64;
  return StyleSheet.create({
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
