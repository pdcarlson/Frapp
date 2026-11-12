import { errorCopy } from "@repo/hooks/error-copy";
import { useRef, useState } from "react";
import { Share } from "react-native";
import { useCreateInvite, useInvites } from "@repo/hooks";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { inviteTokenOf, webJoinUrl } from "./invite-link";

/**
 * Share-first invite links: setup's invite step (`spec/behavior/onboarding.md`,
 * owner pick 2026-11-06 "Share first") and, inside a chapter, the Invite
 * members screen (`app/(app)/invite.tsx`) draw the same flow from here.
 *
 * An invite lets one person in and lapses after a day, so every press of
 * Share invite mints a fresh link and opens the share sheet with it. The
 * founder never sees a token or a "Create another link" button; they press
 * Share once per person. Nothing is minted before a press, so a founder who
 * skips the step leaves no invite behind.
 *
 * A sheet closed without sending keeps its link for the next press, where the
 * platform says so: iOS reports the dismissal, Android's chooser can't tell
 * and always reports shared, so there a backed-out sheet lists its link too.
 *
 * Setup's step lists the shared links newest first and watches them while it
 * is open, so a link that someone redeems reads Joined. The Invite members
 * screen draws no such list (`active: false`): its Invited list shows every
 * invite, and tells this hook which kept link has stopped working (`isDead`).
 */

/**
 * The role a setup invite grants, by name: the Everyone role, the seeded
 * Member role until #4191 (`spec/behavior/onboarding.md`). A build that still
 * sends "Member" names no role now, and the redeem falls back to the same one.
 * Not the chapter's configured default, which the Invite members screen gets
 * by naming no role.
 */
export const INVITE_ROLE = EVERYONE_ROLE_NAME;

/** How often the step re-reads the chapter's invites to mark a link Joined. */
export const INVITE_WATCH_INTERVAL_MS = 15_000;

export const SHARE_FAILED_MESSAGE =
  "Couldn't open the share sheet. Try again, or invite members from the web dashboard.";

export interface SharedInvite {
  token: string;
  /** 1 for the first link shared on this step. */
  number: number;
}

/**
 * The link rides in the message on both platforms: iOS hands a separate
 * `url` item only to the targets that take one, and Copy can drop it, while a
 * link inside the text survives every target and still draws Messages'
 * preview card.
 */
export function inviteShareContent(
  url: string,
  chapterName: string,
): { message: string } {
  return { message: `Join ${chapterName} on Frapp\n${url}` };
}

/**
 * The share sheet's options: an iOS mail target (Mail, Gmail) takes `subject`
 * as the email's subject line, so an invite sent from the sheet doesn't go out
 * blank (#3828). Android has no subject option and ignores it.
 */
export function inviteShareOptions(chapterName: string): { subject: string } {
  return { subject: `Join ${chapterName} on Frapp` };
}

/**
 * The tokens in a `GET /v1/invites` answer that someone joined with.
 *
 * A row's `status` decides (#3607): revoking a link also stamps `used_at`, so
 * `used_at` alone would show a revoked link as Joined. `used_at` is read only
 * from a row with no `status`, which an API older than #3652 sends; a store
 * build can meet one during a deploy.
 */
export function usedInviteTokens(list: unknown): Set<string> {
  const used = new Set<string>();
  if (!Array.isArray(list)) return used;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const { token, status, used_at } = row as {
      token?: unknown;
      status?: unknown;
      used_at?: unknown;
    };
    if (typeof token !== "string") continue;
    const joined = typeof status === "string" ? status === "joined" : !!used_at;
    if (joined) used.add(token);
  }
  return used;
}

export function useInviteShares({
  active,
  chapterName,
  role,
  onError,
  isDead,
}: {
  /** True while the invite step is on screen. */
  active: boolean;
  chapterName: string;
  /**
   * The role joining grants, by name. Setup names {@link INVITE_ROLE}; the
   * Invite members screen leaves it out, so the server grants the chapter's
   * configured default invite role (`default_invite_role_id`, #422), as web's
   * invite dialog does.
   */
  role?: string;
  onError: (message: string | null) => void;
  /**
   * Whether a link no longer lets anyone in (revoked, by this officer or
   * another, or expired), so a kept link is dropped rather than sent.
   */
  isDead?: (token: string) => boolean;
}) {
  const createInvite = useCreateInvite();
  const [minting, setMinting] = useState(false);
  const [shared, setShared] = useState<SharedInvite[]>([]);
  // A mint already in flight, so a second press waits for its link rather
  // than making another for the same person.
  const pending = useRef<Promise<string | null> | null>(null);
  // The link of a sheet closed without sending, kept for the next press.
  const unsent = useRef<string | null>(null);
  // Sheets asked for and not yet answered. iOS never answers a sheet whose
  // target was cancelled inside it (`RCTActionSheetManager`), so this only
  // decides whether a refusal is worth showing, never whether Share works.
  const opening = useRef(0);

  const invites = useInvites({
    enabled: active && shared.length > 0,
    refetchInterval: INVITE_WATCH_INTERVAL_MS,
  });
  const used = usedInviteTokens(invites.data);

  function mint(): Promise<string | null> {
    if (pending.current) return pending.current;
    setMinting(true);
    const run = (async () => {
      try {
        const token = inviteTokenOf(
          await createInvite.mutateAsync(role ? { role } : {}),
        );
        if (!token) {
          onError("The invite did not return a token. Try again in a moment.");
        }
        return token;
      } catch (caught) {
        onError(
          errorCopy(
            caught,
            "Couldn't create an invite. You can invite members later from Members.",
          ),
        );
        return null;
      } finally {
        pending.current = null;
        setMinting(false);
      }
    })();
    pending.current = run;
    return run;
  }

  /** Resolves `true` once a link went out, `false` if nothing did. */
  async function share(): Promise<boolean> {
    onError(null);
    if (unsent.current && isDead?.(unsent.current)) unsent.current = null;
    const token = unsent.current ?? (await mint());
    if (!token) return false;
    unsent.current = token;
    opening.current += 1;
    let result: { action?: string };
    try {
      result = await Share.share(
        inviteShareContent(webJoinUrl(token), chapterName),
        inviteShareOptions(chapterName),
      );
    } catch {
      // A second sheet over one already showing is refused; the first is
      // fine, so only a refusal with nothing else open is news.
      if (opening.current === 1) onError(SHARE_FAILED_MESSAGE);
      return false;
    } finally {
      opening.current -= 1;
    }
    if (result?.action === "dismissedAction") return false;
    if (unsent.current === token) unsent.current = null;
    setShared((rows) =>
      rows.some((row) => row.token === token)
        ? rows
        : [{ token, number: rows.length + 1 }, ...rows],
    );
    return true;
  }

  return {
    /** A press is waiting on its link. */
    busy: minting,
    shared,
    isJoined: (token: string) => used.has(token),
    share,
    /**
     * Drops a link kept from a backed-out sheet once it has gone elsewhere:
     * the Invite members screen's list revoked it, or shared it from its
     * row. The next press then mints a fresh one rather than sending a dead
     * link, or one person's link to a second person.
     */
    forget: (token: string) => {
      if (unsent.current === token) unsent.current = null;
    },
  };
}
