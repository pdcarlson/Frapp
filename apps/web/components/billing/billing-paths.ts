/**
 * Where billing lives on web: the Plan and billing row of Chapter settings
 * (#3827). `/billing` is only a redirect now, so Stripe's return URLs point
 * here directly rather than bouncing through it.
 */
export const BILLING_SETTINGS_PATH = "/settings?tab=billing";

/** Stripe's way back: Checkout's success and cancel URLs, the Portal's return. */
export function billingReturnUrl(
  origin: string,
  checkout: "success" | "cancelled" | "returned",
): string {
  return `${origin}${BILLING_SETTINGS_PATH}&checkout=${checkout}`;
}

/**
 * Routes What's new stands down on, because Stripe and the chapter wizard
 * land there: a modal over the plan panel would cover its "Complete checkout"
 * and its activation wait. Plan and billing is a tab of `/settings`, and the
 * host reads only the pathname (it sits in the shell, outside any Suspense
 * boundary `useSearchParams` would need), so the whole Chapter settings route
 * is quiet. It opens on the next page instead. `/billing` stays for the
 * moment before its redirect runs.
 */
export const CHECKOUT_LANDING_PATHNAMES = ["/billing", "/settings"] as const;
