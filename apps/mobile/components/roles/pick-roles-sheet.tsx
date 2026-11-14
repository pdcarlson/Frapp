import { forwardRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { errorCopy, useSetPickedRole, type PickableRole } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection } from "@/components/list-section";
import { Toggle } from "@/components/toggle";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Add roles (#4958): the Non-chapter business roles a member adds and removes
 * themselves, one switch each, as Discord's onboarding questions and
 * Carl-bot's reaction roles hand out interest roles. Each pick saves at once
 * and the role's channels appear in Chat, so there is no Save to find.
 *
 * Opened from the Directory's title row for now: where it lives is
 * provisional (Shawn, 2026-11-14), and the sheet is self-contained so moving
 * its button is the whole move.
 */
export const PickRolesSheet = forwardRef<
  BottomSheetModal,
  { roles: readonly PickableRole[] }
>(function PickRolesSheet({ roles }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const setPicked = useSetPickedRole();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    id: string;
    message: string;
  } | null>(null);

  async function toggle(role: PickableRole) {
    setPendingId(role.id);
    setFailure(null);
    try {
      await setPicked.mutateAsync({ id: role.id, join: !role.held });
    } catch (error) {
      setFailure({ id: role.id, message: errorCopy(error) });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setFailure(null)}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.content}
      >
        <TallSheetHeader title="Add roles" onClose={closeSheet} />
        <Text style={styles.lede}>
          Pick what you&apos;re into. Each role adds its channels to Chat, and
          you can leave any time.
        </Text>
        <ListSection>
          {roles.map((role) => {
            const failed = failure?.id === role.id ? failure.message : null;
            return (
              <ListRow
                key={role.id}
                label={role.name}
                description={failed}
                descriptionTone={failed ? "destructive" : "default"}
                trailing={
                  <Toggle
                    value={role.held}
                    disabled={pendingId !== null}
                    onValueChange={() => void toggle(role)}
                    accessibilityLabel={
                      role.held ? `Leave ${role.name}` : `Join ${role.name}`
                    }
                  />
                }
              />
            );
          })}
        </ListSection>
        <View style={styles.footer} />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    lede: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    footer: { height: tokens.spacing.xl },
  });
}
