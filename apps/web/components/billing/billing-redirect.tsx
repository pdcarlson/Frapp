"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMyPermissions } from "@repo/hooks";
import { can, isBetaOffModule } from "@repo/validation";
import { BILLING_SETTINGS_PATH } from "@/components/billing/billing-paths";
import { personalSettingsHref } from "@/components/personal-settings/personal-settings-sections";
import { SettingsBodySkeleton } from "@/components/settings/settings-skeleton";

/**
 * Where `/billing` sends a viewer now that billing has no page of its own
 * (#3827, decision 8 of #4068).
 *
 * - **`billing:view`**: Plan and billing in Chapter settings, the row the
 *   sidebar entry turned into. `?checkout=` rides along, so a Stripe session
 *   that began before this shipped (its return URL still says `/billing`)
 *   lands on the panel's activation wait as it would have.
 * - **Anyone else**: their own invoices, which is what a member came to
 *   `/billing` for (an invoice notification). While dues is beta-off there
 *   are none and no My invoices row, so they go to chat, the app's home.
 * - **Permissions that failed to load**: Plan and billing. That page fails
 *   open on unknown permissions and its section says what it can't read,
 *   where guessing "member" would hide the plan from a treasurer.
 *
 * Client-side because the permission set is a client read; there is no
 * server session to decide with.
 */
function BillingRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const permissionsQuery = useMyPermissions();
  const checkout = searchParams.get("checkout");

  useEffect(() => {
    if (permissionsQuery.isPending) return;
    const permissions = permissionsQuery.data?.permissions;
    let target: string;
    if (permissionsQuery.isError || can("billing:view", permissions ?? [])) {
      target = checkout
        ? `${BILLING_SETTINGS_PATH}&checkout=${encodeURIComponent(checkout)}`
        : BILLING_SETTINGS_PATH;
    } else if (!isBetaOffModule("dues")) {
      target = personalSettingsHref("invoices");
    } else {
      target = "/chat";
    }
    router.replace(target);
  }, [
    checkout,
    permissionsQuery.data,
    permissionsQuery.isError,
    permissionsQuery.isPending,
    router,
  ]);

  return <SettingsBodySkeleton />;
}

export function BillingRedirect() {
  return (
    <Suspense fallback={<SettingsBodySkeleton />}>
      <BillingRedirectInner />
    </Suspense>
  );
}
