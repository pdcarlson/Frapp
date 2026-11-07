import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import { formatBytes } from "@repo/formatting";
import {
  activeMentionQuery,
  mentionPickerEntries,
  type MentionCandidate,
  type MentionPickerEntry,
} from "@repo/validation";
import { initialsFor } from "@/lib/more/narrow";
import { SignetTokens } from "@repo/theme/signet";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { CloseGlyph } from "@/components/control-glyphs";
import { NavGlyph } from "@/components/nav-glyph";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { type ChapterBranding, useChapterBranding } from "@/lib/chapter-branding";

/**
 * The s05 composer (`canvas-screens.dc.html:186-189`).
 *
 * The board draws a 44pt input between a 38pt attach button and a 38pt send
 * button, above a top hairline. The buttons here take the 44pt touch floor
 * instead (components.md §2), and one line of input measures exactly that
 * height, so the three share a top and a bottom edge until the draft wraps
 * (`INPUT_LINE_HEIGHT`).
 *
 * **Send lights up when there is something to send.** It paints the chapter's
 * solid accent (`accentPrimary` under `accentOnPrimary`, the pairing the chat
 * cards and a poll's chosen option use), and nothing sendable draws it in the
 * attach button's neutral recipe instead. A faded accent read as a muddy
 * square rather than "not yet", and two different accent recipes sat side by
 * side in the thread.
 *
 * The attach affordance used to be omitted here. The docblock said why — the
 * upload endpoint existed (`POST /v1/channels/{id}/upload-url`) but a picker,
 * progress and failure states were their own surface, and a disabled button
 * that never becomes enabled reads as a bug. That surface is now built
 * (`lib/chat/attachment-upload.ts`), so the button is real, and the three
 * states it needed are the ones handled below: in-flight (spinner in place of
 * the glyph), refused (the hint line, in the error tone), and staged (chips
 * above the input).
 *
 * **Reply and Edit stage above the input** (#2775) as one strip, `context`:
 * "Replying to <name>" with the parent's preview, or "Editing message". The
 * strip is the member's only sign that the next send is not an ordinary
 * message, so it always carries a cancel. While editing, the send control
 * saves the edit and says so to a screen reader, and the caller withholds the
 * attach control, since an edit changes text only.
 *
 * **`@` opens a member picker** above the input, as web's composer does: the
 * members whose name holds what follows the `@`, from `mentionCandidates`,
 * then the roles this member may ping, from `mentionRoles` (2026-11-06).
 * Picking one writes `@` and their label (`mentionLabelFor` in
 * `@repo/validation`) in place of what was typed, so the body is the plain text
 * a typed handle would be and the server resolves it as one. A space, or moving
 * the caret out of the handle, closes it; with no member matching it says so,
 * as web's does.
 *
 * This is a plain `TextInput`, deliberately. `BottomSheetTextInput` is mandatory
 * only *inside* a gorhom sheet (`spec/ui/mobile/patterns.md` § Bottom sheets);
 * the thread is a full route, so a plain input is correct and a sheet input
 * would break outside its host.
 */

/** What the next send does besides posting: answer a message, or save an edit. */
export interface ComposerContext {
  kind: "reply" | "edit";
  /** The strip's first line: `Replying to <name>` or `Editing message`. */
  title: string;
  /** One line of what is being replied to or edited, or `null` for none. */
  preview: string | null;
  onCancel: () => void;
}

/** The strip's cancel, spoken. */
export function composerCancelLabel(kind: ComposerContext["kind"]): string {
  return kind === "reply" ? "Cancel reply" : "Cancel edit";
}

export interface ChatComposerProps {
  value: string;
  onChangeText: (next: string) => void;
  onSend: () => void;
  /** False while the runtime has no identity, or while offline. */
  canSend: boolean;
  placeholder: string;
  /** Status line above the input — a disabled reason, or a send failure. */
  disabledHint?: string | null;
  /** `error` paints the hint in `semantic.destructive`. Defaults to muted. */
  hintTone?: "muted" | "error";
  /**
   * Uploaded and waiting to be claimed by the next send. The bytes are already
   * in the bucket by the time a chip appears, so removing one drops the claim,
   * not the object.
   */
  attachments?: OutboxAttachment[];
  /** Omit to render no attach affordance at all, rather than an inert one. */
  onAttach?: () => void;
  onRemoveAttachment?: (storagePath: string) => void;
  /** An upload is in flight; the attach control shows a spinner and locks. */
  isUploading?: boolean;
  /**
   * Set when attaching is unavailable right now — offline, or no post
   * permission. It **gates the control and nothing else**: the member-facing
   * explanation belongs in `disabledHint`, which is the composer's one hint
   * slot, so the caller folds the reason in there. Offline is the exception:
   * the app-wide connection pill says it, so the caller passes no hint. Rendering it here as well
   * produced two hints for one composer, and the offline pair contradicted
   * each other. The control stays visible and disabled rather than vanishing —
   * a control that disappears reads as a missing feature.
   */
  attachDisabledReason?: string | null;
  /** A staged reply or an edit in progress; `null` for an ordinary send. */
  context?: ComposerContext | null;
  /**
   * Who `@` offers: the chapter roster, as web's picker reads it. `undefined`
   * while it loads, which offers nothing rather than "No matching members".
   */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * The roles `@` offers after the members (`GET /v1/channels/mention-roles`),
   * each saying whether this member may ping it. `undefined` while it loads,
   * which offers members only.
   */
  mentionRoles?: readonly MentionRoleRow[];
}

/** A role as the picker offers it: a subset of `MentionRoleDto`. */
export interface MentionRoleRow {
  role_id: string;
  name: string;
  mentionable: boolean;
}

type PickerEntry = MentionPickerEntry<MentionCandidate, MentionRoleRow>;

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  canSend,
  placeholder,
  disabledHint,
  hintTone = "muted",
  attachments = [],
  onAttach,
  onRemoveAttachment,
  isUploading = false,
  attachDisabledReason,
  context = null,
  mentionCandidates,
  mentionRoles,
}: ChatComposerProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const inputRef = useRef<TextInput>(null);
  const mention = useMentionPicker(
    inputRef,
    value,
    onChangeText,
    mentionCandidates,
    mentionRoles,
  );

  // An empty or whitespace-only body is not a send — unless something is
  // attached. An attachment-only message is a real message, and gating it on
  // the text alone would strand a photo that is already in the bucket with the
  // send button greyed out and no way to explain why.
  const isSendable =
    canSend && (value.trim().length > 0 || attachments.length > 0);

  const canAttach =
    !!onAttach && !isUploading && !attachDisabledReason && canSend;

  return (
    <View style={styles.wrapper}>
      {disabledHint ? (
        <Text
          // Announced rather than silently painted: a send failure is the one
          // hint a member must not miss, and colour alone would not reach a
          // screen reader.
          accessibilityLiveRegion="polite"
          style={hintTone === "error" ? styles.hintError : styles.hint}
        >
          {disabledHint}
        </Text>
      ) : null}

      {context ? (
        <View style={styles.context}>
          <View style={styles.contextText}>
            <Text numberOfLines={1} style={styles.contextTitle}>
              {context.title}
            </Text>
            {context.preview ? (
              <Text numberOfLines={1} style={styles.contextPreview}>
                {context.preview}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={composerCancelLabel(context.kind)}
            hitSlop={14}
            onPress={context.onCancel}
            style={({ pressed }) => [
              styles.chipRemove,
              pressed ? styles.pressed : null,
            ]}
          >
            <CloseGlyph color={tokens.color.text.muted} size={16} />
          </Pressable>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.chips}>
          {attachments.map((attachment) => (
            <View key={attachment.storagePath} style={styles.chip}>
              <Text numberOfLines={1} style={styles.chipName}>
                {attachment.filename}
              </Text>
              {typeof attachment.byteSize === "number" ? (
                <Text style={styles.chipSize}>
                  {formatBytes(attachment.byteSize)}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.filename}`}
                hitSlop={14}
                onPress={() => onRemoveAttachment?.(attachment.storagePath)}
                style={({ pressed }) => [
                  styles.chipRemove,
                  pressed ? styles.pressed : null,
                ]}
              >
                <CloseGlyph color={tokens.color.text.muted} size={16} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {mention.open ? (
        <MentionPicker
          suggestions={mention.suggestions}
          onPick={mention.pick}
          styles={styles}
        />
      ) : null}

      <View style={styles.row}>
        {onAttach ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
            accessibilityState={{ disabled: !canAttach, busy: isUploading }}
            disabled={!canAttach}
            onPress={onAttach}
            style={({ pressed }) => [
              styles.attach,
              !canAttach ? styles.attachDisabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            {isUploading ? (
              <ActivityIndicator
                accessibilityLabel="Uploading photo"
                color={tokens.color.text.muted}
                size="small"
              />
            ) : (
              <Text style={styles.attachGlyph}>+</Text>
            )}
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          accessibilityLabel={placeholder}
          editable={canSend}
          multiline
          onChangeText={onChangeText}
          onSelectionChange={mention.onSelectionChange}
          onFocus={mention.onFocus}
          onBlur={mention.onBlur}
          placeholder={placeholder}
          placeholderTextColor={tokens.color.text.muted}
          style={styles.input}
          value={value}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            context?.kind === "edit" ? "Save edit" : "Send message"
          }
          accessibilityState={{ disabled: !isSendable }}
          disabled={!isSendable}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            !isSendable ? styles.sendDisabled : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text
            style={[
              styles.sendGlyph,
              !isSendable ? styles.sendGlyphDisabled : null,
            ]}
          >
            ↑
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The picker's state, read off the draft and where the caret sits in it. */
function useMentionPicker(
  inputRef: RefObject<TextInput | null>,
  value: string,
  onChangeText: (next: string) => void,
  candidates: readonly MentionCandidate[] | undefined,
  roles: readonly MentionRoleRow[] | undefined,
) {
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
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
  const active = focused && candidates ? activeMentionQuery(value, at) : null;
  // A filter over one chapter's roster, cheap enough to run every render.
  const suggestions: PickerEntry[] =
    active && candidates
      ? mentionPickerEntries(candidates, roles ?? [], active.query)
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
 * Each row is a 44pt touch target (components.md §2) with the 24pt initials
 * circle the channel member list draws; four rows show and the rest scroll.
 * `keyboardShouldPersistTaps` lets the first tap pick, rather than only close
 * the keyboard.
 */
function MentionPicker({
  suggestions,
  onPick,
  styles,
}: {
  suggestions: readonly PickerEntry[];
  onPick: (label: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
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
                : `Mention everyone in the ${name} role`
            }
            onPress={() => onPick(entry.label)}
            style={({ pressed }) => [
              styles.mentionRow,
              pressed ? styles.mentionRowPressed : null,
            ]}
          >
            <View style={styles.mentionAvatar}>
              {entry.kind === "member" ? (
                <Text style={styles.mentionAvatarText}>
                  {initialsFor(name)}
                </Text>
              ) : (
                // A role has no face: the Roles nav glyph, as web's row and
                // the web sidebar draw it, neutral (foundations.md §6).
                <NavGlyph
                  paths={NAV_GLYPHS.roles}
                  color={styles.mentionAvatarText.color}
                  size={MENTION_ROLE_GLYPH_SIZE}
                />
              )}
            </View>
            <Text numberOfLines={1} style={styles.mentionName}>
              {name}
            </Text>
            {entry.kind === "role" ? (
              <Text style={styles.mentionKind}>Role</Text>
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

/**
 * The input's line height. With body type's 16/25 and 12pt of padding above
 * and below, an empty input on the first Android build measured about 75pt
 * against its 44pt buttons, with the placeholder at the top of a box that
 * looked two lines tall. 20 sits close to the font's own height, so Android
 * (with its font padding off) and iOS lay one line out the same, and it is the
 * figure the vertical padding is worked out from.
 */
const INPUT_LINE_HEIGHT = 20;
const INPUT_BORDER = 1;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  // What is left of the 44pt floor once one line and the border are drawn,
  // split above and below, so a one-line input is exactly button height.
  const inputPaddingY =
    (tokens.touch.minimum - INPUT_LINE_HEIGHT - 2 * INPUT_BORDER) / 2;
  return StyleSheet.create({
    wrapper: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm + 2,
      paddingBottom: tokens.spacing.sm + 2,
      gap: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.background,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    hintError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    chips: {
      gap: tokens.spacing.xs,
    },
    // The quote rule a sent reply carries (`reply-quote.tsx`), so the staged
    // strip reads as the quote the message is about to show.
    context: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.border.hairline,
      paddingLeft: tokens.spacing.sm,
    },
    contextText: {
      flex: 1,
      minWidth: 0,
    },
    contextTitle: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    contextPreview: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    // Same surface recipe as a rendered file attachment
    // (`message-attachments.tsx`), so a staged photo and a sent one read as
    // the same object rather than two different chrome languages.
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingLeft: tokens.spacing.sm,
      paddingRight: tokens.spacing.xs,
      paddingVertical: tokens.spacing.xs,
    },
    chipName: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    chipSize: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      flexShrink: 0,
    },
    // A 16pt × with 14pt of slop on each side reaches the 44pt floor (§2)
    // without making the chip taller.
    chipRemove: {
      marginLeft: "auto",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
    },
    // The staged-chip surface, so the list reads as part of the composer
    // rather than a floating card over the thread.
    mentionList: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingVertical: tokens.spacing.xs,
    },
    mentionListScroll: {
      maxHeight: MENTION_ROWS_SHOWN * tokens.touch.minimum + 2 * tokens.spacing.xs,
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
    input: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      // Multiline grows, but not without bound — past this the thread would be
      // pushed off screen by the composer alone.
      maxHeight: 120,
      borderRadius: tokens.radius.control,
      borderWidth: INPUT_BORDER,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md + 2,
      // Top and bottom set apart, not `paddingVertical`: iOS gives a multiline
      // input a default top inset that only an explicit `paddingTop` replaces.
      paddingTop: inputPaddingY,
      paddingBottom: inputPaddingY,
      ...typeRole({
        ...tokens.typography.role.body,
        lineHeight: INPUT_LINE_HEIGHT,
      }),
      // `includeFontPadding` is Android's: off, a line is the line height and
      // no more, which the padding above counts on. Centring keeps the
      // placeholder on the buttons' midline should a device still measure the
      // empty field a little tall.
      includeFontPadding: false,
      textAlignVertical: "center",
      color: tokens.color.text.foreground,
    },
    // Deliberately NOT the accent. The accent is the send affordance on this
    // row, and two accent controls either side of the input would give the
    // screen two primary actions.
    attach: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    attachDisabled: {
      opacity: 0.4,
    },
    attachGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    // A 1pt border in both states, so the box never shifts as the button flips
    // between them. Lit, it is painted the accent, the same as the fill, so it
    // reads as part of the fill; a lit fill that changes must change it too.
    send: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: brand.accentPrimary,
      backgroundColor: brand.accentPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    // The attach button's recipe: nothing to send is a resting control, not a
    // faded accent.
    sendDisabled: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    pressed: {
      opacity: 0.7,
    },
    sendGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: brand.accentOnPrimary,
    },
    sendGlyphDisabled: {
      color: tokens.color.text.muted,
    },
  });
}
