import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { NewAccountActions } from "@/components/auth/new-account-actions";
import { isNewAccount } from "@/lib/auth/new-account-detection";
import { resolveRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "New account",
  description: "This sign-in created a new Frapp account.",
};

/**
 * Where `/auth/callback` sends a member whose sign-in from the sign-in screen
 * created a brand-new account: a Google or Apple account (#3786), or a
 * chapterless email account a magic link made for an address the member never
 * joined with (#3801).
 *
 * GoTrue only links identities it can verify belong together, so a member who
 * joined on the phone with Apple and picks Google here (a different email)
 * gets a fresh, empty account outside their chapter, and `signInWithOtp`
 * creates one for an unknown email by default, with nothing on screen to say
 * so either way. This page says so before onboarding treats them as new, and
 * puts sign-out one step away. It links and merges nothing: attaching a second
 * provider to an existing account is settings linking (#2223).
 *
 * The callback only sends a sign-in here; the sign-up screen creates an account
 * on purpose and skips it. `next` is re-guarded, since it arrives in the query
 * string. The page asks the callback's own question again (`isNewAccount`)
 * rather than trusting a query flag, so a revisit (a bookmark, or the proxy
 * returning a member here after signing back in with the method they joined
 * with) sends an account that isn't new on to `next`. That second ask reads
 * `GET /v1/chapters` again for a new email account and, like the callback,
 * falls open to `next` if it can't.
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
  // `getUser` verifies the user; the email check also needs the access token
  // for its chapters read, which only the session carries.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!(await isNewAccount(user, session?.access_token))) {
    redirect(next);
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
