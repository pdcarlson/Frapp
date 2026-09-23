import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { useAuthGateDestination } from "./use-auth-gate";

/**
 * Walks a member who is already inside `(tabs)` onto s02/s03, or onto the
 * Terms prompt.
 *
 * `(tabs)/_layout.tsx` is frozen and only redirects to sign-in. Without this,
 * `has_completed_onboarding === false` would paint the tabs — the exact
 * unreachability #958's review called out for s03 — and a member who hasn't
 * accepted the current Terms could keep posting (#2302).
 *
 * The Terms prompt spares `/create-chapter`, which carries its own checkbox
 * and records the acceptance when it submits.
 */
export function useOnboardingRedirect(): void {
  const destination = useAuthGateDestination();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (
      destination === "join" &&
      pathname !== "/join" &&
      pathname !== "/create-chapter" &&
      pathname !== "/chapter-picker"
    ) {
      router.replace("/join");
      return;
    }
    if (
      destination === "terms" &&
      pathname !== "/terms" &&
      pathname !== "/create-chapter"
    ) {
      router.replace("/terms");
      return;
    }
    if (destination === "welcome" && pathname !== "/welcome") {
      router.replace("/welcome");
    }
  }, [destination, pathname, router]);
}
