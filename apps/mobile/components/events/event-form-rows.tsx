import { forwardRef, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Path } from "react-native-svg";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import {
  EVENT_FORM_GLYPHS,
  type EventFormGlyphName,
} from "@repo/theme/event-form-glyphs";
import { errorCopy, useCreateEventType, type EventType } from "@repo/hooks";
import {
  addEventTypeLabel,
  describeEventTypeSets,
  EVENT_TYPE_FIND_OR_ADD,
  EVENT_TYPE_NAME_MAX_LENGTH,
  EVENT_TYPE_SEARCH_FROM,
  eventTypeToAdd,
} from "@repo/validation";
import { Frame, paint } from "@/components/glyph-recipe";
import {
  CheckGlyph,
  ForwardGlyph,
  PlusGlyph,
} from "@/components/control-glyphs";
import { MAX_ROWS_SIZED_TO_CONTENT } from "@/components/option-sheet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";

/**
 * The New event sheet's property rows (#5561,
 * `spec/ui/design-system/components.md` § Property rows): a mark, a quiet
 * label and the value, one row per setting in grouped lists (#5742), the order
 * web's event form draws (`EVENT_FORM_ROWS`) with the same marks
 * (`@repo/theme/event-form-glyphs`) and words, so the form reads as one on
 * both apps. A row that opens something shows a chevron, as Settings rows do.
 */

/** A row's mark. Decorative: the row names itself. */
export function EventFormGlyph({
  name,
  color,
  size = 18,
}: {
  name: EventFormGlyphName;
  color: string;
  size?: number;
}) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      {EVENT_FORM_GLYPHS[name].map((d) => (
        <Path key={d} d={d} {...detail} />
      ))}
    </Frame>
  );
}

/**
 * One row: the mark, the label, then `children` (a field typed in place) or
 * `value` with `onPress` (a row that opens its picker or sheet).
 */
export function PropertyRow({
  glyph,
  label,
  value,
  empty = false,
  invalid = false,
  onPress,
  disabled = false,
  accessibilityHint,
  children,
}: {
  glyph: EventFormGlyphName;
  label: string;
  value?: string;
  /** The value is a placeholder ("None", "Add a place"): drawn muted. */
  empty?: boolean;
  invalid?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  children?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const inner = (
    <>
      <EventFormGlyph name={glyph} color={tokens.color.text.mutedForeground} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {children ?? (
        <Text
          style={[
            styles.value,
            empty ? styles.valueEmpty : null,
            invalid ? styles.valueInvalid : null,
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
      )}
      {onPress ? (
        <ForwardGlyph color={tokens.color.text.mutedForeground} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? ""}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {inner}
    </Pressable>
  );
}

/** The hairline between two rows of the group. */
export function RowDivider() {
  const { tokens } = useFrappTheme();
  return <View style={createStyles(tokens).divider} />;
}

/**
 * "Type": the chapter's event types in a sheet stacked over the New event
 * sheet, each saying what it sets (`describeEventTypeSets`, the words web's
 * Type menu shows), with "No type" first. Picking one closes it onto the form.
 *
 * Sized to its rows, as {@link OptionSheet} is, so the form stays in sight
 * above it (Paul 2026-11-20: a sheet "taking the whole screen" is an
 * anti-pattern, "you can't see what you're dealing with"); a list past
 * {@link MAX_ROWS_SIZED_TO_CONTENT} rows stops at {@link LONG_TYPE_LIST} and
 * scrolls. It was a tall sheet at full height until then.
 *
 * `typeFromForm`, for someone who can make types (`events:update`), shows the
 * search as "Find or add a type" whatever the count, and a name no type has
 * yet offers "Create “Work party”", which makes the type from the form's
 * points and attendance and holds it, as web's Type menu does.
 */
export const EventTypeSheet = forwardRef<
  BottomSheetModal,
  {
    types: readonly EventType[];
    value: string | null;
    onPick: (type: EventType | null) => void;
    /** Whether each type says what it sets: not for a member (#3709). */
    showSets: boolean;
    /** The type "Create “…”" makes; absent for someone who can't make one. */
    typeFromForm?: (name: string) => {
      name: string;
      point_value: number;
      is_mandatory: boolean;
    };
  }
>(function EventTypeSheet(
  { types, value, onPick, showSets, typeFromForm },
  ref,
) {
  const backgroundStyle = useSheetBackgroundStyle();
  const close = useSheetClose(ref);
  // One more row than the types: No type, and Create while it offers.
  const fits = types.length + 2 <= MAX_ROWS_SIZED_TO_CONTENT;
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...(fits
        ? { enableDynamicSizing: true }
        : { enableDynamicSizing: false, snapPoints: LONG_TYPE_LIST })}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={close} />
      <TypeList
        types={types}
        value={value}
        showSets={showSets}
        fits={fits}
        typeFromForm={typeFromForm}
        onPick={(type) => {
          onPick(type);
          close();
        }}
        onDone={close}
      />
    </BottomSheetModal>
  );
});

/** Where a long type list stops growing: the form's top stays in sight. */
const LONG_TYPE_LIST = ["60%"];

type TypeOption =
  | { kind: "none" }
  | { kind: "type"; type: EventType }
  | { kind: "create"; name: string };

const optionKey = (row: TypeOption) =>
  row.kind === "type" ? row.type.id : row.kind;

function TypeList({
  types,
  value,
  showSets,
  fits,
  typeFromForm,
  onPick,
  onDone,
}: {
  types: readonly EventType[];
  value: string | null;
  showSets: boolean;
  fits: boolean;
  typeFromForm?: (name: string) => {
    name: string;
    point_value: number;
    is_mandatory: boolean;
  };
  onPick: (type: EventType | null) => void;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const insets = useSafeAreaInsets();
  const styles = createStyles(tokens, brand.accent);
  const createType = useCreateEventType();
  const [search, setSearch] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const canAdd = typeFromForm !== undefined;
  const showSearch = canAdd || types.length > EVENT_TYPE_SEARCH_FROM;
  const toAdd = canAdd ? eventTypeToAdd(search, types) : null;
  const rows = useMemo<TypeOption[]>(() => {
    const query = search.trim().toLowerCase();
    const matching = types.filter((type) =>
      type.name.toLowerCase().includes(query),
    );
    return [
      ...(query ? [] : [{ kind: "none" } as const]),
      ...matching.map((type) => ({ kind: "type", type }) as const),
      ...(toAdd ? [{ kind: "create", name: toAdd } as const] : []),
    ];
  }, [types, search, toAdd]);

  async function addType(name: string) {
    if (!typeFromForm || createType.isPending) return;
    setAddError(null);
    try {
      const created = await createType.mutateAsync(typeFromForm(name));
      setSearch("");
      onPick(created);
    } catch (error) {
      setAddError(errorCopy(error, "Couldn't make the type. Try again."));
    }
  }

  const header = (
    <View style={styles.listHeader}>
      <SheetHeader title="Type" />
      {showSearch ? (
        <BottomSheetTextInput
          value={search}
          onChangeText={(next) => {
            setSearch(next);
            setAddError(null);
          }}
          placeholder={canAdd ? EVENT_TYPE_FIND_OR_ADD : "Find a type"}
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel={canAdd ? EVENT_TYPE_FIND_OR_ADD : "Find a type"}
          autoCapitalize={canAdd ? "words" : "none"}
          autoCorrect={false}
          maxLength={EVENT_TYPE_NAME_MAX_LENGTH}
          returnKeyType={toAdd ? "done" : "search"}
          onSubmitEditing={() => {
            if (toAdd) void addType(toAdd);
          }}
          style={styles.search}
        />
      ) : null}
      {addError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {addError}
        </Text>
      ) : null}
    </View>
  );

  const renderRow = (item: TypeOption) => {
    if (item.kind === "create") {
      return (
        <Pressable
          key="create"
          accessibilityRole="button"
          accessibilityLabel={addEventTypeLabel(item.name)}
          accessibilityState={{ disabled: createType.isPending }}
          disabled={createType.isPending}
          onPress={() => void addType(item.name)}
          style={({ pressed }) => [
            styles.typeRow,
            pressed || createType.isPending ? styles.pressed : null,
          ]}
        >
          <View style={styles.check}>
            <PlusGlyph color={tokens.color.text.mutedForeground} size={18} />
          </View>
          <Text style={styles.typeName} numberOfLines={1}>
            {addEventTypeLabel(item.name)}
          </Text>
        </Pressable>
      );
    }
    const type = item.kind === "type" ? item.type : null;
    const held = (type?.id ?? null) === value;
    return (
      <Pressable
        key={optionKey(item)}
        accessibilityRole="radio"
        accessibilityState={{ checked: held }}
        accessibilityLabel={type?.name ?? "No type"}
        onPress={() => onPick(type)}
        style={({ pressed }) => [
          styles.typeRow,
          pressed ? styles.pressed : null,
        ]}
      >
        <View style={styles.check}>
          {held ? <CheckGlyph color={brand.accent} size={18} /> : null}
        </View>
        <Text
          style={[styles.typeName, type ? null : styles.valueEmpty]}
          numberOfLines={1}
        >
          {type?.name ?? "No type"}
        </Text>
        {type && showSets ? (
          <Text style={styles.typeSets} numberOfLines={1}>
            {describeEventTypeSets(type)}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const empty =
    rows.length === 0 ? (
      <Text style={styles.caption}>No type by that name.</Text>
    ) : null;
  const bottomPad = { paddingBottom: insets.bottom + tokens.spacing.md };

  if (fits) {
    return (
      <BottomSheetView
        accessibilityRole="radiogroup"
        onAccessibilityEscape={onDone}
        style={bottomPad}
      >
        {header}
        {rows.map(renderRow)}
        {empty}
      </BottomSheetView>
    );
  }
  return (
    <BottomSheetFlatList
      onAccessibilityEscape={onDone}
      data={rows}
      keyExtractor={optionKey}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.listContent, bottomPad]}
      ListHeaderComponent={header}
      stickyHeaderIndices={[0]}
      ListEmptyComponent={empty}
      renderItem={({ item }: { item: TypeOption }) => renderRow(item)}
    />
  );
}

function createStyles(tokens: SignetTokens, accent?: string) {
  const body = typeRole(tokens.typography.role.body);
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    pressed: {
      opacity: 0.6,
    },
    label: {
      ...body,
      width: 104,
      color: tokens.color.text.mutedForeground,
    },
    value: {
      ...body,
      flex: 1,
      color: tokens.color.text.foreground,
    },
    valueEmpty: {
      color: tokens.color.text.muted,
    },
    valueInvalid: {
      color: tokens.color.semantic.destructive,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
      // Under the label, not the mark, as Settings insets its separators.
      marginLeft: 18 + tokens.spacing.sm,
    },
    listContent: {
      paddingBottom: tokens.spacing.xl,
    },
    listHeader: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.popover,
    },
    search: sheetFieldStyles(tokens, accent ?? tokens.color.text.foreground)
      .field,
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
    },
    typeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    check: {
      width: 18,
    },
    typeName: {
      ...body,
      flex: 1,
      color: tokens.color.text.foreground,
    },
    typeSets: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
