import { forwardRef, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useAssignPledgeClasses, usePledgeClasses } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import {
  classEditorDraft,
  classEditorResult,
  usePledgeClassTerms,
  type ClassEditorDraft,
} from "@/lib/directory/pledge-class";

/**
 * Set one member's pledge class and order number from their profile (#3991):
 * the mobile half of web's `MemberPledgeClassSection`
 * (`spec/behavior/members.md` § Pledge class and order number). Offered to a
 * viewer holding `roles:manage`, the permission `PUT
 * /v1/pledge-classes/assignments` requires; the API refuses anyone else.
 *
 * Stacked over the profile, as {@link MemberRolesSheet} is. Unlike the roles
 * list, nothing saves until Save: the number is typed, and a half-typed one
 * must not be sent. Both values go in one write, as web sends them, and a
 * failure keeps the draft and says why.
 */
export interface MemberClassSession {
  memberId: string;
  name: string;
  pledgeClassId: string | null;
  orderNumber: number | null;
}

/** A fixed detent with a scroll body, for a class list of any length. */
const SNAP_POINTS = ["88%"];

/** The order number field's width: seven digits at the body size, plus padding. */
const NUMBER_FIELD_WIDTH = 128;

export const MemberClassSheet = forwardRef<
  BottomSheetModal,
  { session: MemberClassSession | null }
>(function MemberClassSheet({ session }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { classTerm, orderTerm } = usePledgeClassTerms();
  const assign = useAssignPledgeClasses();
  const classesQuery = usePledgeClasses({ enabled: session !== null });
  const classes = classesQuery.data ?? [];

  const [draft, setDraft] = useState<ClassEditorDraft>({
    pledgeClassId: null,
    numberText: "",
  });
  const [numberFocused, setNumberFocused] = useState(false);
  // The number's refusal shows once the field is left or Save is pressed,
  // never on a keystroke still on its way to a valid value.
  const [revealRefusal, setRevealRefusal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A new opening starts from the member's saved values.
  useEffect(() => {
    if (!session) return;
    setDraft(classEditorDraft(session));
    setRevealRefusal(false);
    setSaveError(null);
  }, [session]);

  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  // Set the moment Save sends, so two taps in one batch send once.
  const sending = useRef(false);

  const result = session ? classEditorResult(session, draft) : null;
  const refusal = result && !result.ok && revealRefusal ? result.message : null;
  const canSave =
    !!session &&
    !assign.isPending &&
    (result?.ok === false || (result?.ok === true && result.changed));

  function edit(next: Partial<ClassEditorDraft>) {
    setSaveError(null);
    setDraft((current) => ({ ...current, ...next }));
  }

  function save() {
    if (!session || !result || !canSave || sending.current) return;
    if (!result.ok) {
      setRevealRefusal(true);
      return;
    }
    sending.current = true;
    setSaveError(null);
    const sentFrom = visit();
    assign.mutate(
      [
        {
          member_id: session.memberId,
          pledge_class_id: result.pledge_class_id,
          order_number: result.order_number,
        },
      ],
      {
        // `useAssignPledgeClasses` refetches the member reads before this
        // runs, so the profile under the sheet already shows the new values.
        onSuccess: () => {
          if (isSameVisit(sentFrom)) dismiss();
        },
        onError: (error) =>
          setSaveError(
            errorCopy(error, "That didn't save. Try again in a moment.", {
              serverWritesForMembers: true,
            }),
          ),
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  }

  const options: { id: string | null; name: string }[] = [
    { id: null, name: "None" },
    ...classes.map((entry) => ({ id: entry.id, name: entry.name })),
  ];

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onAnimate={onAnimate}
      onDismiss={markClosed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader
          title={session ? `${session.name}'s ${classTerm}` : classTerm}
          onCancel={dismiss}
        />

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{orderTerm}</Text>
          <BottomSheetTextInput
            value={draft.numberText}
            onChangeText={(text) => edit({ numberText: text })}
            editable={!assign.isPending}
            onFocus={() => setNumberFocused(true)}
            onBlur={() => {
              setNumberFocused(false);
              setRevealRefusal(true);
            }}
            placeholder="None"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel={orderTerm}
            keyboardType="number-pad"
            maxLength={7}
            style={[
              styles.field,
              numberFocused ? styles.fieldFocused : null,
              refusal ? styles.fieldInvalid : null,
            ]}
          />
          {refusal ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {refusal}
            </Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label} accessibilityRole="header">
            {classTerm}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.list}>
            {options.map((option) => {
              const selected = draft.pledgeClassId === option.id;
              return (
                <Pressable
                  key={option.id ?? "none"}
                  accessibilityRole="radio"
                  accessibilityLabel={option.name}
                  accessibilityState={{
                    selected,
                    disabled: assign.isPending,
                  }}
                  disabled={assign.isPending}
                  onPress={() => edit({ pledgeClassId: option.id })}
                  style={({ pressed }) => [
                    styles.row,
                    pressed ? styles.rowPressed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.rowLabel,
                      option.id === null ? styles.muted : null,
                    ]}
                    numberOfLines={1}
                  >
                    {option.name}
                  </Text>
                  <View
                    style={styles.check}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {selected ? <CheckGlyph color={accent} size={16} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {classesQuery.isPending ? (
            <Text style={styles.note}>Loading the chapter&apos;s list</Text>
          ) : classesQuery.isError && !classesQuery.data ? (
            <Text accessibilityRole="alert" style={styles.error}>
              Couldn&apos;t load the chapter&apos;s list.
            </Text>
          ) : classes.length === 0 ? (
            <Text style={styles.note}>
              This chapter&apos;s list is empty. Add to it in Settings on the
              web.
            </Text>
          ) : null}
        </View>

        {saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {saveError}
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={assign.isPending ? "Saving…" : "Save"}
          onPress={save}
          disabled={!canSave}
          accessibilityHint={refusal ?? undefined}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    fieldGroup: {
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: {
      ...fieldStyles.field,
      width: NUMBER_FIELD_WIDTH,
    },
    fieldFocused: fieldStyles.fieldFocused,
    fieldInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    list: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingHorizontal: tokens.spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    rowPressed: {
      opacity: 0.6,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    muted: {
      color: tokens.color.text.mutedForeground,
    },
    check: {
      width: 16,
      alignItems: "center",
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
