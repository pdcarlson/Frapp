import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { taskStatusLabel, type MemberAvatarTint } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusChip } from "@/components/status-chip";
import { PressableRow } from "@/components/list-section";
import { eyebrowStyle } from "@/components/eyebrow";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { GroupProgress } from "@/components/tasks/group-progress";
import { initialsFor } from "@/lib/more/narrow";
import type { TaskRowModel } from "@/lib/tasks/board";
import { taskStatusHue } from "@/lib/tasks/status-hue";
import { copyRemovable, rowStatus } from "@/lib/tasks/task-screen";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/** Rows shown before "N more": a little and a lot (Paul, 2026-11-18). */
export const WHO_HAS_IT_COLLAPSED = 5;

export interface WhoHasItPeople {
  nameOf: (userId: string) => string;
  avatarFor: (userId: string) => string | null;
  tintFor: (userId: string) => MemberAvatarTint;
}

/**
 * Who has it (#5492): a group task's copies, one a member, each with their
 * face, name and where their copy stands in the shared status words and hues,
 * under "3 of 12 done". Collapsed to a few with "N more", which opens the
 * rest in place.
 *
 * In select mode (Remove people) every member is listed with a circle to
 * pick, as Apple Mail's Edit puts a circle on each message; a confirmed copy
 * is dimmed and can't be picked, since its points were paid on it.
 */
export function WhoHasIt({
  copies,
  who,
  progress,
  people,
  viewerId,
  selecting,
  picked,
  onPick,
  note,
}: {
  /** Already in order (`sortCopies`). */
  copies: readonly TaskRowModel[];
  /** Who the task went to ("Everyone in Philanthropy"), said with the count. */
  who: string | null;
  progress: { done: number; total: number };
  people: WhoHasItPeople;
  viewerId: string | null;
  selecting: boolean;
  picked: ReadonlySet<string>;
  onPick: (userId: string) => void;
  /** A line under the rows: what Remove did, or why it can't. */
  note?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  const shown =
    selecting || open ? copies : copies.slice(0, WHO_HAS_IT_COLLAPSED);
  const hidden = copies.length - shown.length;

  return (
    <View style={styles.section}>
      <Text style={styles.label} accessibilityRole="header">
        WHO HAS IT
      </Text>
      <GroupProgress who={who} done={progress.done} total={progress.total} />
      <View>
        {shown.map((copy, index) => (
          <CopyRow
            key={copy.id}
            copy={copy}
            people={people}
            isViewer={copy.assigneeId === viewerId}
            selecting={selecting}
            picked={picked.has(copy.assigneeId ?? "")}
            onPick={onPick}
            first={index === 0}
            styles={styles}
            tokens={tokens}
          />
        ))}
        {hidden > 0 ? (
          <PressableRow
            accessibilityRole="button"
            accessibilityLabel={`Show ${hidden} more`}
            onPress={() => setOpen(true)}
            style={[styles.row, styles.divider]}
          >
            <Text style={styles.more}>{`${hidden} more`}</Text>
            <DisclosureGlyph
              color={tokens.color.text.mutedForeground}
              direction="right"
            />
          </PressableRow>
        ) : null}
      </View>
      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function CopyRow({
  copy,
  people,
  isViewer,
  selecting,
  picked,
  onPick,
  first,
  styles,
  tokens,
}: {
  copy: TaskRowModel;
  people: WhoHasItPeople;
  isViewer: boolean;
  selecting: boolean;
  picked: boolean;
  onPick: (userId: string) => void;
  first: boolean;
  styles: ReturnType<typeof createStyles>;
  tokens: SignetTokens;
}) {
  const userId = copy.assigneeId ?? "";
  const name = people.nameOf(userId);
  const status = rowStatus(copy);
  const label = taskStatusLabel(status);
  const removable = copyRemovable(copy);
  const body = (
    <>
      {selecting ? (
        <View
          style={[
            styles.pick,
            picked
              ? {
                  backgroundColor: tokens.color.semantic.destructive,
                  borderColor: tokens.color.semantic.destructive,
                }
              : null,
          ]}
        >
          {picked ? (
            <CheckGlyph color={tokens.color.semantic.onSemantic} />
          ) : null}
        </View>
      ) : null}
      <MemberAvatar
        uri={people.avatarFor(userId)}
        initials={initialsFor(name)}
        size={tokens.spacing.xl}
        style={styles.avatar}
        textStyle={styles.avatarText}
        tint={people.tintFor(userId)}
      />
      <Text style={styles.name} numberOfLines={1}>
        {isViewer ? `${name} (you)` : name}
      </Text>
      <StatusChip label={label} hue={taskStatusHue(status, tokens)} />
    </>
  );
  const rowStyle = [
    styles.row,
    first ? null : styles.divider,
    selecting && !removable ? styles.dimmed : null,
  ];
  if (!selecting) {
    return (
      <View
        style={rowStyle}
        accessible
        accessibilityLabel={`${name}, ${label}`}
      >
        {body}
      </View>
    );
  }
  return (
    <PressableRow
      accessibilityRole="checkbox"
      accessibilityLabel={`${name}, ${label}`}
      accessibilityHint={
        removable ? undefined : "Confirmed, so this copy stays."
      }
      accessibilityState={{ checked: picked, disabled: !removable }}
      disabled={!removable}
      onPress={() => onPick(userId)}
      style={rowStyle}
    >
      {body}
    </PressableRow>
  );
}

function createStyles(tokens: SignetTokens) {
  // 24pt, the member rows' avatar (`components.md` § Chat member list).
  const AVATAR_SIZE = tokens.spacing.xl;
  return StyleSheet.create({
    section: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.xs,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    // A disabled control's fade (`SheetPrimaryButton`'s).
    dimmed: {
      opacity: 0.5,
    },
    // The board's checkbox at its size, round: a pick, not a completion.
    pick: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      alignItems: "center",
      justifyContent: "center",
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    name: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    more: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
