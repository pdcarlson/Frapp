import { forwardRef, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import {
  memberFallbackLabel,
  taskLinkChoices,
  useMemberDisplayNames,
  useTasks,
  type TaskLinkChoice,
  type TaskLinkSource,
} from "@repo/hooks";
import type { DispatchResult } from "@repo/chat-core/dispatch";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useGuardedSheetRef,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";

/**
 * Most of the screen, never all of it: the thread stays in view above, so
 * the member can see the conversation the task goes into (Paul, 2026-11-20:
 * a sheet that takes the whole screen hides "what you're dealing with").
 */
const SNAP_POINTS = ["62%"];

export interface TaskLinkSheetProps {
  /** Whether the member may make a task (`TASK_CREATE_PERMISSIONS`). */
  canCreate: boolean;
  /** Posts the picked task's card into the thread (`linkTask`). */
  onLink: (task: { id: string; title: string }) => Promise<DispatchResult>;
  /** Opens the New task sheet, once this one has closed. */
  onNew: () => void;
}

/**
 * The + sheet's Task row on the phone (#5772): link a task the member can
 * already see into the thread, or, for an officer, start a new one. Web's
 * twin is `apps/web/components/chat/task-link-picker.tsx`; both read their
 * rows from `taskLinkChoices`, so they list, order and word them alike.
 *
 * A search field over the tasks `GET /v1/tasks` scopes to the member, open
 * ones first by when they are due, and a tap posts the task's card, the same
 * card a created task posts. **New task** sits in the header.
 */
export const TaskLinkSheet = forwardRef<BottomSheetModal, TaskLinkSheetProps>(
  function TaskLinkSheet({ canCreate, onLink, onNew }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = useMemo(
      () => createStyles(tokens, accent),
      [tokens, accent],
    );
    const backgroundStyle = useSheetBackgroundStyle();
    const close = useSheetClose(ref);
    const { modalRef, onAnimate, markClosed } = useGuardedSheetRef(ref);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [linking, setLinking] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    // What to run once the sheet is down: New task presents another sheet,
    // which can't draw while this one animates out.
    const [afterClose, setAfterClose] = useState<(() => void) | null>(null);
    const tasks = useTasks({ enabled: open });
    const { nameFor } = useMemberDisplayNames();
    const choices = useMemo(
      () =>
        taskLinkChoices(
          (tasks.data ?? []) as TaskLinkSource[],
          query,
          (id) => nameFor(id) ?? memberFallbackLabel(id),
        ),
      [tasks.data, query, nameFor],
    );

    const link = useCallback(
      async (choice: TaskLinkChoice) => {
        if (linking) return;
        setLinking(choice.id);
        setFailure(null);
        let result: DispatchResult;
        try {
          result = await onLink({ id: choice.id, title: choice.title });
        } catch {
          result = { ok: false, error: "Couldn't link that task." };
        } finally {
          setLinking(null);
        }
        if (result.ok) {
          close();
          return;
        }
        setFailure(result.error ?? "Couldn't link that task.");
      },
      [linking, onLink, close],
    );

    const renderItem = useCallback(
      ({ item }: { item: TaskLinkChoice }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.detail}`}
          accessibilityHint="Posts this task in the conversation"
          disabled={linking !== null}
          onPress={() => void link(item)}
          style={({ pressed }) => [
            styles.row,
            pressed ? styles.pressed : null,
            linking !== null && linking !== item.id ? styles.dimmed : null,
          ]}
        >
          <View style={styles.rowText}>
            <Text
              numberOfLines={1}
              style={[styles.title, item.done ? styles.muted : null]}
            >
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.detail}>
              {item.detail}
            </Text>
          </View>
          {linking === item.id ? (
            <ActivityIndicator
              size="small"
              color={tokens.color.text.muted}
              accessibilityLabel="Linking"
            />
          ) : null}
        </Pressable>
      ),
      [link, linking, styles, tokens],
    );

    const empty = tasks.isPending ? (
      <View accessibilityLabel="Loading tasks">
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.row}>
            <View style={styles.rowText}>
              <View style={[styles.skeleton, styles.skeletonTitle]} />
              <View style={[styles.skeleton, styles.skeletonDetail]} />
            </View>
          </View>
        ))}
      </View>
    ) : tasks.isError ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => void tasks.refetch()}
        style={styles.message}
      >
        <Text style={styles.detail}>
          Couldn&apos;t load tasks. Tap to try again.
        </Text>
      </Pressable>
    ) : (
      <Text style={[styles.detail, styles.message]}>
        {query.trim() ? `No tasks match "${query.trim()}"` : "No tasks yet"}
      </Text>
    );

    return (
      <BottomSheetModal
        ref={modalRef}
        snapPoints={SNAP_POINTS}
        enableDynamicSizing={false}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onChange={(index) => setOpen(index >= 0)}
        onAnimate={onAnimate}
        onDismiss={() => {
          markClosed();
          setOpen(false);
          setQuery("");
          setFailure(null);
          const run = afterClose;
          setAfterClose(null);
          run?.();
        }}
      >
        <SheetBackToClose onClose={close} />
        <BottomSheetFlatList
          onAccessibilityEscape={close}
          data={tasks.isPending || tasks.isError ? [] : choices}
          keyExtractor={(choice: TaskLinkChoice) => choice.id}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickyHeaderIndices={[0]}
          ListHeaderComponent={
            <View style={styles.header}>
              <SheetHeader
                title="Add a task"
                action={
                  canCreate
                    ? {
                        label: "New task",
                        onPress: () => {
                          setAfterClose(() => onNew);
                          close();
                        },
                        accent,
                        onAccent: tokens.color.gold.onHouse,
                      }
                    : undefined
                }
              />
              {/* `BottomSheetTextInput`, not `SearchField`: a plain input
                  breaks the sheet's keyboard handling (`patterns.md`). */}
              <BottomSheetTextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Search tasks"
                autoCorrect={false}
                returnKeyType="search"
                maxLength={100}
                style={styles.field}
              />
              {failure ? (
                <Text accessibilityRole="alert" style={styles.failure}>
                  {failure}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={empty}
        />
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.popover,
    },
    field: fieldStyles.field,
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 52,
      paddingVertical: tokens.spacing.xs,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    title: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    muted: { color: tokens.color.text.muted },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    pressed: { opacity: 0.7 },
    dimmed: { opacity: 0.5 },
    message: { paddingVertical: tokens.spacing.md },
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    skeleton: {
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.surface1,
    },
    skeletonTitle: { height: 14, width: "60%" },
    skeletonDetail: { height: 12, width: "40%" },
  });
}
