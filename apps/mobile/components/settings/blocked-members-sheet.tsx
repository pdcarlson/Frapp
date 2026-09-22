import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  memberFallbackLabel,
  useBlockedUserIds,
  useMemberDisplayNames,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ListSection } from "@/components/list-section";
import {
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import {
  EmptyState,
  ErrorState,
  SkeletonLines,
} from "@/components/state-block";
import {
  confirmUnblockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Settings → Blocked members: the one place a block can always be undone
 * (`spec/behavior/chat/README.md` § Block — "a tombstone in a thread the
 * member may never reopen is not sufficient"). A sheet on s16 rather than a
 * route, because the tab layout is frozen and every route is pre-registered.
 *
 * Fixed detent with the scroll view as the modal's direct child: the list is
 * unbounded, which is the case `spec/ui/mobile/patterns.md` § Bottom sheets
 * gives a fixed detent.
 */
const SNAP_POINTS = ["65%"];

export const BLOCKED_MEMBERS_TITLE = "Blocked members";

/**
 * The sheet's strings, exported so `spec/ui/design-system/writing.md` and the
 * spec can point at one home. A block is scoped to one chapter and a member can
 * belong to several (`spec/behavior/chat/README.md` § Block), so the sheet says
 * which chapter it is listing.
 */
export const BLOCKED_MEMBERS_SCOPE = "Blocks apply in this chapter only.";
export const BLOCKED_MEMBERS_EMPTY_TITLE = "You haven't blocked anyone";
export const BLOCKED_MEMBERS_EMPTY_BODY =
  "Block someone from a message or their profile in the directory. Their messages in this chapter's chat are hidden from you, and they aren't told.";
export const BLOCKED_MEMBERS_ERROR_TITLE = "Couldn't load your blocked members";
export const BLOCKED_MEMBERS_ERROR_BODY =
  "Check your connection and try again. Your blocks haven't changed.";
export const BLOCKED_MEMBERS_STALE =
  "Couldn't refresh this list. It may be missing a recent change.";

export const BlockedMembersSheet = forwardRef<BottomSheetModal>(
  function BlockedMembersSheet(_props, ref) {
    const { tokens } = useFrappTheme();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();
    const blockList = useBlockedUserIds();
    const { nameFor } = useMemberDisplayNames();
    const { unblock } = useBlockActions();

    // A member who has left the chapter drops off the roster but can still be
    // on the list — a block outlives their membership — so the fallback label
    // is permanent for them, not a loading state.
    const rows = useMemo(
      () =>
        [...blockList.ids]
          .map((userId) => {
            const name = nameFor(userId);
            return { userId, name, label: name ?? memberFallbackLabel(userId) };
          })
          .sort((a, b) => a.label.localeCompare(b.label)),
      [blockList.ids, nameFor],
    );

    function dismiss() {
      if (typeof ref === "function" || !ref?.current) return;
      ref.current.dismiss();
    }

    // Only a confirmed read may say the list is empty. An unavailable read
    // with a cached list still shows that list (everyone on it is blocked) but
    // says it could not be refreshed.
    const body =
      blockList.status === "loading" ? (
        <SkeletonLines lines={3} showTile={false} />
      ) : blockList.status === "unavailable" && rows.length === 0 ? (
        <ErrorState
          title={BLOCKED_MEMBERS_ERROR_TITLE}
          body={BLOCKED_MEMBERS_ERROR_BODY}
          onRetry={blockList.retry}
          isRetrying={blockList.isRetrying}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          glyph="⊘"
          title={BLOCKED_MEMBERS_EMPTY_TITLE}
          body={BLOCKED_MEMBERS_EMPTY_BODY}
        />
      ) : (
        <>
          <Text style={styles.stale}>{BLOCKED_MEMBERS_SCOPE}</Text>
          {blockList.status === "unavailable" ? (
            <Text style={styles.stale}>{BLOCKED_MEMBERS_STALE}</Text>
          ) : null}
          <ListSection>
            {rows.map((row) => (
              <View key={row.userId} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {row.label}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${row.label}`}
                  hitSlop={12}
                  onPress={() =>
                    confirmUnblockMember({
                      name: row.name,
                      run: () => unblock(row.userId),
                    })
                  }
                  style={({ pressed }) => (pressed ? styles.pressed : null)}
                >
                  <Text style={styles.unblock}>Unblock</Text>
                </Pressable>
              </View>
            ))}
          </ListSection>
        </>
      );

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing={false}
        snapPoints={SNAP_POINTS}
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
      >
        <BottomSheetScrollView contentContainerStyle={styles.body}>
          <SheetHeader
            title={BLOCKED_MEMBERS_TITLE}
            onCancel={dismiss}
            cancelLabel="Done"
          />
          {body}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    unblock: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    stale: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
