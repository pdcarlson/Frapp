import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { useAuthGateDestination } from "./use-auth-gate";

/**
 * Walks a member who is already inside `(tabs)` onto s02/s03.
 *
 * `(tabs)/_layout.tsx` is frozen and only redirects to sign-in. Without this,
 * `has_completed_onboarding === false` would paint the tabs — the exact
 * unreachability #958's review called out for s03.
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
    if (destination === "welcome" && pathname !== "/welcome") {
      router.replace("/welcome");
    }
  }, [destination, pathname, router]);
}
