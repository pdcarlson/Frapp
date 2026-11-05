import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { StatusChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  dueChipHue,
  splitAmount,
  type DueState,
} from "@/lib/dues/invoices";

/**
 * One line about the member's last attempt to pay the invoice this card's CTA
 * settles, drawn in the card's caption slot under the CTA.
 *
 * Here rather than above the card: the screen used to insert these as a bare
 * caption over everything, so the card, the CTA the member had just tapped
 * and the whole list jumped down the moment a payment came back.
 */
export interface BalanceCardStatus {
  text: string;
  tone: "neutral" | "destructive";
}

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
  /**
   * The card's invoice has a captured payment the invoice list doesn't read as
   * settled yet (`spec/behavior/billing.md`: the webhook is the source of
   * truth). The CTA stays disabled as "Confirming payment…" and the chip reads
   * Pending until it does; the screen keeps the card on this invoice meanwhile.
   */
  isConfirming?: boolean;
  /**
   * About the invoice the CTA settles, so it takes the caption slot ahead of
   * the blocker and the footnote, and is the CTA's accessibility hint.
   */
  status?: BalanceCardStatus | null;
  /**
   * A settled payment for an invoice the CTA no longer settles. Drawn as its
   * own line under the caption and never as the CTA's hint: it says nothing
   * about the next invoice, and must not hide the footnote naming it.
   */
  receipt?: string | null;
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
  isConfirming = false,
  status = null,
  receipt = null,
  isPaying,
  onPay,
}: BalanceCardProps) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const { whole, fraction } = splitAmount(amountCents);

  const disabled = isPaying || isConfirming || disabledReason !== null;
  // The last attempt's outcome wins, because it is what the member is waiting
  // to read. Then the blocker over the context note: a member who cannot pay
  // does not need to be told which invoice they cannot pay.
  const caption = status?.text ?? disabledReason ?? footnote;
  const captionIsFailure = status?.tone === "destructive";
  const buttonLabel = isPaying
    ? "Opening…"
    : isConfirming
      ? "Confirming payment…"
      : payLabel;

  return (
    <View style={styles.card}>
      <View style={styles.metaRow}>
        <Text style={styles.label}>{label}</Text>
        {isConfirming ? (
          <StatusChip
            label="Pending"
            hue={dueChipHue("pending", tokens.color.semantic)}
          />
        ) : due ? (
          <StatusChip
            label={due.label}
            hue={dueChipHue(due.state, tokens.color.semantic)}
          />
        ) : null}
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
          accessibilityState={{ disabled, busy: isPaying || isConfirming }}
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
            {buttonLabel}
          </Text>
        </Pressable>
      ) : null}

      {caption ? (
        <Text
          style={[
            styles.reason,
            captionIsFailure ? styles.reasonFailure : null,
          ]}
          // Read out on Android when a payment comes back: the line is the
          // outcome the member is waiting for.
          accessibilityLiveRegion={status ? "polite" : undefined}
        >
          {caption}
        </Text>
      ) : null}

      {receipt ? (
        <Text style={styles.reason} accessibilityLiveRegion="polite">
          {receipt}
        </Text>
      ) : null}
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
    reasonFailure: {
      color: tokens.color.semantic.destructive,
    },
  });
}
