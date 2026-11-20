import { forwardRef, useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useCreateRole } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { NEW_PICKABLE_ROLE_COPY } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useGuardedSheetRef,
} from "@/components/sheet-scaffold";
import { successHaptic } from "@/lib/haptics";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

/** The longest role name, as web's Add role field allows. */
const NAME_MAX_LENGTH = 60;

export interface NewPickableRoleSheetProps {
  /** Opens the new role's page, where its color and switches are set. */
  onCreated: (roleId: string) => void;
}

/**
 * Add role under Roles and groups' Non-chapter business (#5736): one name
 * field, and the role is created outside the tiers, holding nothing, and
 * already marked for members to pick (`POST /v1/roles` with
 * `self_assignable: true`), then its page opens. Web's twin is the section's
 * Add role row on the Roles tab, in the same words
 * (`NEW_PICKABLE_ROLE_COPY`).
 *
 * The name outlives a close, not a Cancel (`spec/ui/mobile/patterns.md`
 * § Bottom sheets).
 */
export const NewPickableRoleSheet = forwardRef<
  BottomSheetModal,
  NewPickableRoleSheetProps
>(function NewPickableRoleSheet({ onCreated }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { modalRef, onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useGuardedSheetRef(ref);
  const createRole = useCreateRole();

  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const trimmed = name.trim();

  const closed = useCallback(() => {
    markClosed();
    setFocused(false);
    setFailure(null);
  }, [markClosed]);

  const cancel = useCallback(() => {
    if (sending.current) return;
    setName("");
    setFailure(null);
    dismiss();
  }, [dismiss]);

  const add = useCallback(() => {
    if (!trimmed || sending.current) return;
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const sentFrom = visit();
    createRole
      .mutateAsync({
        name: trimmed,
        permissions: [],
        tier_id: null,
        self_assignable: true,
      })
      .then(
        (created) => {
          sending.current = false;
          setSaving(false);
          successHaptic();
          setName("");
          if (isSameVisit(sentFrom)) dismiss();
          if (created.id) onCreated(created.id);
        },
        (error: unknown) => {
          sending.current = false;
          setSaving(false);
          if (isSameVisit(sentFrom)) {
            setFailure(
              `${NEW_PICKABLE_ROLE_COPY.failed}. ${errorCopy(error, NEW_PICKABLE_ROLE_COPY.failedBody, { serverWritesForMembers: true })}`,
            );
          }
        },
      );
  }, [trimmed, createRole, visit, isSameVisit, dismiss, onCreated]);

  return (
    <BottomSheetModal
      ref={modalRef}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={closed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader
          title={NEW_PICKABLE_ROLE_COPY.title}
          onCancel={cancel}
          cancelDisabled={saving}
        />

        <View style={[styles.ring, focused ? styles.ringActive : null]}>
          <BottomSheetTextInput
            value={name}
            onChangeText={(next) => {
              setName(next);
              setFailure(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={add}
            returnKeyType="done"
            editable={!saving}
            placeholder={NEW_PICKABLE_ROLE_COPY.placeholder}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Role name"
            maxLength={NAME_MAX_LENGTH}
            style={[styles.field, focused ? styles.fieldFocused : null]}
          />
        </View>
        <Text style={styles.caption}>{NEW_PICKABLE_ROLE_COPY.hint}</Text>

        {failure ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {failure}
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={saving ? "Adding…" : NEW_PICKABLE_ROLE_COPY.add}
          onPress={add}
          disabled={!trimmed || saving}
          busy={saving}
          accessibilityHint={trimmed ? undefined : "Name the role first."}
          accent={brand.accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
