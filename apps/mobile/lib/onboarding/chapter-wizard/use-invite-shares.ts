import { useRef, useState } from "react";
import { Platform, Share } from "react-native";
import { useCreateInvite, useInvites } from "@repo/hooks";
import { serverMessageOf } from "@repo/api-sdk";
import { inviteTokenOf, webJoinUrl } from "./invite-link";

/**
 * The setup invite step's links (`spec/behavior/onboarding.md`, owner pick
 * 2026-11-06 "Share first").
 *
 * An invite lets one person in and lapses after a day, so every share sends
 * a fresh link: one is minted as the step opens, so the share sheet opens at
 * once, and the next is minted as soon as one goes out. The founder never sees
 * a token or a "Create another link" button; they press Share once per
 * person. A sheet dismissed without sending keeps its link for the next press.
 *
 * Shared links are listed newest first and watched while the step is open,
 * so a link that someone redeems reads Joined.
 */

/** The role a setup invite grants: the chapter's default, by name. */
export const INVITE_ROLE = "Member";

/** How often the step re-reads the chapter's invites to mark a link Joined. */
export const INVITE_WATCH_INTERVAL_MS = 15_000;

export interface SharedInvite {
  token: string;
  /** 1 for the first link shared on this step. */
  number: number;
}

export function inviteShareContent(
  url: string,
  chapterName: string,
  os: string = Platform.OS,
): { message: string; url?: string } {
  const message = `Join ${chapterName} on Frapp`;
  // iOS sends `url` as its own item, so Messages draws the link as a preview
  // card under the line. Android shares one string, so the link rides in it.
  return os === "ios" ? { message, url } : { message: `${message}\n${url}` };
}

/** The tokens in a `GET /v1/invites` answer that have been redeemed. */
export function usedInviteTokens(list: unknown): Set<string> {
  const used = new Set<string>();
  if (!Array.isArray(list)) return used;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const { token, used_at } = row as { token?: unknown; used_at?: unknown };
    if (typeof token === "string" && used_at) used.add(token);
  }
  return used;
}

export function useInviteShares({
  active,
  chapterName,
  onError,
}: {
  /** True while the invite step is on screen. */
  active: boolean;
  chapterName: string;
  onError: (message: string | null) => void;
}) {
  const createInvite = useCreateInvite();
  const [ready, setReady] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<SharedInvite[]>([]);
  // A mint already in flight, so the step opening and a fast press don't
  // make two links for one person.
  const pending = useRef<Promise<string | null> | null>(null);

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
          await createInvite.mutateAsync({ role: INVITE_ROLE }),
        );
        if (!token) {
          onError("The invite did not return a token. Try again in a moment.");
          return null;
        }
        setReady(token);
        return token;
      } catch (caught) {
        onError(
          serverMessageOf(caught) ??
            "Couldn't create an invite. You can invite members from the web dashboard.",
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

  /** Mint the first link as the step opens. */
  function prepare() {
    if (!ready && !pending.current) void mint();
  }

  async function share() {
    if (sharing) return;
    onError(null);
    setSharing(true);
    try {
      const token = ready ?? (await mint());
      if (!token) return;
      let result: { action?: string };
      try {
        result = await Share.share(
          inviteShareContent(webJoinUrl(token), chapterName),
        );
      } catch {
        onError("Couldn't open the share sheet. Try again.");
        return;
      }
      // iOS says when the sheet closed without sending; Android can't tell
      // and always reports shared.
      if (result?.action === "dismissedAction") return;
      setShared((rows) => [{ token, number: rows.length + 1 }, ...rows]);
      setReady(null);
      void mint();
    } finally {
      setSharing(false);
    }
  }

  return {
    /** A link is minted and waiting for the next press. */
    hasReady: ready !== null,
    minting,
    /** The first press is waiting on its link. */
    busy: sharing && ready === null && minting,
    shared,
    isJoined: (token: string) => used.has(token),
    prepare,
    share,
  };
}
