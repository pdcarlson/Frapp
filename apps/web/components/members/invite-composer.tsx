"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Link2, Loader2 } from "lucide-react";
import { useCreateInvite, useEmailInvites } from "@repo/hooks";
import { MAX_INVITE_EMAILS, splitAddresses } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { buildJoinUrl } from "@/lib/invite-link";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import {
  addChips,
  EmailChipsInput,
  type EmailChip,
} from "@/components/members/email-chips-input";

/** The addresses being written: the chips, and what is still being typed. */
export type InviteAddresses = { chips: EmailChip[]; draft: string };

export const NO_ADDRESSES: InviteAddresses = { chips: [], draft: "" };

/** How long the Copy link button reads "Copied". */
const COPIED_MS = 2000;

/**
 * Puts text on the clipboard that is still being fetched.
 *
 * Safari only lets a page write the clipboard inside the click that asked for
 * it, and the link doesn't exist until the mint returns. A `ClipboardItem`
 * built from a promise is the sanctioned way to keep the gesture: the browser
 * waits for the text. Browsers without promise items fall back to writing the
 * text once it arrives, which Chromium and Firefox allow after a short await.
 */
export async function copyWhenReady(text: Promise<string>): Promise<void> {
  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": text.then(
            (value) => new Blob([value], { type: "text/plain" }),
          ),
        }),
      ]);
      return;
    } catch {
      // Fall through: a failed mint rethrows from the await below.
    }
  }
  await navigator.clipboard.writeText(await text);
}

/**
 * The two ways to invite someone, shared by the Members panel and the web
 * setup wizard: type their email addresses and send, or copy a join link to
 * paste anywhere. Nothing here shows a token. Each send or copy mints fresh
 * single-use invites (24 hours), so nothing is minted before a press.
 *
 * `role` is the role name to invite as; leave it undefined for the chapter's
 * default. `roleControl` sits left of Send when the caller lets the sender
 * pick one.
 *
 * A caller that keeps the addresses as a draft (the Members panel, #4593)
 * holds them itself through `addresses`, and hears when a send starts and
 * when it fails, so a draft being sent isn't offered to send again.
 */
export function InviteComposer({
  role,
  roleControl,
  disabled = false,
  gate,
  onInvited,
  addresses,
  onAddressesChange,
  onSendStart,
  onSendFailed,
}: {
  role?: string;
  roleControl?: ReactNode;
  /** Pauses both actions, e.g. while the invite data can't load. */
  disabled?: boolean;
  /** The subscription gate for minting (`grace-blocked`), when there is one. */
  gate?: SubscriptionGate;
  /** Called after invites go out, with how many and how. */
  onInvited?: (how: "email" | "link", count: number) => void;
  /** The addresses, for a caller that holds them. */
  addresses?: InviteAddresses;
  /** A change to them, as a patch over the latest. */
  onAddressesChange?: (patch: Partial<InviteAddresses>) => void;
  /** A send is on its way. */
  onSendStart?: () => void;
  /** The send failed outright; the addresses are still there. */
  onSendFailed?: () => void;
}) {
  const fieldId = useId();
  const problemId = useId();
  const { toast } = useToast();
  const emailInvites = useEmailInvites();
  const createInvite = useCreateInvite();
  const [own, setOwn] = useState<InviteAddresses>(NO_ADDRESSES);
  const { chips, draft } = addresses ?? own;
  function change(patch: Partial<InviteAddresses>) {
    if (onAddressesChange) onAddressesChange(patch);
    else setOwn((current) => ({ ...current, ...patch }));
  }
  const setChips = (next: EmailChip[]) => change({ chips: next });
  const setDraft = (next: string) => change({ draft: next });
  const [tooMany, setTooMany] = useState(false);
  const [copied, setCopied] = useState(false);

  const controlProps = (busy: boolean) =>
    gate ? gate.controlProps(disabled || busy) : { disabled: disabled || busy };

  const pending = addChips(chips, splitAddresses(draft));
  const sendable = pending.filter((chip) => chip.problem !== "invalid");
  const invalidCount = chips.filter(
    (chip) => chip.problem === "invalid",
  ).length;
  const undelivered = chips.filter((chip) => chip.problem === "undelivered");
  const sending = emailInvites.isPending;

  function updateChips(next: EmailChip[]) {
    setChips(next);
    setTooMany(false);
  }

  async function send() {
    // An address still being typed counts, as Send in a mail client does.
    setDraft("");
    setChips(pending);
    if (pending.some((chip) => chip.problem === "invalid")) return;
    if (pending.length === 0) return;
    if (pending.length > MAX_INVITE_EMAILS) {
      setTooMany(true);
      return;
    }
    const emails = pending.map((chip) => chip.value);
    onSendStart?.();
    try {
      const result = await emailInvites.mutateAsync({ role, emails });
      const failed = new Set(
        (result?.failed ?? []).map((email) => email.toLowerCase()),
      );
      const sent = emails.length - failed.size;
      // Addresses the server couldn't email stay in the field, marked, so
      // Send tries them again. Their invites exist and are listed under
      // Invited; a later send that gets through retires them.
      setChips(
        emails
          .filter((email) => failed.has(email.toLowerCase()))
          .map((value) => ({ value, problem: "undelivered" as const })),
      );
      if (sent > 0) {
        toast({
          title:
            sent === 1
              ? `Invite sent to ${emails.find((e) => !failed.has(e.toLowerCase()))}`
              : `${sent} invites sent`,
        });
        onInvited?.("email", sent);
      } else {
        // Nothing went out: the addresses are still the draft.
        onSendFailed?.();
      }
    } catch (error) {
      onSendFailed?.();
      toast({
        title: "Couldn't send invites",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function copyLink() {
    const link = createInvite
      .mutateAsync({ role })
      .then((invite) => buildJoinUrl(window.location.origin, invite.token));
    try {
      await copyWhenReady(link);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
      onInvited?.("link", 1);
    } catch (error) {
      // Tell a failed mint from a clipboard the browser refused.
      const minted = await link.then(
        () => true,
        () => false,
      );
      toast({
        title: minted ? "Couldn't copy the link" : "Couldn't create a link",
        description: minted
          ? `Your browser blocked the clipboard. Copy it from here: ${await link}`
          : getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  const problem = tooMany
    ? `Up to ${MAX_INVITE_EMAILS} addresses at a time. Remove some, then send.`
    : invalidCount > 0
      ? invalidCount === 1
        ? "One address in red isn't an email address. Fix or remove it."
        : `${invalidCount} addresses in red aren't email addresses. Fix or remove them.`
      : undelivered.length > 0
        ? undelivered.length === 1
          ? "Couldn't email this address. Send again, or copy a link for them."
          : `Couldn't email these ${undelivered.length} addresses. Send again, or copy links for them.`
        : null;

  const sendLabel =
    sendable.length > 1 ? `Send ${sendable.length} invites` : "Send invite";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor={fieldId} className="text-sm font-semibold">
          Invite by email
        </label>
        <EmailChipsInput
          id={fieldId}
          chips={chips}
          onChipsChange={updateChips}
          draft={draft}
          onDraftChange={(next) => {
            setDraft(next);
            setTooMany(false);
          }}
          placeholder="name@school.edu"
          disabled={sending}
          describedBy={problem ? problemId : undefined}
        />
        {problem ? (
          <p id={problemId} className="text-caption text-destructive-text">
            {problem}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">{roleControl}</div>
          <Button
            type="button"
            onClick={send}
            // A red address holds the whole send, as a mail client's To line
            // does, so nobody wonders whether it went.
            {...controlProps(
              sending || sendable.length === 0 || invalidCount > 0,
            )}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {sendLabel}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground">
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Or share a link</p>
          <p className="text-caption text-muted-foreground">
            Paste it in a group chat. Each link lets one person join, for 24
            hours.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={copyLink}
          // Same width in both states, so the row doesn't jump.
          className="min-w-[6.5rem]"
          {...controlProps(createInvite.isPending)}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Link2 className="h-4 w-4" aria-hidden="true" />
          )}
          <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
        </Button>
      </div>
    </div>
  );
}
