"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Ticket } from "lucide-react";
import { useRedeemInvite } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { getSessionUser } from "@/lib/auth/session";
import { useChapterStore } from "@/lib/stores/chapter-store";

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Something went wrong. Please try again.";
}

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const redeemInviteMutation = useRedeemInvite();
  const setActiveChapterId = useChapterStore((state) => state.setActiveChapterId);
  const initialToken = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [token, setToken] = useState(initialToken);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    setToken(initialToken);
  }, [initialToken]);

  useEffect(() => {
    let isMounted = true;

    async function ensureSession() {
      const user = await getSessionUser();
      if (!isMounted) {
        return;
      }

      if (!user) {
        const signInUrl = new URL("/sign-in", window.location.origin);
        signInUrl.searchParams.set("redirectTo", `/join${window.location.search}`);
        router.replace(signInUrl.pathname + signInUrl.search);
        return;
      }

      setSessionChecked(true);
    }

    void ensureSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleRedeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await redeemInviteMutation.mutateAsync({
        token: token.trim(),
      });
      const chapterId =
        result && typeof result === "object" && "chapterId" in result
          ? (result as { chapterId?: string }).chapterId
          : null;

      if (chapterId) {
        setActiveChapterId(chapterId);
      }

      toast({
        title: "Chapter joined",
        description: "Your membership has been activated in staging.",
      });
      router.replace("/home");
      router.refresh();
    } catch (error) {
      toast({
        title: "Unable to redeem invite",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  if (!sessionChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-10">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying your session before redeeming the invite...
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-6">
        <div className="max-w-2xl space-y-4">
          <p className="text-sm uppercase tracking-[0.18em] text-primary">
            Chapter invite
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance">
            Redeem your invite and join the live staging chapter.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            Enter your invite token to create a real chapter membership and continue
            into the member workflow.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mx-auto mt-10 grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>How joining works</CardTitle>
            <CardDescription>
              Invite redemption writes directly to the chapter membership table.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>• Invites are valid for a limited time and can only be used once.</p>
            <p>• Your membership is scoped to the chapter linked by the token.</p>
            <p>• After redemption, the app activates the joined chapter locally.</p>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-100">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Live chapter membership flow
              </div>
              <p className="mt-2 text-sm">
                This route is intended for staging validation of real invite + member
                directory behavior.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              Redeem invite token
            </CardTitle>
            <CardDescription>
              Enter the token shared by your chapter admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleRedeem}>
              <div className="space-y-2">
                <Label htmlFor="invite-token">Invite token</Label>
                <Input
                  id="invite-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste your invite token"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={redeemInviteMutation.isPending}
              >
                {redeemInviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Join chapter
              </Button>
            </form>

            <div className="mt-6 text-sm text-muted-foreground">
              Need to sign in first?{" "}
              <Link
                href={`/sign-in?redirectTo=${encodeURIComponent(`/join?token=${encodeURIComponent(token)}`)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Return to sign in
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-muted/30" />}>
      <JoinPageContent />
    </Suspense>
  );
}
