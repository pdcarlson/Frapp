"use client";

import { CHECKOUT_LANDING_PATHNAMES } from "@/components/billing/billing-paths";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccessibleChapters,
  useAccountWhatsNewSeen,
  useCurrentUser,
  useRecordWhatsNewSeen,
} from "@repo/hooks";
import {
  RELEASE_NOTES,
  accountHasSeenNewest,
  decideWhatsNew,
  type ReleaseNote,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReleaseNoteEntry } from "@/components/whats-new/whats-new";
import { useChapterStore } from "@/lib/stores/chapter-store";
import {
  accountPredatesNote,
  clearWhatsNewPending,
  clearWhatsNewQuiet,
  markWhatsNewQuiet,
  markWhatsNewSeen,
  markWhatsNewUnread,
  readWhatsNewSeen,
  restoreWhatsNewQuiet,
  skipWhatsNew,
  useWhatsNewPending,
} from "@/lib/whats-new";

/**
 * Opens What's new by itself, once, after an update brings a new entry or new
 * lines in the newest one (#3943). The rule is `decideWhatsNew` in
 * `@repo/validation`, the phone's too; `lib/whats-new.ts` says what the
 * browser feeds it. Mounted in the dashboard shell beside the first-run tour.
 *
 * A dialog holding just the entries this browser hasn't shown, closed by Esc,
 * the X or a click outside. The full list stays at `/whats-new`.
 *
 * It waits its turn. Nothing is decided until the member's account and
 * chapter are known, so a member with no chapter (the chapter wizard) is
 * never checked. A visit the first-run tour owns records the entry without
 * showing it. And when it is time to open, it stands down if another dialog
 * or menu is up (the Terms prompt, an invite, anything the member opened) or
 * the route is one it must not cover: the entry stays unread, the account
 * menu's What's new row carries a mark, and the next navigation tries again.
 *
 * The entry is recorded as seen when the dialog opens, so a reload with it
 * open doesn't bring it back, and the account records it too (#4043): a
 * browser whose account has already seen the entry it would open, because
 * another device showed it, doesn't open it; it records it and leaves the
 * account menu's row marked until What's new is opened here. It waits for the
 * account's answer (`useAccountWhatsNewSeen`, a few seconds at most) and goes
 * by its own marker without one.
 */

/** Long enough for the landing route's own dialogs to have opened first. */
export const WHATS_NEW_OPEN_DELAY_MS = 800;

/**
 * Routes it never opens over: the checkout landings
 * (`CHECKOUT_LANDING_PATHNAMES`; the tour stands down there too), and
 * `/whats-new`, which is the notes themselves.
 */
const SUPPRESSED_PREFIXES = [
  ...CHECKOUT_LANDING_PATHNAMES,
  "/whats-new",
] as const;

/** Anything modal or menu-like already on screen. */
const BLOCKING_LAYER =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Membership = { chapter_id: string; has_completed_onboarding: boolean };

export function WhatsNewHost() {
  const pathname = usePathname();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const userQuery = useCurrentUser();
  const user = userQuery.data as { created_at?: string | null } | undefined;
  const account = useAccountWhatsNewSeen({ enabled: Boolean(user) });
  const { mutate: recordOnAccount } = useRecordWhatsNewSeen();

  const membership = useMemo(() => {
    const memberships = Array.isArray(chaptersQuery.data)
      ? (chaptersQuery.data as Membership[])
      : [];
    if (!activeChapterId) return null;
    return memberships.find((m) => m.chapter_id === activeChapterId) ?? null;
  }, [activeChapterId, chaptersQuery.data]);

  // Unseen entries exist and haven't opened yet (`lib/whats-new.ts`).
  const pending = useWhatsNewPending();
  const [shown, setShown] = useState<readonly ReleaseNote[] | null>(null);
  // Once per page load: a new entry only arrives with a new bundle.
  const decided = useRef(false);

  // A quiet mark from an earlier page load stays until What's new is opened.
  useEffect(() => {
    restoreWhatsNewQuiet();
  }, []);

  useEffect(() => {
    const newest = RELEASE_NOTES[0];
    if (decided.current || !newest || !user || !membership) return;
    if (!account.settled) return;
    decided.current = true;
    // A known account that hasn't seen the newest entry backs no quiet mark.
    if (
      account.seen !== undefined &&
      !accountHasSeenNewest(RELEASE_NOTES, account.seen)
    ) {
      clearWhatsNewQuiet();
    }
    const existingInstall = accountPredatesNote(user.created_at, newest);
    const decision = decideWhatsNew({
      notes: RELEASE_NOTES,
      seen: readWhatsNewSeen(),
      tourDue: membership.has_completed_onboarding === false,
      existingInstall,
    });
    if (decision.show.length === 0) {
      if (decision.record) skipWhatsNew(decision.record);
      return;
    }
    if (decision.record && accountHasSeenNewest(RELEASE_NOTES, account.seen)) {
      markWhatsNewQuiet(decision.record);
      return;
    }
    markWhatsNewUnread(existingInstall);
  }, [user, membership, account.settled, account.seen]);

  useEffect(() => {
    if (!pending) return;
    if (
      SUPPRESSED_PREFIXES.some(
        (prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`),
      )
    ) {
      return;
    }
    const timer = setTimeout(() => {
      if (document.querySelector(BLOCKING_LAYER)) return;
      // Again, against the marker as it is now: the member may have read the
      // page, or another tab may have shown the dialog, since the first check.
      const decision = decideWhatsNew({
        notes: RELEASE_NOTES,
        seen: readWhatsNewSeen(),
        tourDue: false,
        existingInstall: pending.existingInstall,
      });
      if (decision.show.length === 0) {
        // Read elsewhere meanwhile (the page, another tab): clear only what
        // this host set, and leave a quiet mark another tab may have set.
        clearWhatsNewPending();
        return;
      }
      const version = markWhatsNewSeen();
      setShown(decision.show);
      if (version) recordOnAccount(version);
    }, WHATS_NEW_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, pathname, recordOnAccount]);

  if (!shown) return null;
  const close = () => setShown(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex max-h-[min(85dvh,40rem)] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription className="sr-only">
            What changed in Frapp since you were last here.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 pb-6">
          {shown.map((note) => (
            <ReleaseNoteEntry
              key={note.date}
              note={note}
              idPrefix="whats-new-dialog"
            />
          ))}
          {/*
            No Got it: the X, Esc and a click outside close a read-only
            dialog, and a button would be a second close (components.md
            § Chrome weight). The one action is the way to the full list.
          */}
          <Button variant="link" size="sm" className="px-0" asChild>
            <Link href="/whats-new" onClick={close}>
              See all updates
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
