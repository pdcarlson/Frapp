import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import { formatBytes } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { CloseGlyph } from "@/components/control-glyphs";
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
   * slot, so the caller folds the reason in there. Rendering it here as well
   * produced two hints for one composer, and the offline pair contradicted
   * each other. The control stays visible and disabled rather than vanishing —
   * a control that disappears reads as a missing feature.
   */
  attachDisabledReason?: string | null;
  /** A staged reply or an edit in progress; `null` for an ordinary send. */
  context?: ComposerContext | null;
}

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
}: ChatComposerProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);

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
            hitSlop={12}
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
                hitSlop={8}
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
          accessibilityLabel={placeholder}
          editable={canSend}
          multiline
          onChangeText={onChangeText}
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
