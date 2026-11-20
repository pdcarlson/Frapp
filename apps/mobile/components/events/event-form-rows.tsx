import { forwardRef, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Path } from "react-native-svg";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  EVENT_FORM_GLYPHS,
  type EventFormGlyphName,
} from "@repo/theme/event-form-glyphs";
import type { EventType } from "@repo/hooks";
import {
  describeEventTypeSets,
  EVENT_TYPE_SEARCH_FROM,
} from "@repo/validation";
import { Frame, paint } from "@/components/glyph-recipe";
import { CheckGlyph, ForwardGlyph } from "@/components/control-glyphs";
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
 * "Type": the chapter's event types as a list stacked over the New event
 * sheet, with a search once there are more than a handful, each saying what
 * it sets (`describeEventTypeSets`, the words web's Type menu shows). It
 * replaces the row of chips that ran off the sheet's edge at seven types; a
 * chapter may keep 30. Picking one closes it onto the form.
 */
export const EventTypeSheet = forwardRef<
  BottomSheetModal,
  {
    types: readonly EventType[];
    value: string | null;
    onPick: (type: EventType | null) => void;
    /** Whether each type says what it sets: not for a member (#3709). */
    showSets: boolean;
  }
>(function EventTypeSheet({ types, value, onPick, showSets }, ref) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
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
        onPick={(type) => {
          onPick(type);
          close();
        }}
        onDone={close}
      />
    </BottomSheetModal>
  );
});


type TypeOption = { id: string | null; type: EventType | null };

function TypeList({
  types,
  value,
  showSets,
  onPick,
  onDone,
}: {
  types: readonly EventType[];
  value: string | null;
  showSets: boolean;
  onPick: (type: EventType | null) => void;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const [search, setSearch] = useState("");
  const rows = useMemo<TypeOption[]>(() => {
    const query = search.trim().toLowerCase();
    const matching = types.filter((type) =>
      type.name.toLowerCase().includes(query),
    );
    return [
      ...(query ? [] : [{ id: null, type: null }]),
      ...matching.map((type) => ({ id: type.id, type })),
    ];
  }, [types, search]);

  return (
    <BottomSheetFlatList
      onAccessibilityEscape={onDone}
      data={rows}
      keyExtractor={(row: TypeOption) => row.id ?? "none"}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <TallSheetHeader
            title="Type"
            onClose={onDone}
            doneAccent={brand.accent}
          />
          {types.length > EVENT_TYPE_SEARCH_FROM ? (
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Find a type"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Find a type"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.search}
            />
          ) : null}
        </View>
      }
      stickyHeaderIndices={[0]}
      ListEmptyComponent={
        <Text style={styles.caption}>No type by that name.</Text>
      }
      renderItem={({ item }: { item: TypeOption }) => {
        const held = item.id === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: held }}
            accessibilityLabel={item.type?.name ?? "No type"}
            onPress={() => onPick(item.type)}
            style={({ pressed }) => [
              styles.typeRow,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={styles.check}>
              {held ? <CheckGlyph color={brand.accent} size={18} /> : null}
            </View>
            <Text
              style={[styles.typeName, item.type ? null : styles.valueEmpty]}
              numberOfLines={1}
            >
              {item.type?.name ?? "No type"}
            </Text>
            {item.type && showSets ? (
              <Text style={styles.typeSets} numberOfLines={1}>
                {describeEventTypeSets(item.type)}
              </Text>
            ) : null}
          </Pressable>
        );
      }}
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
