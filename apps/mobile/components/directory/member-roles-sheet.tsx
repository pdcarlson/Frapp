import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { statusOf } from "@repo/api-sdk";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  ASSIGN_COPY,
  memberAssignmentSections,
  useRoles,
  useSetGroupMembership,
  useUpdateMemberRoles,
  type AssignmentRow,
  type ChapterGroup,
} from "@repo/hooks";
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
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import {
  removesBaseAccess,
  rolesSaveFailedBody,
  toggleRole,
  type RoleOption,
} from "@/lib/directory/role-editor";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";
import { useRolesData } from "@/lib/roles/use-roles-data";

/**
 * Give and take a member's roles and groups (Paul, 2026-11-19: one place for
 * both, set from the person), opened by "+ Add role" or "+ Add to group" on
 * their profile. The list is web's (`memberAssignmentSections`): the roles
 * under their tiers, then roles outside them, then the chapter's own groups,
 * with the groups first when it was opened for a group. A role the viewer
 * can't give is shown, dimmed, with why. A group tick saves at once through
 * `POST`/`DELETE /v1/groups/:id/members/:userId`; a pledge class's or class
 * year's group follows the member's own details and is never listed.
 *
 * A stacked tall sheet over the member's profile, as `new-task-sheet.tsx`
 * stacks its assignee picker.
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
 *
 * Rows keep their place as they are ticked: the order is by tier and the
 * role's own order, never by what the member holds.
 */
export interface MemberRolesSession {
  memberId: string;
  /** The member's `users.id`, which groups are keyed by. */
  userId: string;
  /** Which part the sheet opens at. */
  focus: "roles" | "groups";
  /** Whether the viewer may tick roles (`roles:manage`). */
  canManageRoles: boolean;
  /** Whether the viewer may tick groups (`groups:manage`). */
  canManageGroups: boolean;
  name: string;
  heldIds: string[];
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
  /** The chapter's groups (`useGroups`); only the manual ones are listed. */
  groups: readonly ChapterGroup[];
}

type SheetItem =
  | { type: "heading"; key: string; title: string }
  | { type: "role"; key: string; row: AssignmentRow; option: RoleOption }
  | { type: "group"; key: string; row: AssignmentRow; group: ChapterGroup };

type SaveStatus = "idle" | "saving" | "saved";

export const MemberRolesSheet = forwardRef<
  BottomSheetModal,
  MemberRolesSheetProps
>(function MemberRolesSheet({ session, options, groups }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const updateRoles = useUpdateMemberRoles();
  const setMembership = useSetGroupMembership();
  const [groupPending, setGroupPending] = useState<string | null>(null);
  const rolesQuery = useRoles();
  const rolesData = useRolesData();

  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");

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
  }, [session]);

  const items = useMemo<SheetItem[]>(() => {
    if (!session) return [];
    const sections = memberAssignmentSections({
      roles: rolesData.roles,
      tiers: rolesData.tiers,
      groups,
      reach: rolesData.reach,
      canManageRoles: session.canManageRoles,
      canManageGroups: session.canManageGroups,
      heldRoleIds: draft,
      userId: session.userId,
      query: search,
    });
    // Opened from "Add to group", the groups come first.
    const ordered =
      session.focus === "groups"
        ? [
            ...sections.filter((s) => s.key === "groups"),
            ...sections.filter((s) => s.key !== "groups"),
          ]
        : sections;
    const optionsById = new Map(options.map((o) => [o.id, o]));
    const groupsById = new Map(groups.map((g) => [g.id, g]));
    const out: SheetItem[] = [];
    for (const section of ordered) {
      const rows: SheetItem[] = [];
      for (const row of section.rows) {
        if (row.kind === "role") {
          const option = optionsById.get(row.id);
          if (option)
            rows.push({ type: "role", key: `role:${row.id}`, row, option });
        } else {
          const group = groupsById.get(row.id);
          if (group)
            rows.push({ type: "group", key: `group:${row.id}`, row, group });
        }
      }
      if (rows.length > 0) {
        out.push(
          {
            type: "heading",
            key: `heading:${section.key}`,
            title: section.title,
          },
          ...rows,
        );
      }
    }
    return out;
  }, [session, rolesData, groups, draft, search, options]);

  async function onToggleGroup(group: ChapterGroup) {
    if (!session || groupPending) return;
    const inGroup = group.member_ids.includes(session.userId);
    setGroupPending(group.id);
    setStatus("saving");
    try {
      await setMembership.mutateAsync({
        groupId: group.id,
        userId: session.userId,
        in: !inGroup,
      });
      if (!roleSaveOut()) setStatus("saved");
    } catch (caught) {
      if (!roleSaveOut()) setStatus("idle");
      // The API's own words: a channel that names the group, a full group,
      // or a member who has left, none of which a retry fixes.
      Alert.alert(
        inGroup ? ASSIGN_COPY.groupRemoveFailed : ASSIGN_COPY.groupAddFailed,
        errorCopy(caught, undefined, { serverWritesForMembers: true }),
      );
    } finally {
      setGroupPending(null);
    }
  }

  // A role save for this member still out: its "Saving…" stands until it
  // lands, whatever a group tap beside it does.
  const roleSaveOut = () => {
    const memberId = sessionRef.current?.memberId;
    return memberId ? !!linesRef.current.get(memberId)?.inFlight : false;
  };

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
      // A 409 (#4830) also re-reads the member, in useUpdateMemberRoles.
      if (status === 400 || status === 409) void rolesQuery.refetch();
      // Said even when the officer has moved on, so no change is lost quietly.
      Alert.alert(
        ASSIGN_COPY.rolesFailed,
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
    if (!session || option.locked || !session.canManageRoles) return;
    const current = draftRef.current;
    const next = toggleRole(current, option.id);
    if (removesBaseAccess(current, next, options)) {
      Alert.alert(
        ASSIGN_COPY.accessTitle(session.name),
        ASSIGN_COPY.accessBody(session.name),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: ASSIGN_COPY.accessConfirm(option.name),
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

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetFlatList
        onAccessibilityEscape={closeSheet}
        data={items}
        keyExtractor={(item: SheetItem) => item.key}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // The title, search and status stay pinned over a long list.
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.header}>
            <TallSheetHeader
              title={
                session
                  ? `${session.name}'s roles and groups`
                  : "Roles and groups"
              }
              onClose={closeSheet}
            />
            {/* `BottomSheetTextInput`, not `SearchField`: a plain input breaks
                the sheet's keyboard handling (`patterns.md`). */}
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search roles and groups"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Search roles and groups"
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
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {search.trim()
              ? "Nothing matches that search."
              : "This chapter has no roles or groups yet."}
          </Text>
        }
        renderItem={({ item: entry }: { item: SheetItem }) => {
          if (entry.type === "heading") {
            return (
              <Text style={styles.heading} accessibilityRole="header">
                {entry.title}
              </Text>
            );
          }
          const { row } = entry;
          const disabled =
            row.disabledReason !== null ||
            (entry.type === "group" && groupPending !== null);
          const checked = row.held;
          const dim = row.disabledReason !== null;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={row.name}
              accessibilityHint={row.disabledReason ?? undefined}
              accessibilityState={{
                checked,
                disabled,
                busy: entry.type === "group" && groupPending === row.id,
              }}
              disabled={disabled}
              onPress={() =>
                entry.type === "role"
                  ? onToggle(entry.option)
                  : void onToggleGroup(entry.group)
              }
              style={({ pressed }) => [
                styles.row,
                pressed && !disabled ? styles.rowPressed : null,
              ]}
            >
              <View
                style={[
                  styles.dot,
                  row.color ? { backgroundColor: row.color } : null,
                ]}
              />
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, dim ? styles.muted : null]}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                {row.disabledReason ? (
                  <Text style={styles.caption}>{row.disabledReason}</Text>
                ) : null}
              </View>
              {/* A fixed slot, so names line up whichever rows are on. */}
              <View
                style={styles.check}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {checked ? (
                  <CheckGlyph
                    color={dim ? tokens.color.text.muted : brand.accent}
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
    heading: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
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
