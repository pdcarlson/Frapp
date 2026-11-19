import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetTextInput,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import type { TaskWho } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";
import {
  EVERYONE_IN_CHAPTER,
  NOBODY_YET,
  WHO_PICKER_COPY,
  chapterTick,
  initialOpenTiers,
  initialWhoTab,
  isGroupWho,
  personTicked,
  pickerMode,
  setTick,
  tickChecked,
  toggleChapter,
  togglePerson,
  toggleSet,
  whoHint,
  whoSummary,
  withMode,
  type Tick,
  type WhoDirectory,
  type WhoMode,
} from "@repo/hooks/task-who-picker";
import { whoRows, type WhoRow, type WhoTab } from "@/lib/tasks/who-rows";
import type { WhoReadState } from "@/lib/tasks/use-who-directory";

export interface WhoPickerSheetProps {
  /** Who is picked now; the picker is controlled and saves nothing itself. */
  value: TaskWho | null;
  onChange: (next: TaskWho | null) => void;
  directory: WhoDirectory;
  people: WhoReadState;
  sets: WhoReadState;
  /**
   * One person only (an edit, a chat's task, handing over a task up for
   * grabs): people, no Everyone, and a tap picks and closes, as Assign to
   * always did.
   */
  single?: boolean;
  /**
   * Offer a tier whole, "Everyone in Exec board" first under its heading
   * (#5473). Off for a suggested task, whose payload has no tier field yet.
   */
  tiers?: boolean;
  title?: string;
  /** Fired once the sheet has closed, however it closed. */
  onDismiss?: () => void;
}

const MODE_OPTIONS: readonly { value: WhoMode; label: string }[] = [
  { value: "each", label: WHO_PICKER_COPY.each },
  { value: "someone", label: WHO_PICKER_COPY.someone },
];

const TAB_OPTIONS: readonly { value: WhoTab; label: string }[] = [
  { value: "people", label: WHO_PICKER_COPY.people },
  { value: "sets", label: WHO_PICKER_COPY.rolesAndGroups },
];

/**
 * Assign to, on the phone (Paul, 2026-11-18, tasks.md § The Who picker): a tall
 * step stacked over the task form, as Who can see stacks over Edit channel
 * (`channel-access-sheet.tsx`). People are a tick each; Roles and groups is
 * the chapter's own tree (roles under their tiers, then its groups), each
 * ticked whole, with an arrow down to its members. "Everyone in the chapter"
 * heads both tabs, so the tree starts at the chapter. A search finds people,
 * roles and groups together.
 *
 * Once more than one person is in, the footer says who, asks whether each of
 * them does it or one of them claims it (Up for grabs), and says what that
 * makes. One person has no mode, which keeps the common case a tick and Done.
 * Microsoft Planner and ClickUp tick people in an assignee menu; Slack finds
 * user groups beside people in one search; Google Classroom's "All students"
 * or a tick per student is "Each does it"; When I Work's open shifts are "One
 * claims it".
 *
 * Controlled: every tick goes straight to the form, so a swipe away keeps
 * it, and Done only closes.
 */
export const WhoPickerSheet = forwardRef<BottomSheetModal, WhoPickerSheetProps>(
  function WhoPickerSheet(props, ref) {
    const { value, onChange, directory, single = false, onDismiss } = props;
    const backgroundStyle = useSheetBackgroundStyle();
    const tall = useTallSheetProps();
    const close = useSheetClose(ref);
    // The mode a group takes, remembered while one person is picked, so
    // ticking a second person comes back to the last answer.
    const [heldMode, setHeldMode] = useState<WhoMode>(() =>
      pickerMode(value, "each"),
    );
    const mode = pickerMode(value, heldMode);
    const showFooter = !single && isGroupWho(value);

    const setMode = (next: WhoMode) => {
      setHeldMode(next);
      onChange(withMode(value, next));
    };

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        {...tall}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onDismiss={onDismiss}
        footerComponent={
          showFooter
            ? (footer: BottomSheetFooterProps) => (
                <BottomSheetFooter {...footer}>
                  <WhoPickerFooter
                    value={value}
                    directory={directory}
                    mode={mode}
                    onMode={setMode}
                  />
                </BottomSheetFooter>
              )
            : undefined
        }
      >
        <SheetBackToClose onClose={close} />
        {/* gorhom mounts a modal's children only while it is presented, so
            the search, the tab and what is unfolded start fresh each visit. */}
        <WhoPickerBody
          {...props}
          mode={mode}
          onDone={close}
          footerRoom={showFooter}
          onPick={(next) => {
            onChange(next);
            if (single) close();
          }}
        />
      </BottomSheetModal>
    );
  },
);

/** The line, the mode and what it makes: shown once more than one is in. */
export function WhoPickerFooter({
  value,
  directory,
  mode,
  onMode,
}: {
  value: TaskWho | null;
  directory: WhoDirectory;
  mode: WhoMode;
  onMode: (next: WhoMode) => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  return (
    <View style={styles.footer}>
      <Text style={styles.summary} numberOfLines={1}>
        {whoSummary(value, directory)}
      </Text>
      <Segmented
        options={MODE_OPTIONS}
        value={mode}
        onChange={onMode}
        accessibilityLabel="Who does it"
      />
      {/* Two lines held, so a longer hint never moves the footer (P4). */}
      <Text
        style={styles.hint}
        numberOfLines={2}
        accessibilityLiveRegion="polite"
      >
        {whoHint(value, directory)}
      </Text>
    </View>
  );
}

export function WhoPickerBody({
  value,
  directory,
  people,
  sets,
  single = false,
  tiers = true,
  title = WHO_PICKER_COPY.title,
  mode,
  onPick,
  onDone,
  footerRoom,
}: WhoPickerSheetProps & {
  mode: WhoMode;
  onPick: (next: TaskWho | null) => void;
  onDone: () => void;
  footerRoom: boolean;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<WhoTab>(() => initialWhoTab(value));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Taken once as the picker opens: a tier the member folds stays folded.
  const [openTiers, setOpenTiers] = useState(() =>
    initialOpenTiers(value, directory),
  );

  const rows = useMemo(
    () =>
      whoRows(directory, { tab, search, single, expanded, openTiers, tiers }),
    [directory, tab, search, single, expanded, openTiers, tiers],
  );
  const state = single || tab === "people" || search.trim() ? people : sets;

  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const header = (
    <View style={styles.header}>
      <TallSheetHeader
        title={title}
        onClose={onDone}
        doneAccent={brand.accent}
      />
      <BottomSheetTextInput
        value={search}
        onChangeText={setSearch}
        placeholder={
          single ? WHO_PICKER_COPY.searchPeople : WHO_PICKER_COPY.search
        }
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={
          single ? WHO_PICKER_COPY.searchPeople : WHO_PICKER_COPY.search
        }
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.field}
      />
      {single ? null : (
        <Segmented
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Pick from"
        />
      )}
    </View>
  );

  const empty =
    state === "loading"
      ? WHO_PICKER_COPY.loading
      : state === "error"
        ? WHO_PICKER_COPY.setsFailed
        : search.trim()
          ? WHO_PICKER_COPY.noMatch
          : WHO_PICKER_COPY.noSets;

  function renderRow(item: WhoRow) {
    switch (item.kind) {
      case "everyone": {
        const tick = chapterTick(value, directory);
        return (
          <TickRow
            label={EVERYONE_IN_CHAPTER}
            count={String(directory.activeIds.length)}
            tick={tick}
            onPress={() => onPick(toggleChapter(value, mode, directory))}
            styles={styles}
          />
        );
      }
      case "heading":
        return item.tierKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ expanded: !!item.open }}
            onPress={() => setOpenTiers((open) => flip(open, item.tierKey!))}
            style={styles.headingRow}
          >
            <Text style={styles.heading} numberOfLines={1}>
              {item.label}
            </Text>
            <DisclosureGlyph
              color={tokens.color.text.muted}
              size={16}
              direction={item.open ? "down" : "right"}
            />
          </Pressable>
        ) : (
          <Text accessibilityRole="header" style={styles.heading}>
            {item.label}
          </Text>
        );
      case "person": {
        const { person } = item;
        const label = person.isViewer
          ? `${person.name} · ${WHO_PICKER_COPY.you}`
          : person.name;
        if (single) {
          const on = value?.kind === "person" && value.userId === person.userId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() =>
                onPick({ kind: "person", userId: person.userId })
              }
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <Text style={styles.name} numberOfLines={1}>
                {label}
              </Text>
              <View style={styles.checkSlot}>
                {on ? <CheckGlyph color={brand.accent} size={16} /> : null}
              </View>
            </Pressable>
          );
        }
        return (
          <TickRow
            label={label}
            tick={personTicked(value, person.userId, directory) ? "all" : "none"}
            nested={item.nested}
            onPress={() =>
              onPick(togglePerson(value, person.userId, mode, directory))
            }
            styles={styles}
          />
        );
      }
      case "set": {
        const { set } = item;
        const nobody = set.memberIds.length === 0;
        return (
          <TickRow
            label={set.name}
            count={nobody ? NOBODY_YET : String(set.memberIds.length)}
            tick={setTick(value, set, directory)}
            disabled={nobody}
            onPress={() => onPick(toggleSet(value, set, mode, directory))}
            disclosure={
              nobody
                ? undefined
                : {
                    open: item.open,
                    onPress: () =>
                      setExpanded((open) => flip(open, item.key)),
                  }
            }
            styles={styles}
          />
        );
      }
    }
  }

  return (
    <BottomSheetFlatList
      onAccessibilityEscape={onDone}
      data={rows}
      keyExtractor={(row: WhoRow) => row.key}
      contentContainerStyle={[
        styles.content,
        footerRoom ? styles.contentWithFooter : null,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      stickyHeaderIndices={[0]}
      ListEmptyComponent={<Text style={styles.empty}>{empty}</Text>}
      renderItem={({ item }: { item: WhoRow }) => renderRow(item)}
    />
  );
}

type Styles = ReturnType<typeof createStyles>;

/** A tick box: on, partly on (a role some of whose members are in), off. */
function TickBox({ tick, disabled }: { tick: Tick; disabled?: boolean }) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  return (
    <View
      style={[
        styles.box,
        tick !== "none"
          ? { backgroundColor: brand.accent, borderColor: brand.accent }
          : null,
        disabled ? styles.boxDisabled : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {tick === "all" ? (
        <CheckGlyph color={brand.accentOnPrimary} size={13} />
      ) : tick === "some" ? (
        <View
          style={[styles.dash, { backgroundColor: brand.accentOnPrimary }]}
        />
      ) : null}
    </View>
  );
}

function TickRow({
  label,
  count,
  tick,
  onPress,
  disabled = false,
  nested = false,
  disclosure,
  styles,
}: {
  label: string;
  count?: string;
  tick: Tick;
  onPress: () => void;
  disabled?: boolean;
  nested?: boolean;
  disclosure?: { open: boolean; onPress: () => void };
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  return (
    <View style={[styles.row, nested ? styles.nested : null]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={count ? `${label}, ${count}` : label}
        accessibilityState={{
          checked: tickChecked(tick),
          disabled,
        }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tickTarget,
          pressed ? styles.rowPressed : null,
        ]}
      >
        <TickBox tick={tick} disabled={disabled} />
        <Text
          style={[styles.name, disabled ? styles.nameDisabled : null]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {count ? (
          <Text style={styles.count} numberOfLines={1}>
            {count}
          </Text>
        ) : null}
      </Pressable>
      {disclosure ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${disclosure.open ? "Hide" : "Show"} who's in ${label}`}
          accessibilityState={{ expanded: disclosure.open }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={disclosure.onPress}
          style={styles.disclosure}
        >
          <DisclosureGlyph
            color={tokens.color.text.mutedForeground}
            size={18}
            direction={disclosure.open ? "down" : "right"}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Room under the list for the footer, so its last rows scroll clear of it. */
const FOOTER_ROOM = 176;

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  const boxSize = 20;
  const captionLine =
    tokens.typography.role.caption.lineHeight ??
    tokens.typography.role.caption.size * 1.5;
  return StyleSheet.create({
    content: {
      paddingBottom: tokens.spacing.xl,
    },
    contentWithFooter: {
      paddingBottom: FOOTER_ROOM,
    },
    header: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
      // Sticky: rows scroll under it, so it is painted.
      backgroundColor: tokens.color.surface.popover,
    },
    field: fieldStyles.field,
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingRight: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
    },
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    nested: {
      paddingLeft: tokens.spacing.lg + boxSize + tokens.spacing.sm,
    },
    tickTarget: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    rowPressed: {
      opacity: 0.6,
    },
    box: {
      width: boxSize,
      height: boxSize,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: tokens.color.border.input,
      alignItems: "center",
      justifyContent: "center",
    },
    boxDisabled: {
      opacity: 0.4,
    },
    dash: {
      width: 10,
      height: 2,
      borderRadius: 1,
    },
    name: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    nameDisabled: {
      color: tokens.color.text.muted,
    },
    count: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    disclosure: {
      marginLeft: tokens.spacing.sm,
      width: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    checkSlot: {
      width: 16,
      alignItems: "center",
    },
    footer: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.popover,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    summary: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      minHeight: 2 * captionLine,
    },
  });
}
