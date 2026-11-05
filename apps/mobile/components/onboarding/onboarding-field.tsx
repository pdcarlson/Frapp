import { useState, type Ref } from "react";
import { StyleSheet, Text, TextInput, type TextInputProps } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The text field every onboarding screen draws: sign-in's email and
 * password, join's invite, and setup's search and identity fields. One
 * component, so the flow has one field and one label rather than the three
 * label styles and two heights it had.
 *
 * components.md § Text input: 48pt tall, the surface fill under the input
 * border at rest, and the border in the text-level gold while the field has
 * focus, which is what tells a member where they're typing. Gold, not a
 * chapter accent, since nothing in `(auth)` has a chapter yet. Sheets do the
 * same with the chapter accent (`sheetFieldStyles`).
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
 * sign-in, join and the accent picker's groups already shared.
 */
export function OnboardingFieldLabel({ children }: { children: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.label}>{children}</Text>;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    input: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.buttonLarge,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    focused: {
      borderColor: tokens.color.gold.askText,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
  });
}
