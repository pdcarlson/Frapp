"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, LogIn, ShieldCheck } from "lucide-react";
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

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMagicLinkPending, setIsMagicLinkPending] = useState(false);
  const redirectTo = resolveRedirectPath(searchParams.get("redirectTo"));

  async function handlePasswordSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      toast({
        title: "Signed in",
        description: "Welcome back to Frapp.",
      });
      router.replace(redirectTo);
      router.refresh();
    } catch (error) {
      toast({
        title: "Unable to sign in",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMagicLink() {
    if (!email) {
      toast({
        title: "Email required",
        description: "Enter your email address to request a magic link.",
        variant: "destructive",
      });
      return;
    }

    setIsMagicLinkPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
        },
      });
      if (error) throw error;

      toast({
        title: "Magic link sent",
        description: "Check your inbox to continue signing in.",
      });
    } catch (error) {
      toast({
        title: "Unable to send magic link",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsMagicLinkPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-6">
        <div className="max-w-2xl space-y-4">
          <p className="text-sm uppercase tracking-[0.18em] text-primary">
            Frapp admin access
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">
            Sign in to manage your chapter in staging.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            Use your real Supabase account to open the live dashboard, select a chapter,
            and test member administration workflows against staging data.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>What this unlocks</CardTitle>
            <CardDescription>
              This milestone enables real staging usage, not preview data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>• Real Supabase-authenticated sessions on the web.</p>
            <p>• Chapter bootstrap and active chapter persistence.</p>
            <p>• Live members directory, member detail, and invite flows.</p>
            <p>• Billing activation handoff for invite-enabled chapters.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              New to Frapp?
            </CardTitle>
            <CardDescription>
              Create your admin account, then bootstrap a chapter in staging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              After signing up, the app will guide you through chapter creation,
              billing activation, and live member administration.
            </p>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href={`/sign-up?redirectTo=${encodeURIComponent(redirectTo)}`}>
                Create an account
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              Sign in
            </CardTitle>
            <CardDescription>
              Continue to your dashboard and staging walkthrough.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handlePasswordSignIn}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@chapter.org"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleMagicLink}
                  disabled={isMagicLinkPending}
                >
                  {isMagicLinkPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Email me a magic link
                </Button>
              </div>
            </form>

            <div className="mt-6 text-sm text-muted-foreground">
              Need an account?{" "}
              <Link
                href={`/sign-up?redirectTo=${encodeURIComponent(redirectTo)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Create one
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-muted/30" />}>
      <SignInPageContent />
    </Suspense>
  );
}
