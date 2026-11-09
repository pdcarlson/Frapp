import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { NewAccountActions } from "@/components/auth/new-account-actions";
import { resolveRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "New account",
  description: "This sign-in created a new Frapp account.",
};

/**
 * Where `/auth/callback` sends a member whose Google or Apple sign-in created
 * a brand-new account (#3786).
 *
 * GoTrue only links identities it can verify belong together, so a member who
 * joined on the phone with Apple and picks Google here (a different email)
 * gets a fresh, empty account outside their chapter, with nothing on screen to
 * say so. This page says so before onboarding treats them as new, and puts
 * sign-out one step away. It links and merges nothing: attaching a second
 * provider to an existing account is settings linking (#2223).
 *
 * The callback only sends a sign-in here; the sign-up screen's buttons create
 * an account on purpose and skip it. `next` is re-guarded, since it arrives in
 * the query string.
 */
export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = resolveRedirectPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?${new URLSearchParams({ redirectTo: next })}`);
  }

  const account = user.email ? ` for ${user.email}` : "";

  return (
    <AuthScreen
      title="New account created"
      subtitle={`This is a new Frapp account${account}. Already a member? Sign out and use the method you joined with.`}
    >
      <NewAccountActions next={next} />
    </AuthScreen>
  );
}
