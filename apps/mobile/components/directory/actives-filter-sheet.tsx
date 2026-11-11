import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { FilterChips } from "@/components/filter-chips";
import { SectionHeader } from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
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
import {
  countActivesFilters,
  hasRoleQuery,
  NO_ACTIVES_FILTER,
  searchFilterRoles,
  STATUS_OPTIONS,
  type ActivesFilter,
  type ActivesStatus,
  type FilterRole,
} from "@/lib/directory/actives-filter";

/**
 * The Directory's Actives filters (#3971), behind the Filters chip on the
 * Actives tab: Status, Graduation year, the chapter's pledge class when it
 * keeps any, and Role, the four web's Directory toolbar carries.
 *
 * One tall sheet, as LinkedIn's and Slack's phone apps gather a list's filters
 * into one sheet rather than a row of dropdowns a phone has no width for. Each
 * pick applies at once, so the list behind is already narrowed when the sheet
 * closes; there is no Apply button to find.
 *
 * Role is last and is the sheet's list, because a chapter imported from
 * Discord can carry 100+ roles: the short sections ride above it in the list
 * header, the role rows scroll under them, and a search field types the list
 * down the way web's role chip does. One role at a
 * time, as on web; tapping the picked role again clears it.
 */
export interface ActivesFilterSheetProps {
  filter: ActivesFilter;
  onChange: (next: ActivesFilter) => void;
  roles: readonly FilterRole[];
  /** Newest first. */
  years: readonly number[];
  /** The chapter's classes in its own order; empty hides the section. */
  classes: readonly { id: string; name: string }[];
  /** The chapter's word for a pledge class ("Pledge class", "Line"). */
  classWord: string;
  /**
   * Where `GET /v1/roles` stands. Until it has answered, `roles` is empty for
   * want of a read, not because the chapter has none, so the sheet says so
   * (and offers a retry once it has failed) instead of claiming no roles.
   */
  rolesStatus: "loading" | "error" | "ready";
  onRetryRoles: () => void;
}

const ANY = "__any";

export const ActivesFilterSheet = forwardRef<
  BottomSheetModal,
  ActivesFilterSheetProps
>(function ActivesFilterSheet(
  {
    filter,
    onChange,
    roles,
    years,
    classes,
    classWord,
    rolesStatus,
    onRetryRoles,
  },
  ref,
) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const [search, setSearch] = useState("");

  const searching = hasRoleQuery(search);
  const rolesReady = rolesStatus === "ready";
  const visibleRoles = useMemo(
    () => searchFilterRoles(roles, search),
    [roles, search],
  );
  // "Any role" leads the list and steps aside while a search is typed, as
  // web's searchable chip does.
  // No rows at all until the list has answered: the status line under the
  // search stands in for them.
  const rows: readonly (FilterRole | typeof ANY)[] = !rolesReady
    ? []
    : searching
      ? visibleRoles
      : [ANY, ...visibleRoles];
  const setCount = countActivesFilters(filter);

  const set = (patch: Partial<ActivesFilter>) =>
    onChange({ ...filter, ...patch });

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setSearch("")}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetFlatList
        onAccessibilityEscape={closeSheet}
        data={rows}
        keyExtractor={(row: FilterRole | typeof ANY) =>
          row === ANY ? ANY : row.id
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <TallSheetHeader title="Filter actives" onClose={closeSheet} />
            {setCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
                onPress={() => {
                  onChange(NO_ACTIVES_FILTER);
                  // The whole list again, Any role leading it.
                  setSearch("");
                }}
                hitSlop={tokens.spacing.sm}
                style={styles.clear}
              >
                <Text style={[styles.clearText, { color: brand.accent }]}>
                  Clear filters
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.section}>
              <SectionHeader>Status</SectionHeader>
              <FilterChips
                accessibilityLabel="Status"
                selected={filter.status ?? ANY}
                onSelect={(value) =>
                  set({
                    status:
                      value === ANY || value === null
                        ? null
                        : (value as ActivesStatus),
                  })
                }
                chips={[
                  { value: ANY, label: "Any" },
                  ...STATUS_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  })),
                ]}
              />
            </View>

            {years.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader>Graduation year</SectionHeader>
                <FilterChips
                  accessibilityLabel="Graduation year"
                  selected={
                    filter.graduationYear === null
                      ? ANY
                      : String(filter.graduationYear)
                  }
                  onSelect={(value) =>
                    set({
                      graduationYear:
                        value === ANY || value === null ? null : Number(value),
                    })
                  }
                  chips={[
                    { value: ANY, label: "Any" },
                    ...years.map((year) => ({
                      value: String(year),
                      label: String(year),
                    })),
                  ]}
                />
              </View>
            ) : null}

            {classes.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader>{classWord}</SectionHeader>
                <FilterChips
                  accessibilityLabel={classWord}
                  selected={filter.pledgeClassId ?? ANY}
                  onSelect={(value) =>
                    set({
                      pledgeClassId: value === ANY ? null : value,
                    })
                  }
                  chips={[
                    { value: ANY, label: "Any" },
                    ...classes.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader>Role</SectionHeader>
              {/* `BottomSheetTextInput`, not `SearchField`: a plain input
                  breaks the sheet's keyboard handling (`patterns.md`). */}
              <BottomSheetTextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search roles"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Search roles"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          rolesStatus === "error" ? (
            <InlineNote action={{ label: "Retry", onPress: onRetryRoles }}>
              {"Couldn't load roles."}
            </InlineNote>
          ) : (
            <Text style={styles.empty}>
              {rolesStatus === "loading"
                ? "Loading roles…"
                : roles.length === 0
                  ? "This chapter has no roles yet."
                  : "No roles match that search."}
            </Text>
          )
        }
        renderItem={({ item }: { item: FilterRole | typeof ANY }) => {
          const isAny = item === ANY;
          const selected = isAny
            ? filter.roleId === null
            : filter.roleId === item.id;
          const label = isAny ? "Any role" : item.name;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() =>
                set({
                  roleId: isAny || selected ? null : item.id,
                })
              }
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null,
              ]}
            >
              {isAny ? (
                <View style={styles.dotSlot} />
              ) : (
                <View
                  style={[
                    styles.dot,
                    item.color ? { backgroundColor: item.color } : null,
                  ]}
                />
              )}
              <Text style={styles.rowLabel} numberOfLines={1}>
                {label}
              </Text>
              {/* A fixed slot, so names line up whichever row is picked. */}
              <View
                style={styles.check}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {selected ? (
                  <CheckGlyph color={brand.accent} size={16} />
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  const dotSize = 10;
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      gap: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    clear: {
      alignSelf: "flex-start",
    },
    clearText: {
      ...typeRole(tokens.typography.role.label),
    },
    field: fieldStyles.field,
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingVertical: tokens.spacing.md,
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
    dot: {
      width: dotSize,
      height: dotSize,
      borderRadius: dotSize / 2,
      backgroundColor: tokens.color.border.hairline,
    },
    dotSlot: {
      width: dotSize,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    check: {
      width: 16,
      alignItems: "center",
    },
  });
}
