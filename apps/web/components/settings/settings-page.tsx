"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CreditCard, Trash2 } from "lucide-react";
import {
  useCreatePortal,
  useCurrentChapter,
  useSemesterRollover,
  useSemesters,
  useUpdateChapter,
} from "@repo/hooks";
import {
  CurrentChapterPayloadSchema,
  type CurrentChapterPayload,
} from "@repo/validation";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, getErrorMessage } from "@/lib/utils";

type SemesterArchive = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

export function SettingsPage() {
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const semestersQuery = useSemesters();
  const updateChapter = useUpdateChapter();
  const rollover = useSemesterRollover();
  const createPortal = useCreatePortal();

  const [generalDraft, setGeneralDraft] = useState<{
    name: string;
    university: string;
    donation_url: string;
    accent_color: string;
  }>({
    name: "",
    university: "",
    donation_url: "",
    accent_color: "",
  });

  const [semesterLabel, setSemesterLabel] = useState("");
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");

  useEffect(() => {
    const data = chapterQuery.data;
    if (!data) return;
    const parsed = CurrentChapterPayloadSchema.safeParse(data);
    if (!parsed.success) return;
    const payload = parsed.data as CurrentChapterPayload & {
      donation_url?: string | null;
    };
    setGeneralDraft({
      name: payload.name,
      university: payload.university,
      donation_url: payload.donation_url ?? "",
      accent_color: payload.accent_color ?? "",
    });
  }, [chapterQuery.data]);

  if (!activeChapterId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chapter settings</CardTitle>
          <CardDescription>
            Select an active chapter to edit its branding, semester state, or
            billing configuration.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (chapterQuery.isPending) {
    return <LoadingState message="Loading chapter settings..." />;
  }

  if (chapterQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load chapter settings"
        description="Confirm your chapter access and retry. Changes you make here update every surface in the dashboard."
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  }

  const accent = resolveChapterAccentColor(generalDraft.accent_color || undefined);
  const semesters = asArray<SemesterArchive>(semestersQuery.data);

  async function saveGeneral(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateChapter.mutateAsync({
        name: generalDraft.name || undefined,
        university: generalDraft.university || undefined,
        donation_url: generalDraft.donation_url || undefined,
        accent_color: generalDraft.accent_color || undefined,
      });
      toast({
        title: "Chapter settings saved",
        description: "Everyone in the chapter sees the changes on their next refresh.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save chapter settings",
        description: getErrorMessage(
          error,
          "The API rejected the update. Retry or check the accent color contrast.",
        ),
        variant: "destructive",
      });
    }
  }

  async function startRollover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!semesterLabel || !semesterStart || !semesterEnd) return;
    const confirmed = window.confirm(
      `Start a new semester labelled "${semesterLabel}"? The current leaderboard period will be archived and a new one will begin.`,
    );
    if (!confirmed) return;
    try {
      await rollover.mutateAsync({
        label: semesterLabel,
        start_date: semesterStart,
        end_date: semesterEnd,
      });
      toast({
        title: "Semester archived",
        description: `${semesterLabel} is now the active period.`,
      });
      setSemesterLabel("");
      setSemesterStart("");
      setSemesterEnd("");
    } catch (error) {
      toast({
        title: "Couldn't archive semester",
        description: getErrorMessage(
          error,
          "Rollovers are limited to one per month. Check the archive list below.",
        ),
        variant: "destructive",
      });
    }
  }

  async function openBillingPortal() {
    try {
      const result = await createPortal.mutateAsync({
        return_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/settings`
            : "/settings",
      });
      const url =
        result && typeof result === "object" && "url" in result
          ? (result as { url?: string }).url
          : null;
      if (!url) throw new Error("Billing portal did not return a URL.");
      window.location.assign(url);
    } catch (error) {
      toast({
        title: "Couldn't open billing portal",
        description: getErrorMessage(
          error,
          "Confirm billing:manage permission and an active Stripe customer.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Chapter settings</h2>
        <p className="text-sm text-muted-foreground">
          Update chapter branding, run a semester rollover, or launch the
          Stripe billing portal.
        </p>
      </header>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="semester">Semester</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Chapter profile</CardTitle>
              <CardDescription>
                Changes here update the navigation sidebar, reports, and
                member-facing screens.
              </CardDescription>
            </CardHeader>
            <form onSubmit={saveGeneral}>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="chapter-name">Chapter name</Label>
                    <Input
                      id="chapter-name"
                      value={generalDraft.name}
                      onChange={(event) =>
                        setGeneralDraft((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="chapter-university">University</Label>
                    <Input
                      id="chapter-university"
                      value={generalDraft.university}
                      onChange={(event) =>
                        setGeneralDraft((prev) => ({
                          ...prev,
                          university: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="chapter-donation">Donation link (optional)</Label>
                  <Input
                    id="chapter-donation"
                    type="url"
                    value={generalDraft.donation_url}
                    onChange={(event) =>
                      setGeneralDraft((prev) => ({
                        ...prev,
                        donation_url: event.target.value,
                      }))
                    }
                    placeholder="https://give.youruniversity.edu/..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Alumni see this link from the mobile &ldquo;Support the chapter&rdquo;
                    button.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end">
                <Can permission="roles:manage">
                  <Button type="submit" disabled={updateChapter.isPending}>
                    {updateChapter.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save chapter profile
                  </Button>
                </Can>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Accent color</CardTitle>
              <CardDescription>
                Shown on primary buttons, chat name tags, and branded PDF
                reports. Must meet WCAG AA contrast against white; invalid
                colors fall back to the Frapp default.
              </CardDescription>
            </CardHeader>
            <form onSubmit={saveGeneral}>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    type="color"
                    aria-label="Accent color picker"
                    value={generalDraft.accent_color || accent.resolvedAccent}
                    onChange={(event) =>
                      setGeneralDraft((prev) => ({
                        ...prev,
                        accent_color: event.target.value,
                      }))
                    }
                    className="h-12 w-24 p-1"
                  />
                  <Input
                    aria-label="Accent color hex value"
                    value={generalDraft.accent_color}
                    onChange={(event) =>
                      setGeneralDraft((prev) => ({
                        ...prev,
                        accent_color: event.target.value,
                      }))
                    }
                    placeholder="#2563EB"
                    className="max-w-xs font-mono"
                  />
                  <div
                    className="flex h-12 w-36 items-center justify-center rounded-md text-sm font-semibold text-white shadow-sm"
                    style={{ backgroundColor: accent.resolvedAccent }}
                  >
                    Preview
                  </div>
                </div>
                {accent.fallbackApplied ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    The color you entered didn&apos;t meet contrast requirements.
                    Using the safe fallback {accent.resolvedAccent}.
                  </p>
                ) : null}
              </CardContent>
              <CardFooter className="flex justify-end">
                <Can permission="roles:manage">
                  <Button type="submit" disabled={updateChapter.isPending}>
                    {updateChapter.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save branding
                  </Button>
                </Can>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="semester" className="mt-6 space-y-6">
          <Can
            permission="semester:rollover"
            deniedFallback={
              <Card>
                <CardHeader>
                  <CardTitle>Semester rollover</CardTitle>
                  <CardDescription>
                    Starting a new semester requires the{" "}
                    <code>semester:rollover</code> permission. Your president
                    can grant it from the Roles page.
                  </CardDescription>
                </CardHeader>
              </Card>
            }
          >
            <Card>
              <CardHeader>
                <CardTitle>Start a new semester</CardTitle>
                <CardDescription>
                  Archives the current leaderboard period with a label and
                  date range. Points keep accumulating — the leaderboard just
                  resets its default window.
                </CardDescription>
              </CardHeader>
              <form onSubmit={startRollover}>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-1 md:col-span-1">
                    <Label htmlFor="semester-label">Label</Label>
                    <Input
                      id="semester-label"
                      value={semesterLabel}
                      onChange={(event) =>
                        setSemesterLabel(event.target.value)
                      }
                      placeholder="Fall 2026"
                      required
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="semester-start">Start date</Label>
                    <Input
                      id="semester-start"
                      type="date"
                      value={semesterStart}
                      onChange={(event) =>
                        setSemesterStart(event.target.value)
                      }
                      required
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="semester-end">End date</Label>
                    <Input
                      id="semester-end"
                      type="date"
                      value={semesterEnd}
                      onChange={(event) => setSemesterEnd(event.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end">
                  <Button type="submit" disabled={rollover.isPending}>
                    {rollover.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Archive current semester
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </Can>

          <Card>
            <CardHeader>
              <CardTitle>Archived semesters</CardTitle>
              <CardDescription>
                Every rollover is preserved and viewable in reports and
                leaderboards.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {semestersQuery.isPending ? (
                <LoadingState message="Loading archives..." />
              ) : semesters.length === 0 ? (
                <EmptyState
                  title="No archived semesters yet"
                  description="After you run your first rollover, the history appears here."
                />
              ) : (
                <ul className="divide-y divide-border/70">
                  {semesters.map((archive) => (
                    <li
                      key={archive.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="font-medium">{archive.label}</span>
                      <span className="text-muted-foreground">
                        {archive.start_date} – {archive.end_date}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="mt-6 space-y-6">
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Billing portal
              </CardTitle>
              <CardDescription>
                Opens the Stripe-hosted portal where you can update payment
                methods, download invoices, or cancel the subscription.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Can
                permission="billing:manage"
                deniedFallback={
                  <p className="text-sm text-muted-foreground">
                    Only users with <code>billing:manage</code> can open the
                    Stripe portal.
                  </p>
                }
              >
                <Button
                  variant="outline"
                  onClick={() => void openBillingPortal()}
                  disabled={createPortal.isPending}
                >
                  {createPortal.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Open Stripe billing portal
                </Button>
              </Can>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Deactivate chapter (coming soon)
              </CardTitle>
              <CardDescription>
                Chapter deactivation is intentionally a supported-by-Frapp
                action. Contact support from within the billing portal to
                cancel or deactivate &mdash; we preserve data indefinitely in
                read-only mode (see privacy policy).
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
