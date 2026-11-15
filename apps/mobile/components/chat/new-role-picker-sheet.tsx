import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  buildRolePickerMessage,
  ROLE_PICKER_DEFAULT_TITLE,
  ROLE_PICKER_ROLES_MAX,
  ROLE_PICKER_TITLE_MAX_LENGTH,
  type RolePickerPayload,
} from "@repo/chat-core/role-pickers";
import { useRoles } from "@repo/hooks";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
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
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { ListRow, ListSection } from "@/components/list-section";
import { Toggle } from "@/components/toggle";
import { successHaptic } from "@/lib/haptics";

/** With no role marked Non-chapter business, where the officer turns one on. */
export const NO_PICKABLE_ROLES_LINE =
  "No roles are open to join yet. Turn on Non-chapter business on a role's page in Chapter settings → Roles.";

/**
 * The New role picker sheet (#4958), opened from the composer's + by an
 * officer with `roles:manage`: an optional title and the chapter's
 * Non-chapter business roles, one switch each, from one to twenty-five. The
 * phone's twin of web's + card form, on the New sign-up sheet's chrome, and
 * built by the same `buildRolePickerMessage`.
 *
 * Posting goes through the outbox like a sign-up sheet, so it survives a lost
 * connection and a server refusal (a role unmarked since the sheet opened)
 * lands on the card's own failed row. The draft outlives a close, not a
 * Cancel (`spec/ui/mobile/patterns.md` § Bottom sheets).
 */
export interface NewRolePickerSheetProps {
  /** Queues the card; `useChatChannel`'s `sendRolePicker`. */
  onPost: (picker: {
    content: string;
    payload: RolePickerPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export const NewRolePickerSheet = forwardRef<
  BottomSheetModal,
  NewRolePickerSheetProps
>(function NewRolePickerSheet({ onPost }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);

  const rolesQuery = useRoles();
  const roles = useMemo(
    () =>
      parseChapterRoles(rolesQuery.data)
        .filter((role) => role.selfAssignable)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rolesQuery.data],
  );

  const [title, setTitle] = useState("");
  // In the order they were turned on, which is the card's order.
  const [picked, setPicked] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const sending = useRef(false);

  // A role unmarked since it was picked is no longer offered or posted.
  const offered = useMemo(() => new Set(roles.map((r) => r.id)), [roles]);
  const pickedIds = useMemo(
    () => picked.filter((id) => offered.has(id)),
    [picked, offered],
  );
  const full = pickedIds.length >= ROLE_PICKER_ROLES_MAX;
  const canPost = pickedIds.length > 0 && !posting;

  const reset = useCallback(() => {
    setTitle("");
    setPicked([]);
    setFocused(false);
    setFailure(null);
  }, []);

  const closed = useCallback(() => {
    markClosed();
    setFocused(false);
    setFailure(null);
  }, [markClosed]);

  const cancel = useCallback(() => {
    if (sending.current) return;
    reset();
    dismiss();
  }, [reset, dismiss]);

  const toggle = (id: string, on: boolean) => {
    setFailure(null);
    setPicked((current) =>
      on
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  };

  const post = useCallback(() => {
    if (pickedIds.length === 0 || sending.current) return;
    sending.current = true;
    setPosting(true);
    setFailure(null);
    const sentFrom = visit();
    void onPost(buildRolePickerMessage({ title, roleIds: pickedIds }))
      .catch((): { ok: false; error: string } => ({
        ok: false,
        error: "Couldn't post that role picker. Try again.",
      }))
      .then((result) => {
        sending.current = false;
        setPosting(false);
        if (result.ok) {
          successHaptic();
          reset();
          if (isSameVisit(sentFrom)) dismiss();
          return;
        }
        if (isSameVisit(sentFrom)) setFailure(result.error);
      });
  }, [pickedIds, title, onPost, reset, dismiss, visit, isSameVisit]);

  let list;
  if (rolesQuery.isLoading) {
    list = <Text style={styles.caption}>Loading roles…</Text>;
  } else if (rolesQuery.isError && roles.length === 0) {
    list = (
      <Text style={styles.error}>
        Couldn&apos;t load the roles. Close this and try again.
      </Text>
    );
  } else if (roles.length === 0) {
    list = <Text style={styles.caption}>{NO_PICKABLE_ROLES_LINE}</Text>;
  } else {
    list = (
      <>
        <ListSection>
          {roles.map((role) => {
            const on = pickedIds.includes(role.id);
            return (
              <ListRow
                key={role.id}
                label={role.name}
                trailing={
                  <Toggle
                    value={on}
                    disabled={posting || (full && !on)}
                    onValueChange={(next) => toggle(role.id, next)}
                    accessibilityLabel={role.name}
                  />
                }
              />
            );
          })}
        </ListSection>
        {full ? (
          <Text style={styles.caption}>
            A role picker can list up to {ROLE_PICKER_ROLES_MAX} roles.
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <BottomSheetModal
      ref={ref}
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
          title="New role picker"
          onCancel={cancel}
          cancelDisabled={posting}
        />

        <View style={[styles.ring, focused ? styles.ringActive : null]}>
          <BottomSheetTextInput
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              setFailure(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!posting}
            placeholder={ROLE_PICKER_DEFAULT_TITLE}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Title, optional"
            maxLength={ROLE_PICKER_TITLE_MAX_LENGTH}
            style={[styles.field, focused ? styles.fieldFocused : null]}
          />
        </View>

        <Text style={styles.groupLabel}>Roles</Text>
        <Text style={styles.caption}>
          Members tap Join or Leave beside each one.
        </Text>
        {list}

        {failure ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {failure}
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={posting ? "Posting…" : "Post role picker"}
          onPress={post}
          disabled={!canPost}
          busy={posting}
          accessibilityHint={
            pickedIds.length === 0 ? "Pick at least one role." : undefined
          }
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
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
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
