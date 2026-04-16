"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import {
  useBillingStatus,
  useCreateChapter,
  useCreateCheckout,
  useCurrentUser,
  useAccessibleChapters,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { useChapterStore } from "@/lib/stores/chapter-store";

type ChapterMembershipSummary = {
  member_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  chapter: {
    id: string;
    name: string;
    university: string;
    stripe_customer_id: string | null;
    subscription_status: "incomplete" | "active" | "past_due" | "canceled";
    subscription_id: string | null;
    accent_color: string | null;
    logo_path: string | null;
    donation_url: string | null;
    created_at: string;
    updated_at: string;
  };
};

const DASHBOARD_HOME_PATH = "/dashboard";

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Something went wrong. Please try again.";
}

function buildCheckoutRedirectUrls() {
  if (typeof window === "undefined") {
    return {
      successUrl: `${DASHBOARD_HOME_PATH}?checkout=success`,
      cancelUrl: `${DASHBOARD_HOME_PATH}?checkout=cancelled`,
    };
  }

  const baseUrl = window.location.origin;
  return {
    successUrl: `${baseUrl}${DASHBOARD_HOME_PATH}?checkout=success`,
    cancelUrl: `${baseUrl}${DASHBOARD_HOME_PATH}?checkout=cancelled`,
  };
}

export function ChapterBootstrap() {
  const router = useRouter();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((state) => state.activeChapterId);
  const setActiveChapterId = useChapterStore((state) => state.setActiveChapterId);
  const chaptersQuery = useAccessibleChapters();
  const currentUserQuery = useCurrentUser();
  const createChapterMutation = useCreateChapter();
  const createCheckoutMutation = useCreateCheckout();
  const billingStatusQuery = useBillingStatus();
  const [chapterName, setChapterName] = useState("");
  const [university, setUniversity] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);

  const memberships = useMemo(() => {
    const data = chaptersQuery.data;
    return Array.isArray(data) ? (data as ChapterMembershipSummary[]) : [];
  }, [chaptersQuery.data]);

  const currentUser = currentUserQuery.data as
    | { id: string; email?: string | null; display_name?: string | null }
    | undefined;

  useEffect(() => {
    if (!memberships.length) {
      if (activeChapterId !== null) {
        setActiveChapterId(null);
      }
      return;
    }

    if (activeChapterId && memberships.some((entry) => entry.chapter.id === activeChapterId)) {
      setSelectedChapterId(activeChapterId);
      return;
    }

    const firstMembership = memberships[0];

    if (memberships.length === 1 && firstMembership) {
      const onlyChapterId = firstMembership.chapter.id;
      setSelectedChapterId(onlyChapterId);
      setActiveChapterId(onlyChapterId);
      return;
    }

    if (firstMembership) {
      setSelectedChapterId((previous) => previous ?? firstMembership.chapter.id);
    }
  }, [activeChapterId, memberships, setActiveChapterId]);

  const selectedMembership = useMemo(
    () =>
      memberships.find((entry) => entry.chapter.id === (selectedChapterId ?? activeChapterId)) ??
      null,
    [activeChapterId, memberships, selectedChapterId],
  );

  const isLoading = chaptersQuery.isLoading || currentUserQuery.isLoading;

  async function handleCreateChapter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const chapter = await createChapterMutation.mutateAsync({
        name: chapterName.trim(),
        university: university.trim(),
      });

      const createdChapterId =
        chapter && typeof chapter === "object" && "id" in chapter
          ? (chapter as { id?: string }).id ?? null
          : null;

      if (createdChapterId) {
        setActiveChapterId(createdChapterId);
        setSelectedChapterId(createdChapterId);
      }

      toast({
        title: "Chapter created",
        description: "Your chapter is ready for activation.",
      });
      await chaptersQuery.refetch();
      router.refresh();
    } catch (error) {
      toast({
        title: "Unable to create chapter",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  async function handleActivateChapter() {
    if (!activeChapterId || !currentUser?.email) {
      toast({
        title: "Missing chapter context",
        description: "Select an active chapter before starting checkout.",
        variant: "destructive",
      });
      return;
    }

    try {
      const redirectUrls = buildCheckoutRedirectUrls();
      const result = await createCheckoutMutation.mutateAsync({
        customer_email: currentUser.email,
        success_url: redirectUrls.successUrl,
        cancel_url: redirectUrls.cancelUrl,
      });

      const checkoutUrl =
        result && typeof result === "object" && "url" in result
          ? (result as { url?: string }).url ?? null
          : null;

      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }

      throw new Error("Checkout session did not return a URL.");
    } catch (error) {
      toast({
        title: "Unable to start checkout",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }

  function handleSelectChapter(chapterId: string) {
    setSelectedChapterId(chapterId);
    setActiveChapterId(chapterId);
    void billingStatusQuery.refetch();
    router.refresh();
  }

  if (isLoading) {
    return <LoadingState message="Loading your chapters..." />;
  }

  if (chaptersQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable to load your chapters</CardTitle>
          <CardDescription>
            Sign in succeeded, but chapter bootstrap needs a healthy API response.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Retry the request after confirming the API is deployed and your session is valid.
          </p>
          <Button onClick={() => chaptersQuery.refetch()}>Retry chapter bootstrap</Button>
        </CardContent>
      </Card>
    );
  }

  if (memberships.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Create your chapter
          </CardTitle>
          <CardDescription>
            Start with a chapter record, then activate billing to unlock invite workflows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreateChapter}>
            <div className="space-y-2">
              <Label htmlFor="chapter-name">Chapter name</Label>
              <Input
                id="chapter-name"
                value={chapterName}
                onChange={(event) => setChapterName(event.target.value)}
                placeholder="Alpha Beta Chapter"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chapter-university">University</Label>
              <Input
                id="chapter-university"
                value={university}
                onChange={(event) => setUniversity(event.target.value)}
                placeholder="State University"
                required
              />
            </div>
            <Button type="submit" disabled={createChapterMutation.isPending}>
              {createChapterMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Create chapter
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const effectiveStatus =
    (billingStatusQuery.data as { subscription_status?: string } | undefined)?.subscription_status ??
    selectedMembership?.chapter.subscription_status ??
    "incomplete";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Choose your active chapter</CardTitle>
          <CardDescription>
            The active chapter controls multi-tenant API access and dashboard data.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {memberships.map((entry) => {
            const isActive = entry.chapter.id === (activeChapterId ?? selectedChapterId);
            return (
              <button
                key={entry.chapter.id}
                type="button"
                onClick={() => handleSelectChapter(entry.chapter.id)}
                className={`rounded-lg border p-4 text-left transition ${
                  isActive
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{entry.chapter.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {entry.chapter.university}
                    </p>
                  </div>
                  {isActive ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Subscription status: {entry.chapter.subscription_status}
                </p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Chapter activation
          </CardTitle>
          <CardDescription>
            Invites remain locked until the active chapter has an active subscription.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">
              Active chapter: {selectedMembership?.chapter.name ?? "Unknown chapter"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Current subscription status: {effectiveStatus}
            </p>
          </div>

          {effectiveStatus === "active" ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-100">
              This chapter is active. You can continue to the live dashboard workflows.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Start a Stripe test checkout to activate this chapter for invite-enabled workflows.
              </p>
              <Button
                onClick={handleActivateChapter}
                disabled={
                  !activeChapterId ||
                  createCheckoutMutation.isPending ||
                  billingStatusQuery.isFetching
                }
              >
                {createCheckoutMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Activate with test checkout
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void chaptersQuery.refetch();
                void billingStatusQuery.refetch();
              }}
            >
              Refresh status
            </Button>
            <Button
              onClick={() => {
                router.replace(DASHBOARD_HOME_PATH);
                router.refresh();
              }}
              disabled={!activeChapterId}
            >
              Continue to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
