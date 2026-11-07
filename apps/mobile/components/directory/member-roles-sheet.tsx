import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { statusOf } from "@repo/api-sdk";
import { useRoles, useUpdateMemberRoles } from "@repo/hooks";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import {
  filterRoleOptions,
  orderRoleOptions,
  removeBaseAccessBody,
  removeBaseAccessTitle,
  removesBaseAccess,
  customRolesCaption,
  ROLES_LOCKED_CAPTION,
  rolesSaveFailedBody,
  ROLES_SAVE_FAILED_TITLE,
  toggleRole,
  type RoleOption,
} from "@/lib/directory/role-editor";

/**
 * Edit a member's roles: the only place on mobile that does it (Directory, tap
 * a member, Roles). A stacked tall sheet over the member's profile, as
 * `new-task-sheet.tsx` stacks its assignee picker.
 *
 * **Each tap saves**, as Discord's member role list does on a phone, so there
 * is no Save button to find at the foot of a 113-row list. Saves are sent one
 * at a time with the latest set, so quick taps can't land out of order, and a
 * failed save puts the list back to what the server last confirmed. The status
 * line under the search has a fixed height, so "Saving…" never moves a row.
 *
 * Taking away a member's last role with basic access (Member, or any role with
 * `members:view`) asks first, because it locks them out of chat the way the
 * 2026-11-07 testers were. President is shown but locked: it moves only with
 * Transfer presidency, and the API refuses it here.
 */
export interface MemberRolesSession {
  memberId: string;
  name: string;
  heldIds: string[];
  /** Custom-role labels the member holds, which this editor leaves alone. */
  customRoleNames: string[];
  /** When the profile holding `heldIds` was fetched (ms since epoch). */
  fetchedAt: number;
}

interface SaveLine {
  name: string;
  /** What the server last confirmed. */
  confirmed: string[];
  /** The newest set this sheet chose, sent or waiting. */
  latest: string[];
  /** The newest set waiting behind the save in flight. */
  queued: string[] | null;
  inFlight: boolean;
  /** When the last save landed (ms since epoch), 0 for none. */
  savedAt: number;
}

export interface MemberRolesSheetProps {
  /** Set when the Roles row is tapped; the sheet reads it once per opening. */
  session: MemberRolesSession | null;
  options: readonly RoleOption[];
}

type SaveStatus = "idle" | "saving" | "saved";

export const MemberRolesSheet = forwardRef<
  BottomSheetModal,
  MemberRolesSheetProps
>(function MemberRolesSheet({ session, options }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const updateRoles = useUpdateMemberRoles();
  const rolesQuery = useRoles();

  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [orderedIds, setOrderedIds] = useState<string[]>([]);

  // One save line per member, kept across openings, so a save still out when
  // the officer moves to someone else finishes (or fails out loud) on its own,
  // and coming back joins it rather than starting a second one. Refs, because
  // a save's continuation must see the latest values rather than the render it
  // started in.
  const linesRef = useRef(new Map<string, SaveLine>());
  // Set by the opening effect; a save updates the screen only while its
  // member is the one shown.
  const sessionRef = useRef<MemberRolesSession | null>(null);
  // The set the next tap starts from, so two taps inside one render don't
  // both start from the same stale `draft`.
  const draftRef = useRef<string[]>([]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) return;
    const line = linesRef.current.get(session.memberId);
    // The profile can predate this sheet's last save (the save, or its
    // refetch, may not have landed), so while a save is out, or the profile
    // was fetched before the last one landed, start from what this sheet
    // sent. Otherwise the profile is newer, and starting from it keeps a
    // change made elsewhere (on the web, by another officer) from being sent
    // back over.
    const keep =
      line !== undefined && (line.inFlight || line.savedAt > session.fetchedAt);
    const start = keep ? line.latest : session.heldIds;
    if (!keep) {
      linesRef.current.set(session.memberId, {
        name: session.name,
        confirmed: session.heldIds,
        latest: session.heldIds,
        queued: null,
        inFlight: false,
        savedAt: 0,
      });
    }
    draftRef.current = start;
    setDraft(start);
    setSearch("");
    setStatus(keep && line.inFlight ? "saving" : "idle");
    setOrderedIds(orderRoleOptions(options, start).map((o) => o.id));
    // `options` is read for the opening order only, so a roles refetch while
    // the sheet is open doesn't reshuffle the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const ordered = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    const known = orderedIds
      .map((id) => byId.get(id))
      .filter((o): o is RoleOption => !!o);
    // A role created while the sheet is open goes at the end.
    const seen = new Set(orderedIds);
    return [...known, ...options.filter((o) => !seen.has(o.id))];
  }, [options, orderedIds]);
  const visible = useMemo(
    () => filterRoleOptions(ordered, search),
    [ordered, search],
  );
  const held = useMemo(() => new Set(draft), [draft]);

  const isShown = (memberId: string) =>
    sessionRef.current?.memberId === memberId;

  async function send(memberId: string, line: SaveLine, ids: string[]) {
    line.inFlight = true;
    if (isShown(memberId)) setStatus("saving");
    let current = ids;
    try {
      // Taps that land while a save is out wait in `queued`; only the newest
      // set is sent next, since each save carries the whole list.
      for (;;) {
        await updateRoles.mutateAsync({ id: memberId, role_ids: current });
        line.confirmed = current;
        line.savedAt = Date.now();
        const next = line.queued;
        line.queued = null;
        if (!next) break;
        current = next;
      }
      if (isShown(memberId)) setStatus("saved");
    } catch (caught) {
      line.queued = null;
      line.latest = line.confirmed;
      if (isShown(memberId)) {
        draftRef.current = line.confirmed;
        setDraft(line.confirmed);
        setStatus("idle");
      }
      const status = statusOf(caught);
      if (status === 400) void rolesQuery.refetch();
      // Said even when the officer has moved on, so no change is lost quietly.
      Alert.alert(
        ROLES_SAVE_FAILED_TITLE,
        rolesSaveFailedBody(status, isShown(memberId) ? null : line.name),
      );
    } finally {
      line.inFlight = false;
    }
  }

  function apply(next: string[]) {
    const memberId = sessionRef.current?.memberId;
    const line = memberId ? linesRef.current.get(memberId) : undefined;
    if (!memberId || !line) return;
    draftRef.current = next;
    setDraft(next);
    line.latest = next;
    if (line.inFlight) {
      line.queued = next;
      return;
    }
    void send(memberId, line, next);
  }

  function onToggle(option: RoleOption) {
    if (!session || option.locked) return;
    const current = draftRef.current;
    const next = toggleRole(current, option.id);
    if (removesBaseAccess(current, next, options)) {
      Alert.alert(
        removeBaseAccessTitle(session.name),
        removeBaseAccessBody(session.name),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: `Remove ${option.name}`,
            style: "destructive",
            // A removal, never a toggle: a save that failed while the alert
            // was up may have put the list back, and the button must not
            // then add the role.
            onPress: () => {
              if (!draftRef.current.includes(option.id)) return;
              apply(draftRef.current.filter((id) => id !== option.id));
            },
          },
        ],
      );
      return;
    }
    apply(next);
  }

  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : // A no-break space holds the line, so "Saving…" never shifts the list.
          "\u00a0";

  const customCaption = customRolesCaption(session?.customRoleNames ?? []);

  return (
    <BottomSheetModal
      ref={ref}
      {...tallSheet}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetFlatList
        onAccessibilityEscape={closeSheet}
        data={visible}
        keyExtractor={(option: RoleOption) => option.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // The title, search and status stay pinned over a long list.
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.header}>
            <TallSheetHeader
              title={session ? `${session.name}'s roles` : "Roles"}
              onClose={closeSheet}
            />
            {/* `BottomSheetTextInput`, not `SearchField`: a plain input breaks
                the sheet's keyboard handling (`patterns.md`). */}
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
            <Text
              style={styles.status}
              accessibilityLiveRegion="polite"
              numberOfLines={1}
            >
              {statusText}
            </Text>
            {customCaption ? (
              <Text style={styles.status}>{customCaption}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {options.length === 0
              ? "This chapter has no roles yet."
              : "No roles match that search."}
          </Text>
        }
        renderItem={({ item }: { item: RoleOption }) => {
          const selected = held.has(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={item.name}
              accessibilityHint={item.locked ? ROLES_LOCKED_CAPTION : undefined}
              accessibilityState={{ checked: selected, disabled: item.locked }}
              disabled={item.locked}
              onPress={() => onToggle(item)}
              style={({ pressed }) => [
                styles.row,
                pressed && !item.locked ? styles.rowPressed : null,
              ]}
            >
              <View
                style={[
                  styles.dot,
                  item.color ? { backgroundColor: item.color } : null,
                ]}
              />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, item.locked ? styles.muted : null]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                {item.locked ? (
                  <Text style={styles.caption}>{ROLES_LOCKED_CAPTION}</Text>
                ) : null}
              </View>
              {/* A fixed slot, so names line up whichever rows are on. */}
              <View
                style={styles.check}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {selected ? (
                  <CheckGlyph
                    color={item.locked ? tokens.color.text.muted : brand.accent}
                    size={16}
                  />
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
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.xs,
      // Sticky, so it paints the sheet's own fill over the rows passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    field: fieldStyles.field,
    status: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
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
    rowText: {
      flex: 1,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    muted: {
      color: tokens.color.text.muted,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    check: {
      width: 16,
      alignItems: "center",
    },
  });
}
