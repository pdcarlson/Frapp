"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { resolveRedirectPath } from "@/lib/auth/redirect";

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Something went wrong. Please try again.";
}

function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTo = resolveRedirectPath(searchParams.get("redirectTo"));

  async function handleSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
        },
      });
      if (error) throw error;

      if (data.session) {
        toast({
          title: "Account created",
          description: "You are signed in and ready to continue.",
        });
        router.replace(redirectTo);
        router.refresh();
        return;
      }

      toast({
        title: "Check your inbox",
        description: "Confirm your email to finish setting up your account.",
      });
      router.replace(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`);
    } catch (error) {
      toast({
        title: "Unable to create account",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-6">
        <div className="max-w-2xl space-y-4">
          <p className="text-sm uppercase tracking-[0.18em] text-primary">
            Frapp account setup
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">
            Create an account for live staging walkthroughs.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            New admins can create their account, bootstrap a chapter, and walk through
            the first real member-management workflow from staging.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>After sign-up</CardTitle>
            <CardDescription>
              Frapp will guide you into chapter setup and activation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>• Create your chapter if you are starting fresh.</p>
            <p>• Activate billing in test mode to unlock invite workflows.</p>
            <p>• Persist active chapter context across refreshes.</p>
            <p>• Continue directly into the live members workflow.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRoundPlus className="h-5 w-5 text-primary" />
              Create your account
            </CardTitle>
            <CardDescription>
              Use a real Supabase-authenticated account for staging.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSignUp}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="president@chapter.org"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a secure password"
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Create account
              </Button>
            </form>

            <div className="mt-6 text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-muted/30" />}>
      <SignUpPageContent />
    </Suspense>
  );
}
