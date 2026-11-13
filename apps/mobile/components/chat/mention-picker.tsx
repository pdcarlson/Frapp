import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import type { MemberAvatarTint } from "@repo/hooks";
import {
  ASK_COPY,
  activeMentionQuery,
  mentionPickerRows,
  mentionRoleHint,
  reservedMentionName,
  spacedMentionNames,
  type MentionCandidate,
  type MentionPick,
  type MentionPickerRow,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { FrappCrest } from "@/components/frapp-crest";
import { MemberAvatar } from "@/components/member-avatar";
import { NavGlyph } from "@/components/nav-glyph";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/more/narrow";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The `@` list (#3825, #3835): who a field's `@` offers and the list it
 * opens. The composer's, and the Forward sheet's comment (#4907), so a
 * comment's mention is picked the same way a post's is and reaches its member
 * as a `mention_picks` entry rather than through the server's text match.
 */

/** A role as the picker offers it: a subset of `MentionRoleDto`. */
export interface MentionRoleRow {
  role_id: string;
  name: string;
  mentionable: boolean;
  /** `role`, `tier` or `group` (#4076); none from an older API, a role. */
  kind?: string;
}

export type PickerEntry = MentionPickerRow<MentionCandidate, MentionRoleRow>;

/** A member entry's pick, as a field's parent sends it beside the text. */
export function mentionPickFor(entry: PickerEntry): MentionPick | null {
  return entry.kind === "member"
    ? { user_id: entry.member.user_id, label: entry.label }
    : null;
}

/** The picker's state, read off the draft and where the caret sits in it. */
export function useMentionPicker(
  inputRef: RefObject<TextInput | null>,
  value: string,
  onChangeText: (next: string) => void,
  candidates: readonly MentionCandidate[] | undefined,
  roles: readonly MentionRoleRow[] | undefined,
  /** Whether Frapp is offered (#4713). */
  ask: boolean,
) {
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  // The last text the keyboard wrote. The list opens only on text the member
  // is typing, never on text put in the box for them: starting an edit of a
  // message that ends in `@shawn` used to pop the list up over the message the
  // moment Edit was tapped (tester report 2026-11-11), and so did a restored
  // draft. Discord's edit box opens it only once you type. A pick writes text
  // too, and the list should close after one, which this gives for free.
  const [typed, setTyped] = useState<string | null>(null);
  // Anything else that changes the text (a send clearing it, an edit loading,
  // a pick) forgets what was typed, so the same text coming back later, such
  // as the message just sent opening for an edit, is not taken for typing.
  if (typed !== null && value !== typed) setTyped(null);
  // Where the caret goes once a pick's text has reached the input. Set
  // straight away it would land in the old, shorter draft.
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    const target = pendingCaret.current;
    if (target === null || target > value.length) return;
    pendingCaret.current = null;
    inputRef.current?.setSelection?.(target, target);
  }, [inputRef, value]);

  // No selection event yet (a restored draft) reads as a caret at the end.
  const at = Math.min(caret ?? value.length, value.length);
  // The names that hold a space, so a pick inside "@Jane Doe" replaces all of
  // it, not "@Jane" with " Doe" left behind (#3825).
  const spacedNames = useMemo(
    () =>
      spacedMentionNames(
        candidates ?? [],
        (roles ?? []).map((role) => role.name),
      ),
    [candidates, roles],
  );
  const active =
    focused && candidates && value === typed
      ? activeMentionQuery(value, at, spacedNames)
      : null;
  // A filter over one chapter's roster, cheap enough to run every render.
  const suggestions: PickerEntry[] =
    active && candidates
      ? mentionPickerRows(candidates, roles ?? [], active.query, { ask })
      : [];

  const pick = (label: string) => {
    if (!active) return;
    // The whole handle goes, the part after the caret too: a caret dropped
    // into a finished `@JaneDoe` reopens the list, and keeping its tail would
    // write `@JaneDoe Doe`.
    const after = value.slice(active.end);
    // One space after the handle, reusing one already there, as web's does.
    const spaced = after.startsWith(" ");
    const inserted = `@${label}${spaced ? "" : " "}`;
    const next = value.slice(0, active.start) + inserted + after;
    const nextCaret = active.start + inserted.length + (spaced ? 1 : 0);
    setCaret(nextCaret);
    if (next === value) {
      // Nothing to send to the input, so no render will run the effect.
      inputRef.current?.setSelection?.(nextCaret, nextCaret);
      return;
    }
    pendingCaret.current = nextCaret;
    onChangeText(next);
  };

  return {
    open: active !== null,
    suggestions,
    pick,
    onChangeText: (next: string) => {
      setTyped(next);
      onChangeText(next);
    },
    onSelectionChange: (event: {
      nativeEvent: { selection: { start: number; end: number } };
    }) => {
      const { start, end } = event.nativeEvent.selection;
      // A range selected is not a caret in a handle.
      setCaret(start === end ? end : -1);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

/**
 * The member list `@` opens, between the staged strips and the input, so it
 * sits right above where the handle is typed and the keyboard stays up.
 * Each row is a 44pt touch target (components.md §2) with the 24pt avatar
 * (photo, else initials) the channel member list draws; four rows show and the rest scroll.
 * `keyboardShouldPersistTaps` lets the first tap pick, rather than only close
 * the keyboard.
 */
export function MentionPicker({
  suggestions,
  onPick,
  avatarFor,
  avatarTintFor,
}: {
  suggestions: readonly PickerEntry[];
  avatarFor?: (userId: string) => string | null;
  avatarTintFor?: (userId: string) => MemberAvatarTint;
  onPick: (entry: PickerEntry) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { accent } = useChapterBranding();
  if (suggestions.length === 0) {
    return (
      <View style={styles.mentionList}>
        <Text style={styles.mentionEmpty}>No matching members</Text>
      </View>
    );
  }
  return (
    <ScrollView
      accessibilityLabel="Members and roles to mention"
      keyboardShouldPersistTaps="always"
      style={[styles.mentionList, styles.mentionListScroll]}
    >
      {suggestions.map((entry) => {
        if (entry.kind === "ask") {
          return (
            <Pressable
              key="ask-frapp"
              accessibilityRole="button"
              accessibilityLabel={`${ASK_COPY.name}. ${ASK_COPY.mention_hint}`}
              onPress={() => onPick(entry)}
              style={({ pressed }) => [
                styles.mentionRow,
                pressed ? styles.mentionRowPressed : null,
              ]}
            >
              {/* The crest in the chapter's colour, as the Ask Frapp bar
                  draws it (`ask-bar.tsx`). */}
              <View style={styles.mentionAvatar} testID="mention-ask-glyph">
                <FrappCrest height={MENTION_ROLE_GLYPH_SIZE} color={accent} />
              </View>
              <Text numberOfLines={1} style={styles.mentionName}>
                {entry.label}
              </Text>
              <Text style={styles.mentionKind}>{ASK_COPY.mention_hint}</Text>
            </Pressable>
          );
        }
        const name =
          entry.kind === "member" ? entry.member.display_name : entry.role.name;
        return (
          <Pressable
            key={
              entry.kind === "member"
                ? entry.member.user_id
                : `role:${entry.role.role_id}`
            }
            accessibilityRole="button"
            accessibilityLabel={
              entry.kind === "member"
                ? `Mention ${name}`
                : reservedMentionName(name) !== null
                  ? `Mention @${name}. ${mentionRoleHint(name)}`
                  : `Mention everyone in the ${name} ${mentionRoleHint(name, entry.role.kind).toLowerCase()}`
            }
            onPress={() => onPick(entry)}
            style={({ pressed }) => [
              styles.mentionRow,
              pressed ? styles.mentionRowPressed : null,
            ]}
          >
            {entry.kind === "member" ? (
              <MemberAvatar
                uri={avatarFor?.(entry.member.user_id) ?? null}
                initials={initialsFor(name)}
                size={MENTION_AVATAR_SIZE}
                tint={avatarTintFor?.(entry.member.user_id) ?? null}
                style={styles.mentionAvatar}
                textStyle={styles.mentionAvatarText}
              />
            ) : (
              // A role has no face: the Roles nav glyph, as web's row and
              // the web sidebar draw it, neutral (foundations.md §6).
              <View style={styles.mentionAvatar}>
                <NavGlyph
                  paths={NAV_GLYPHS.roles}
                  color={styles.mentionAvatarText.color}
                  size={MENTION_ROLE_GLYPH_SIZE}
                />
              </View>
            )}
            <Text numberOfLines={1} style={styles.mentionName}>
              {name}
            </Text>
            {entry.kind === "role" ? (
              // "Role", "Tier" or "Group", or who `@everyone` and `@here`
              // reach (shared with web).
              <Text style={styles.mentionKind}>
                {mentionRoleHint(name, entry.role.kind)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const MENTION_AVATAR_SIZE = 24;
const MENTION_ROLE_GLYPH_SIZE = 14;
const MENTION_ROWS_SHOWN = 4;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The composer's surface recipe, so the list reads as part of the field
    // it opens over rather than a floating card over the thread.
    mentionList: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingVertical: tokens.spacing.xs,
    },
    mentionListScroll: {
      maxHeight:
        MENTION_ROWS_SHOWN * tokens.touch.minimum + 2 * tokens.spacing.xs,
    },
    mentionRow: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.sm,
    },
    mentionRowPressed: {
      backgroundColor: tokens.color.surface.popover,
    },
    mentionAvatar: {
      width: MENTION_AVATAR_SIZE,
      height: MENTION_AVATAR_SIZE,
      borderRadius: avatarRadius(MENTION_AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    mentionAvatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    mentionName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    // "Role" at the end of a role row, as web's says it.
    mentionKind: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginLeft: "auto",
    },
    mentionEmpty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
  });
}
