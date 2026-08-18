import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { StatusChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import { splitAmount, type DueState } from "@/lib/dues/invoices";

/**
 * The balance card at the top of s11 — `canvas-screens.dc.html`, `id="s11"`.
 *
 * ## Two drawn elements are missing, on purpose
 *
 * TODO-DESIGN: Canvas labels the balance `Fall 2026 · balance`. Invoices carry
 * a `title` and a `due_date` and no semester field, so the label here is the
 * invoice's own title when there is exactly one, and a count when there are
 * several. Inventing a semester would put a term name on a bill the chapter
 * never scoped to one.
 *
 * TODO-DESIGN: the drawn secondary line offers "request a payment plan — needs
 * treasurer approval by Sept 8". No payment-plan model exists:
 * `spec/behavior/billing.md` has no plan state, endpoint or approval flow, and
 * `chapter_dues_config.installments_allowed` has no member-facing request path.
 * Omitted rather than rendered as a dead control (`screens.md`: drawn elements
 * with no backing data are omitted, not faked). Filed.
 */
export interface BalanceCardProps {
  label: string;
  amountCents: number;
  due: { state: DueState; label: string } | null;
  /** Rendered as the CTA label; `null` hides the control entirely. */
  payLabel: string | null;
  /** Present when payment is blocked — the control disables and says why. */
  disabledReason: string | null;
  /** Context shown under an *enabled* CTA, e.g. which invoice it pays. */
  footnote: string | null;
  isPaying: boolean;
  onPay: () => void;
}

export function BalanceCard({
  label,
  amountCents,
  due,
  payLabel,
  disabledReason,
  footnote,
  isPaying,
  onPay,
}: BalanceCardProps) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const { whole, fraction } = splitAmount(amountCents);

  const chipHue =
    due?.state === "past-due"
      ? tokens.color.semantic.destructive
      : tokens.color.semantic.warning;
  const disabled = isPaying || disabledReason !== null;
  // The blocker wins over the context note: a member who cannot pay does not
  // need to be told which invoice they cannot pay.
  const caption = disabledReason ?? footnote;

  return (
    <View style={styles.card}>
      <View style={styles.metaRow}>
        <Text style={styles.label}>{label}</Text>
        {due ? <StatusChip label={due.label} hue={chipHue} /> : null}
      </View>

      <Text
        style={styles.amount}
        accessibilityLabel={`Balance ${whole}${fraction}`}
      >
        {whole}
        <Text style={styles.amountFraction}>{fraction}</Text>
      </Text>

      {payLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={payLabel}
          accessibilityState={{ disabled, busy: isPaying }}
          // §5 rule 4: disable and name the reason, never hide a recoverable
          // block — and the reason is wired to the control for a screen reader
          // rather than only sitting near it.
          accessibilityHint={caption ?? undefined}
          disabled={disabled}
          onPress={onPay}
          style={({ pressed }) => [
            styles.payButton,
            { backgroundColor: accent },
            disabled ? styles.payButtonDisabled : null,
            pressed && !disabled ? styles.payButtonPressed : null,
          ]}
        >
          <Text style={[styles.payLabel, { color: tokens.color.gold.onHouse }]}>
            {isPaying ? "Opening…" : payLabel}
          </Text>
        </Pressable>
      ) : null}

      {caption ? <Text style={styles.reason}>{caption}</Text> : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    label: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    amount: {
      // TODO-DESIGN: Canvas draws 40px/700; `display` is 32/700 and arithmetic
      // on a role token is banned by foundations.md §7, so the nearest role wins.
      ...typeRole(tokens.typography.role.display),
      letterSpacing: -0.8,
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.sm,
    },
    amountFraction: {
      // The drawn second tier: the cents sit at roughly half the dollar size in
      // a muted tone. `title` is the nearest role below `display`.
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    payButton: {
      // 50px as drawn, following `components/sheet-scaffold.tsx` — the
      // reference wins over components.md §9's 46–48px band per
      // `spec/ui/README.md`'s precedence rule, and diverging from the sheet CTA
      // would put two different primary heights in one app.
      height: 50,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
      marginTop: tokens.spacing.lg,
    },
    payButtonPressed: {
      opacity: 0.85,
    },
    payButtonDisabled: {
      opacity: 0.5,
    },
    payLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    reason: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      marginTop: tokens.spacing.md,
    },
  });
}
