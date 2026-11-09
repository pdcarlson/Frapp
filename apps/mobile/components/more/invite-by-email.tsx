import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useEmailInvites } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  dedupeEmails,
  isInviteEmail,
  MAX_INVITE_EMAILS,
  splitAddresses,
} from "@repo/validation";
import {
  SheetPrimaryButton,
  sheetFieldStyles,
} from "@/components/sheet-scaffold";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * What a press of Send does with the field's text, decided before anything is
 * sent. Pure, for the spec.
 *
 * - `empty`: nothing typed.
 * - `invalid`: something typed isn't an address. Nothing goes out, as web's
 *   red chip holds the whole send, so nobody wonders which ones went.
 * - `too-many`: more than `POST /v1/invites/email` takes at once.
 * - `send`: the addresses to send, de-duped the way the server de-dupes.
 */
export type EmailDraft =
  | { kind: "empty" }
  | { kind: "invalid"; invalid: string[] }
  | { kind: "too-many" }
  | { kind: "send"; emails: string[] };

export function readEmailDraft(text: string): EmailDraft {
  const addresses = dedupeEmails(splitAddresses(text));
  if (addresses.length === 0) return { kind: "empty" };
  const invalid = addresses.filter((value) => !isInviteEmail(value));
  if (invalid.length > 0) return { kind: "invalid", invalid };
  if (addresses.length > MAX_INVITE_EMAILS) return { kind: "too-many" };
  return { kind: "send", emails: addresses };
}

/** The line under the field for a draft that can't go out as typed. */
export function emailDraftProblem(draft: EmailDraft): string | null {
  if (draft.kind === "too-many") {
    return `Up to ${MAX_INVITE_EMAILS} addresses at a time. Remove some, then send.`;
  }
  if (draft.kind !== "invalid") return null;
  return draft.invalid.length === 1
    ? `${draft.invalid[0]} isn't an email address. Fix or remove it.`
    : `${draft.invalid.length} of these aren't email addresses. Fix or remove them.`;
}

/** The line under the field for addresses the server couldn't email. */
export function undeliveredProblem(count: number): string {
  return count === 1
    ? "Couldn't email this address. Send again, or share a link for them."
    : `Couldn't email these ${count} addresses. Send again, or share links for them.`;
}

/**
 * Invite by email, on the Invite members screen (Paul, 2026-11-09: "that's
 * the way it should be for mobile as well", #3828). Web's composer
 * (`apps/web/components/members/invite-composer.tsx`) is the model: type one
 * or more addresses and Frapp emails each a single-use join link through
 * `POST /v1/invites/email`, the one sending path both apps share.
 *
 * Phones have no chip field, so addresses are typed into one line, split on
 * spaces, commas and semicolons as web's chips split a paste. The send names
 * no role, so the server grants the chapter's default invite role, as the
 * screen's Share invite does. Addresses the server couldn't email stay in the
 * field, so Send tries them again; their invites already exist and are
 * listed under Invited.
 */
export function InviteByEmail({
  accent,
  onAccent,
  onSent,
}: {
  /** The chapter accent: the field's focus border and the Send fill. */
  accent: string;
  onAccent: string;
  /** Called after at least one invite went out. */
  onSent?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, accent);
  const emailInvites = useEmailInvites();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = emailInvites.isPending;
  // `isPending` settles a render late, so a double tap, or the keyboard's Send
  // then the button, would both get past it and email everyone twice. A ref
  // doesn't wait for a render (InvitedList guards its rows the same way).
  const inFlight = useRef(false);

  const draft = readEmailDraft(text);
  const sendLabel =
    draft.kind === "send" && draft.emails.length > 1
      ? `Send ${draft.emails.length} invites`
      : "Send invite";

  async function send() {
    if (sending || inFlight.current) return;
    setNotice(null);
    const current = readEmailDraft(text);
    if (current.kind !== "send") {
      setProblem(emailDraftProblem(current));
      return;
    }
    setProblem(null);
    const { emails } = current;
    inFlight.current = true;
    try {
      const result = await emailInvites.mutateAsync({ emails });
      const failed = new Set(
        (result?.failed ?? []).map((email) => email.toLowerCase()),
      );
      const kept = emails.filter((email) => failed.has(email.toLowerCase()));
      const sent = emails.filter((email) => !failed.has(email.toLowerCase()));
      setText(kept.join(", "));
      if (kept.length > 0) setProblem(undeliveredProblem(kept.length));
      if (sent.length > 0) {
        setNotice(
          sent.length === 1
            ? `Invite sent to ${sent[0]}`
            : `${sent.length} invites sent`,
        );
        onSent?.();
      }
    } catch (caught) {
      setProblem(
        errorCopy(caught, "Couldn't send invites. Try again in a moment."),
      );
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.label} nativeID="invite-email-label">
        Invite by email
      </Text>
      <TextInput
        accessibilityLabel="Email addresses to invite"
        accessibilityLabelledBy="invite-email-label"
        value={text}
        onChangeText={(next) => {
          setText(next);
          setProblem(null);
          setNotice(null);
        }}
        placeholder="name@school.edu"
        placeholderTextColor={tokens.color.text.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        inputMode="email"
        returnKeyType="send"
        onSubmitEditing={() => void send()}
        editable={!sending}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.field, focused ? styles.fieldFocused : null]}
      />
      <Text style={styles.hint}>
        Separate addresses with commas. Each person gets their own link by
        email.
      </Text>
      <SheetPrimaryButton
        label={sendLabel}
        accent={accent}
        onAccent={onAccent}
        accessibilityHint="Emails each address a link to join."
        disabled={sending || draft.kind === "empty"}
        busy={sending}
        onPress={() => void send()}
      />
      {/* Both can show: a partial delivery says what went out as well as
          what didn't, so no one sends the delivered addresses again. */}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const field = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    field: field.field,
    fieldFocused: field.fieldFocused,
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.success,
    },
  });
}
