"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CrestPage } from "@/components/shared/crest-page";
import { Button } from "@/components/ui/button";

/**
 * Board `1k`, transcribed. The route did not exist before this lane: an
 * unmatched URL fell through to Next's built-in 404, which is black Times-ish
 * text on browser white — the same defect the #920 slice found on
 * `global-error` and fixed there, left standing one boundary over because
 * nothing in `apps/web` ever called `notFound()` and so nobody hit it from
 * inside the product.
 *
 * It still does not: no module in `apps/web` imports or calls `notFound()` from
 * `next/navigation`, so this renders for mistyped and stale URLs only. The copy
 * is written for that, and is the board's: the two causes it names are the two
 * that actually produce one.
 *
 * (Stated as the fact rather than as a command. The obvious spelling — "`grep
 * -rn notFound apps/web` returns nothing" — stopped being true the moment this
 * file was written, because the grep would then find the sentence claiming it.
 * A check that cannot pass teaches the next reader to ignore it. The real one
 * is `grep -rn "notFound" apps/web --include=*.tsx --include=*.ts | grep -v
 * not-found`, and it is empty.)
 *
 * A client component because of "Go back", which is `history.back()` and has no
 * server spelling. That costs nothing here — `not-found.tsx` supports no
 * `metadata` export in either flavour, so the tab takes the root default.
 *
 * ## "Go back" cannot be a bare `router.back()`
 *
 * This page's dominant arrival is a stale link pasted from a chat or an email,
 * which opens a fresh tab: `history.length` is 1 and `back()` is a silent
 * no-op. That is a control that looks enabled, announces as a button, and does
 * nothing — on the one screen a member is already trying to escape. So it falls
 * back to `/`, which routes a signed-in member to chat and everyone else to
 * sign-in.
 *
 * The check is at click time, not render time: reading `history.length` during
 * render would differ between server and client and hydrate mismatched, and
 * rendering the button only after an effect would pop it in a frame late.
 */
export default function NotFound() {
  const router = useRouter();

  return (
    <CrestPage
      code="404"
      tone="accent"
      title="Nothing lives here."
      description="The link is old, or points at a chapter you're not in."
    >
      <Button asChild size="sm">
        <Link href="/chat">Back to chat</Link>
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (window.history.length > 1) router.back();
          else router.push("/");
        }}
      >
        Go back
      </Button>
    </CrestPage>
  );
}
