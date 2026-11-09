import { forwardRef, useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  CUSTOM_STATUS_MAX,
  DEFAULT_LINE_DURATION,
  DND_DURATIONS,
  LINE_DURATIONS,
  MEMBER_STATUS_HINT,
  MEMBER_STATUS_LABEL,
  clockTime,
  codePointLength,
  dndEndsAt,
  lineEndsAt,
  lineProblem,
  tomorrowMorning,
  untilLabel,
  type DndDuration,
  type LineDuration,
  type MemberStatus,
} from "@repo/hooks/member-status";
import { SignetTokens } from "@repo/theme/signet";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { ChevronGlyph } from "@/components/chat/viewer-glyphs";
import { StatusDot } from "@/components/account/status-dot";
import { useOwnStatus, useSaveOwnStatus } from "@/lib/account/own-status";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

const STATUSES: MemberStatus[] = ["online", "idle", "dnd", "invisible"];

/**
 * The status sheet (#3845), opened from the ME menu's Status row: Online,
 * Idle, Do Not Disturb (with how long) and Invisible, then the custom status
 * line. Web puts the same choices in the avatar menu's Status submenu and a
 * small dialog; this follows Discord's and Slack's phone apps, which open a
 * sheet from the avatar with the statuses listed and the custom line one tap
 * deeper.
 *
 * - A status pick saves and closes, as any picker here does.
 * - Do Not Disturb opens its durations under it in place, "Until I turn it
 *   off" first (the default, #3845).
 * - The custom line swaps the sheet's body for a one-line form with "Clear
 *   after", Today the default; its Cancel comes back to the statuses.
 *
 * Saves are optimistic (the shared settings mutation). While a write can't
 * reach the server the rows lock, as the notification switches do
 * (`connection-state.md`): a status the server never heard of would show here
 * and nowhere else.
 */
export const StatusSheet = forwardRef<BottomSheetModal>(
  function StatusSheet(_props, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens, accent);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const own = useOwnStatus();
    const { save, isSaving } = useSaveOwnStatus();
    const { writeBlockedReason } = useConnection();
    const locked = writeBlockedReason !== null || own === null;

    const [view, setView] = useState<"status" | "line">("status");
    const [dndOpen, setDndOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [clearAfter, setClearAfter] = useState<LineDuration>(
      DEFAULT_LINE_DURATION,
    );
    const [focused, setFocused] = useState(false);
    // A save that settles after a close mustn't close the next visit.
    const visit = useRef(0);

    const reset = useCallback(() => {
      visit.current += 1;
      setView("status");
      setDndOpen(false);
      setFocused(false);
    }, []);

    const current: MemberStatus = own?.status ?? "online";
    const now = new Date();

    function pick(status: MemberStatus, duration: DndDuration = null) {
      if (locked) return;
      void save({
        status,
        status_expires_at:
          status === "dnd" ? dndEndsAt(duration, new Date()) : null,
      });
      closeSheet();
    }

    function openLine() {
      if (locked) return;
      setDraft(own?.line ?? "");
      setClearAfter(DEFAULT_LINE_DURATION);
      setView("line");
    }

    const trimmed = draft.trim();
    const problem = lineProblem(draft, CUSTOM_STATUS_MAX);

    async function saveLine(clear: boolean) {
      if (locked || isSaving || (!clear && problem)) return;
      const at = visit.current;
      const saved = await save(
        clear || trimmed.length === 0
          ? { custom_status: null }
          : {
              custom_status: trimmed,
              custom_status_expires_at: lineEndsAt(clearAfter, new Date()),
            },
      );
      if (saved && at === visit.current) closeSheet();
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
        onDismiss={reset}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
          {view === "status" ? (
            <>
              <SheetHeader title="Status" />
              {writeBlockedReason ? (
                <Text style={styles.note}>{writeBlockedReason}</Text>
              ) : null}
              {STATUSES.map((status) => {
                const isCurrent = current === status;
                const sub =
                  isCurrent && own?.statusEndsAt
                    ? untilLabel(own.statusEndsAt, now)
                    : MEMBER_STATUS_HINT[status];
                return (
                  <View key={status}>
                    <Pressable
                      testID={`status-${status}`}
                      accessibilityRole={status === "dnd" ? "button" : "radio"}
                      accessibilityLabel={
                        sub
                          ? `${MEMBER_STATUS_LABEL[status]}, ${sub}`
                          : MEMBER_STATUS_LABEL[status]
                      }
                      accessibilityState={{
                        disabled: locked,
                        ...(status === "dnd"
                          ? { expanded: dndOpen, selected: isCurrent }
                          : { checked: isCurrent }),
                      }}
                      disabled={locked}
                      onPress={() =>
                        status === "dnd"
                          ? setDndOpen((open) => !open)
                          : pick(status)
                      }
                      style={({ pressed }) => [
                        styles.row,
                        locked ? styles.disabled : null,
                        pressed ? styles.dim : null,
                      ]}
                    >
                      <View style={styles.glyph}>
                        <StatusDot status={status} size={12} />
                      </View>
                      <View style={styles.text}>
                        <Text style={styles.label}>
                          {MEMBER_STATUS_LABEL[status]}
                        </Text>
                        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
                      </View>
                      {isCurrent ? (
                        <CheckGlyph color={tokens.color.text.foreground} />
                      ) : null}
                      {status === "dnd" ? (
                        <View
                          style={[
                            styles.chevron,
                            dndOpen ? styles.chevronOpen : null,
                          ]}
                        >
                          <ChevronGlyph
                            color={tokens.color.text.mutedForeground}
                            direction="right"
                          />
                        </View>
                      ) : null}
                    </Pressable>
                    {status === "dnd" && dndOpen
                      ? DND_DURATIONS.map(({ duration, label }) => (
                          <Pressable
                            key={label}
                            testID={`dnd-${duration ?? "off"}`}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: locked }}
                            disabled={locked}
                            onPress={() => pick("dnd", duration)}
                            style={({ pressed }) => [
                              styles.row,
                              styles.nested,
                              pressed ? styles.dim : null,
                            ]}
                          >
                            <Text style={[styles.label, styles.text]}>
                              {label}
                            </Text>
                            {duration === "tomorrow" ? (
                              <Text style={styles.sub}>
                                {clockTime(tomorrowMorning(now))}
                              </Text>
                            ) : null}
                          </Pressable>
                        ))
                      : null}
                  </View>
                );
              })}
              <Pressable
                testID="status-custom-line"
                accessibilityRole="button"
                accessibilityHint="Sets one short line under your name."
                accessibilityState={{ disabled: locked }}
                disabled={locked}
                onPress={openLine}
                style={({ pressed }) => [
                  styles.row,
                  styles.rowDivided,
                  locked ? styles.disabled : null,
                  pressed ? styles.dim : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.text,
                    own?.line ? styles.label : styles.placeholderLabel,
                  ]}
                >
                  {own?.line ?? "Set a custom status"}
                </Text>
                <ChevronGlyph
                  color={tokens.color.text.mutedForeground}
                  direction="right"
                />
              </Pressable>
            </>
          ) : (
            <>
              <SheetHeader
                title="Set a custom status"
                onCancel={() => setView("status")}
                cancelDisabled={isSaving}
              />
              <Text style={styles.note}>
                Shows under your name in the Directory and in chat, until it
                clears. Hidden while you&apos;re invisible.
              </Text>
              <View
                style={[styles.fieldRing, focused ? styles.ringActive : null]}
              >
                <BottomSheetTextInput
                  testID="custom-status-input"
                  value={draft}
                  onChangeText={setDraft}
                  editable={!isSaving}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="At practice till 6"
                  placeholderTextColor={tokens.color.text.muted}
                  accessibilityLabel="Status"
                  accessibilityHint={problem ?? undefined}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  onSubmitEditing={() => void saveLine(false)}
                  style={[styles.field, focused ? styles.fieldFocused : null]}
                />
              </View>
              <View style={styles.counterRow}>
                <Text
                  accessibilityRole={problem ? "alert" : undefined}
                  style={[styles.sub, problem ? styles.error : null]}
                >
                  {problem ?? " "}
                </Text>
                <Text style={[styles.sub, problem ? styles.error : null]}>
                  {codePointLength(trimmed)}/{CUSTOM_STATUS_MAX}
                </Text>
              </View>
              <Text style={styles.sectionLabel}>Clear after</Text>
              <View accessibilityRole="radiogroup">
                {LINE_DURATIONS.map(({ duration, label }) => (
                  <Pressable
                    key={label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: clearAfter === duration }}
                    onPress={() => setClearAfter(duration)}
                    style={({ pressed }) => [
                      styles.choice,
                      pressed ? styles.dim : null,
                    ]}
                  >
                    <Text style={[styles.label, styles.text]}>{label}</Text>
                    {clearAfter === duration ? (
                      <CheckGlyph color={tokens.color.text.foreground} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
              <SheetPrimaryButton
                label={isSaving ? "Saving…" : "Save"}
                onPress={() => void saveLine(false)}
                disabled={Boolean(problem) || isSaving || locked}
                accessibilityHint={problem ?? undefined}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
              {own?.line ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving || locked}
                  onPress={() => void saveLine(true)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.clear,
                    pressed ? styles.dim : null,
                  ]}
                >
                  <Text style={styles.clearLabel}>Clear status</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginBottom: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    rowDivided: {
      marginTop: tokens.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    nested: { paddingLeft: tokens.spacing.xl + tokens.spacing.xs },
    glyph: { width: 20, alignItems: "center" },
    text: { flex: 1, minWidth: 0 },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    placeholderLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    sub: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    chevron: { marginLeft: tokens.spacing.xs },
    // Points down while the durations are open under the row.
    chevronOpen: { transform: [{ rotate: "90deg" }] },
    disabled: { opacity: 0.5 },
    dim: { opacity: 0.7 },
    fieldRing: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    counterRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    error: { color: tokens.color.semantic.destructiveText },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.md,
    },
    choice: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
    },
    clear: {
      alignSelf: "center",
      marginTop: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
    },
    clearLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
