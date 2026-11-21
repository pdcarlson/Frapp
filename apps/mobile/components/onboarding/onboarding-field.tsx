import { useState, type Ref } from "react";
import { StyleSheet, Text, TextInput, type TextInputProps } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The text field every onboarding screen draws: sign-in's email and
 * password, join's invite, and setup's search and identity fields. One
 * component, so the flow has one field and one label rather than the three
 * label styles and two heights it had.
 *
 * The sheets' field (`sheetFieldStyles`, which owns components.md § Text
 * input's paint and focus border), at its 44pt height, the touch Field step of
 * foundations.md §9's control size scale (48 until 2026-11-05). The border is
 * what tells a member where they're typing.
 *
 * Its focus border is house gold (`gold.askText`) on purpose. Inside a chapter
 * that border follows the chapter's accent, and `sheetFieldStyles`' own note
 * calls a gold one drift; but nothing in `(auth)` has a chapter yet, so there
 * is no accent to follow, and house gold is what the flow paints everything
 * in (spec/behavior/branding.md). It is not the drift that note describes.
 *
 * Every `TextInput` prop passes through, `ref` included, so a screen can still
 * move focus from one field to the next on Return.
 */
export function OnboardingTextInput({
  ref,
  style,
  onFocus,
  onBlur,
  placeholderTextColor,
  ...props
}: TextInputProps & { ref?: Ref<TextInput> }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      {...props}
      placeholderTextColor={placeholderTextColor ?? tokens.color.text.muted}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[styles.input, style, focused ? styles.focused : null]}
    />
  );
}

/**
 * The label over an onboarding field: uppercase in the muted ink, the style
 * sign-in and join already shared. It is a field's label, not a section
 * eyebrow (`components/eyebrow.ts`).
 */
export function OnboardingFieldLabel({ children }: { children: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.label}>{children}</Text>;
}

function createStyles(tokens: SignetTokens) {
  const field = sheetFieldStyles(tokens, tokens.color.gold.askText);
  return StyleSheet.create({
    input: field.field,
    focused: field.fieldFocused,
    label: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
  });
}
