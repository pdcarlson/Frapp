import Link from "next/link";
import { AuthScreen } from "@/components/auth/auth-screen";
import { LockGlyph } from "@/components/profile/profile-glyphs";
import { StateTile } from "@/components/shared/async-states";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "No access — Signet",
  description: "You do not have access to the chapter dashboard right now.",
};

/**
 * Signed in, but holding no chapter role.
 *
 * The least broken screen in the Profile & pre-auth family — no staging copy,
 * no opacity washes — so the #920 slice changes three things and leaves the
 * copy, which already names the blocker and three recovery paths as
 * `writing.md` §3 requires.
 *
 * 1. It moves onto the shared pre-auth column, so it stops being a fifth
 *    hand-rolled centred `Card` with its own heading size.
 * 2. The lock tile was a hand-built `h-10 w-10 rounded-full border-border
 *    bg-background` circle: 40px against §10's drawn 44, and `--background`
 *    inside a `--card` is a hole rather than a tile. It takes the shared
 *    `StateTile` recipe now.
 * 3. `title: "No access — Frapp"` → Signet. Prose says Signet; only code
 *    identifiers, package names, domains and bundle ids stay `frapp`.
 */
export default function NoAccessPage() {
  return (
    <AuthScreen
      title="You don't have access yet"
      subtitle="Your account is signed in, but no chapter role has been assigned. A chapter admin needs to invite you or grant a role before you can use the dashboard."
    >
      <div className="flex flex-col gap-6">
        <StateTile tone="accent">
          <LockGlyph className="h-5 w-5" />
        </StateTile>

        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Ask your chapter president to assign you a role.</li>
          <li>
            If you have an invite link, open it again to join the chapter with
            the invited role.
          </li>
          <li>
            If you recently lost access, sign out and back in — your permission
            set refreshes on the next request.
          </li>
        </ul>

        <div className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/join">Open invite link</Link>
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/sign-in">Sign in to a different account</Link>
          </Button>
        </div>
      </div>
    </AuthScreen>
  );
}
