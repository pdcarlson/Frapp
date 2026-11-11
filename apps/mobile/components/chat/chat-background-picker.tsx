import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  CHAT_BACKGROUND_BUILT_INS,
  CHAT_BACKGROUND_LABELS,
  CHAT_BACKGROUND_PHOTO_NOTE,
  chatBackgroundDefaultLabel,
  type ChatBackgroundKey,
} from "@repo/validation";
import {
  CHAT_BACKGROUND_PAINTS,
  type ChatBackgroundBuiltInKey,
} from "@repo/theme/chat-backgrounds";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { ChatBackgroundPaint, useChapterLetters } from "./chat-background";

/** What a swatch press asks for: a key, null to follow the chapter default, or a new photo. */
export type ChatBackgroundSwatchPick = ChatBackgroundKey | null;

/** What the inherit swatch draws: the default's paint, plain for a photo or a key this build doesn't know. */
function inheritPaint(
  inheritPreview: string | undefined,
): ChatBackgroundBuiltInKey {
  return inheritPreview && inheritPreview in CHAT_BACKGROUND_PAINTS
    ? (inheritPreview as ChatBackgroundBuiltInKey)
    : "plain";
}

/**
 * The background swatches (#4031), mobile's twin of web's
 * `ChatBackgroundPicker`: for a channel (the long-press menu's Background
 * view) and for the chapter default (Settings → Chat background). A channel
 * adds "Chapter default" first, which clears its own choice. Each swatch is
 * the thread's own `ChatBackgroundPaint`, drawn small, so the two can't drift.
 *
 * Photo is a press like the rest: the caller opens the library, uploads, and
 * saves (`lib/chat/chat-background-photo.ts`).
 */
export function ChatBackgroundSwatches({
  value,
  allowInherit,
  inheritPreview = "plain",
  disabled = false,
  onPick,
}: {
  /**
   * The stored choice; null when a channel follows the chapter default, and
   * undefined when it couldn't be read, so no swatch claims to be it.
   */
  value: ChatBackgroundKey | null | undefined;
  allowInherit: boolean;
  /** What "Chapter default" would draw. A photo default previews as plain. */
  inheritPreview?: ChatBackgroundKey;
  disabled?: boolean;
  onPick: (pick: ChatBackgroundSwatchPick) => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const letters = useChapterLetters();

  const swatch = (
    key: ChatBackgroundSwatchPick,
    label: string,
    paint: ChatBackgroundKey,
  ) => {
    const selected = value === key;
    return (
      <Pressable
        key={key ?? "inherit"}
        testID={`chat-background-swatch-${key ?? "inherit"}`}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={() => onPick(key)}
        style={({ pressed }) => [
          styles.cell,
          pressed ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <View
          style={[
            styles.swatch,
            selected ? { borderColor: brand.accent, borderWidth: 2 } : null,
          ]}
        >
          {paint === "photo" ? (
            <Text style={styles.photoMark}>
              {value === "photo" ? "Replace" : "Upload"}
            </Text>
          ) : (
            <ChatBackgroundPaint
              paintKey={paint}
              letters={letters}
              idPrefix={`swatch-${key ?? "inherit"}`}
              testID={`chat-background-swatch-paint-${key ?? "inherit"}`}
            />
          )}
        </View>
        <Text
          numberOfLines={2}
          style={[styles.label, selected ? styles.labelSelected : null]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.body}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Chat background"
        style={styles.grid}
      >
        {allowInherit
          ? swatch(
              null,
              chatBackgroundDefaultLabel(inheritPreview),
              inheritPaint(inheritPreview),
            )
          : null}
        {CHAT_BACKGROUND_BUILT_INS.map((key) =>
          swatch(key, CHAT_BACKGROUND_LABELS[key], key),
        )}
        {swatch("photo", CHAT_BACKGROUND_LABELS.photo, "photo")}
      </View>
      <Text style={styles.note}>{CHAT_BACKGROUND_PHOTO_NOTE}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: { gap: tokens.spacing.sm },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: tokens.spacing.sm,
    },
    // Three to a row, whatever the container's width.
    cell: {
      width: "33.33%",
      alignItems: "center",
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.xs,
    },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.6 },
    swatch: {
      width: "100%",
      height: 48,
      borderRadius: tokens.radius.chip,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
    },
    photoMark: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    labelSelected: { color: tokens.color.text.foreground },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
