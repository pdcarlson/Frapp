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

/**
 * The s05 composer (`canvas-screens.dc.html:186-189`).
 *
 * Drawn as a 44pt input between a 38pt attach button and a 38pt send button,
 * above a top hairline.
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
 * This is a plain `TextInput`, deliberately. `BottomSheetTextInput` is mandatory
 * only *inside* a gorhom sheet (`spec/ui/mobile/patterns.md` § Bottom sheets);
 * the thread is a full route, so a plain input is correct and a sheet input
 * would break outside its host.
 */

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
}: ChatComposerProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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
                <Text style={styles.chipRemoveGlyph}>×</Text>
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
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !isSendable }}
          disabled={!isSendable}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            !isSendable ? styles.sendDisabled : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.sendGlyph}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
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
    chipRemoveGlyph: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
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
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md + 2,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.md,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    // Deliberately NOT gold. Gold is the send affordance on this row, and two
    // gold controls either side of the input would give the screen two primary
    // actions (`spec/ui/design-system/components.md` §5, one clear primary).
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
    send: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.chipLarge,
      backgroundColor: tokens.color.gold.house,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.7,
    },
    sendGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.onHouse,
    },
  });
}
