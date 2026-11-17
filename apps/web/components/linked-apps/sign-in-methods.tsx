"use client";

import { Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { signInMethodsFrom, type SignInMethodKey } from "@repo/hooks";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import { NestedError } from "@/components/shared/nested-states";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const ICONS: Record<SignInMethodKey, React.ReactNode> = {
  email: <Mail className="text-foreground" />,
  google: <GoogleMark />,
  apple: <AppleMark />,
};

/**
 * The ways this account signs in (#5407), read from Supabase Auth's
 * identities: email and password, Google, Apple. Each is a Linked apps row,
 * checked when the account has it, the way Google's "Ways you sign in" and
 * GitHub's sign-in methods list them.
 *
 * Status only for now: adding a second method to an existing account needs
 * Supabase's manual identity linking turned on for the project, which is a
 * follow-up.
 */
export function SignInMethodRows() {
  const identities = useQuery({
    queryKey: ["auth", "sign-in-methods"],
    queryFn: async () => {
      const supabase = createSupabaseBrowserClient();
      const [{ data, error }, user] = await Promise.all([
        supabase.auth.getUserIdentities(),
        supabase.auth.getUser(),
      ]);
      if (error) throw error;
      return signInMethodsFrom(
        data?.identities ?? [],
        user.data.user?.email ?? null,
      );
    },
    staleTime: 60_000,
  });

  if (identities.isPending) return null;
  if (identities.isError) {
    return (
      <li className="py-3">
        <NestedError
          title="Couldn't load how you sign in"
          description="Check your connection and try again."
          onRetry={() => void identities.refetch()}
        />
      </li>
    );
  }
  return identities.data.map((method) => (
    <LinkedAppRow
      key={method.key}
      icon={ICONS[method.key]}
      name={method.label}
      state={method}
    />
  ));
}
