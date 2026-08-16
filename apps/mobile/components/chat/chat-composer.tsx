import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The s05 composer (`canvas-screens.dc.html:186-189`).
 *
 * Drawn as a 44pt input between a 38pt attach button and a 38pt send button,
 * above a top hairline. Attachments are not in this slice — the upload endpoint
 * exists (`POST /v1/channels/{id}/upload-url`) but a picker, progress, and
 * failure states are their own surface — so the attach affordance is omitted
 * rather than shipped inert. A disabled button that never becomes enabled reads
 * as a bug; an absent one reads as "not yet".
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
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  canSend,
  placeholder,
  disabledHint,
  hintTone = "muted",
}: ChatComposerProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  // An empty or whitespace-only body is not a send. Gating the control as well
  // as the handler keeps the affordance honest rather than silently no-opping.
  const isSendable = canSend && value.trim().length > 0;

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

      <View style={styles.row}>
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
