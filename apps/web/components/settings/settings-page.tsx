"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CreditCard, Loader2, Trash2 } from "lucide-react";
import {
  useCreatePortal,
  useCurrentChapter,
  useMyPermissions,
  usePermissionsCatalog,
  useSemesterRollover,
  useSemesters,
  useUpdateChapter,
} from "@repo/hooks";
import {
  CurrentChapterPayloadSchema,
  type CurrentChapterPayload,
  type PatchChapterConfig,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { can } from "@/lib/auth/can";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  useOrgConfig,
  usePatchOrgConfig,
  type OrgDues,
} from "@/lib/hooks/use-org-config";
import { SettingsOrgTab } from "@/components/settings/settings-org-tab";
import { SettingsModulesTab } from "@/components/settings/settings-modules-tab";
import { SettingsWorkflowsTab } from "@/components/settings/settings-workflows-tab";
import { SettingsDuesTab } from "@/components/settings/settings-dues-tab";
import { SettingsRolesTab } from "@/components/settings/settings-roles-tab";
import { SettingsComingSoon } from "@/components/settings/settings-coming-soon";

type SemesterArchive = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

type Branding = {
  greek_letters?: string;
  designation?: string;
  school_short?: string;
  founded_at?: number;
};

const RAIL_TRIGGER_CLASS = "flex-1 justify-start lg:w-full lg:flex-none";

// Valid `?tab=` deep-link targets — mirrors the rail triggers below.
const SETTINGS_TAB_VALUES: readonly string[] = [
  "org",
  "modules",
  "roles",
  "fields",
  "workflows",
  "dues",
  "theme",
  "beta",
  "audit",
];

// Fallback shown before the config query resolves. Mirrors the API's
// chapter_dues_config defaults for an unconfigured chapter.
const DEFAULT_DUES: OrgDues = {
  cadence: "per_semester",
  active_amount_cents: 0,
  new_member_amount_cents: 0,
  alumni_amount_cents: 0,
  installments_allowed: false,
  installment_count: 1,
  late_fee_cents: 0,
  grace_days: 7,
  scholarship_pool_cents: 0,
};

// Tabs whose internals land in later chunks. The rail entry stays visible so
// the full settings IA is legible (brief: "the remaining tabs are stubs").
const COMING_SOON_TABS: ReadonlyArray<{
  value: string;
  label: string;
  title: string;
  description: string;
  chunk: string;
}> = [
  {
    value: "fields",
    label: "Fields",
    title: "Custom member fields",
    description: "Define extra member fields and their visibility.",
    chunk: "Chunk 07",
  },
  {
    value: "beta",
    label: "Beta",
    title: "Beta program",
    description: "Build channel and feedback configuration.",
    chunk: "Chunk 08",
  },
  {
    value: "audit",
    label: "Audit",
    title: "Audit log",
    description: "A member-visible record of who changed what.",
    chunk: "Chunk 08",
  },
];

export function SettingsPage() {
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const orgConfigQuery = useOrgConfig();
  const { data: permissionsPayload } = useMyPermissions({
    enabled: !!activeChapterId,
  });
  const catalogQuery = usePermissionsCatalog();
  const semestersQuery = useSemesters();
  const updateChapter = useUpdateChapter();
  const patchOrgConfig = usePatchOrgConfig();
  const rollover = useSemesterRollover();
  const createPortal = useCreatePortal();

  const canManage = can("chapter-config:manage", permissionsPayload?.permissions);

  // Deep-link the active tab via `?tab=` so links (e.g. the redirect from the
  // former standalone `/roles` page) can land directly on a tab.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    tabParam && SETTINGS_TAB_VALUES.includes(tabParam) ? tabParam : "org",
  );
  useEffect(() => {
    if (tabParam && SETTINGS_TAB_VALUES.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const [accentDraft, setAccentDraft] = useState("");
  const [semesterLabel, setSemesterLabel] = useState("");
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");

  useEffect(() => {
    const parsed = CurrentChapterPayloadSchema.safeParse(chapterQuery.data);
    if (!parsed.success) return;
    setAccentDraft(parsed.data.accent_color ?? "");
  }, [chapterQuery.data]);

  if (!activeChapterId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chapter settings</CardTitle>
          <CardDescription>
            Select an active chapter to edit its organization, modules, and
            branding.
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
        description="Confirm your chapter access and retry. Changes here update every surface in the dashboard."
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  }

  const parsedChapter = CurrentChapterPayloadSchema.safeParse(chapterQuery.data);
  const chapterPayload = parsedChapter.success
    ? (parsedChapter.data as CurrentChapterPayload & {
        donation_url?: string | null;
      })
    : null;
  const profile = {
    name: chapterPayload?.name ?? "",
    university: chapterPayload?.university ?? "",
    donation_url: chapterPayload?.donation_url ?? "",
  };

  const config = orgConfigQuery.data;
  const archetypeKey = config?.org_archetype ?? "ifc";
  const vocabulary = config?.vocabulary ?? {};
  const brandingRaw = config?.branding ?? {};
  const branding: Branding = {
    greek_letters:
      typeof brandingRaw.greek_letters === "string"
        ? brandingRaw.greek_letters
        : undefined,
    designation:
      typeof brandingRaw.designation === "string"
        ? brandingRaw.designation
        : undefined,
    school_short:
      typeof brandingRaw.school_short === "string"
        ? brandingRaw.school_short
        : undefined,
    founded_at:
      typeof brandingRaw.founded_at === "number"
        ? brandingRaw.founded_at
        : undefined,
  };
  const enabledModules = config?.enabled_modules ?? {};
  const workflows = config?.workflows ?? [];
  const dues = config?.dues ?? DEFAULT_DUES;

  const accent = resolveChapterAccentColor(accentDraft || undefined);
  const semesters = asArray<SemesterArchive>(semestersQuery.data);
  const permissionsCatalog = asArray<{ key: string; permission: string }>(
    catalogQuery.data,
  );

  async function saveProfile(next: {
    name: string;
    university: string;
    donation_url: string;
  }) {
    try {
      await updateChapter.mutateAsync({
        name: next.name || undefined,
        university: next.university || undefined,
        donation_url: next.donation_url || undefined,
      });
      toast({
        title: "Chapter profile saved",
        description: "Everyone sees the changes on their next refresh.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save chapter profile",
        description: getErrorMessage(error, "Retry or check your connection."),
        variant: "destructive",
      });
    }
  }

  async function patchConfig(diff: PatchChapterConfig, successTitle: string) {
    try {
      await patchOrgConfig.mutateAsync(diff);
      toast({
        title: successTitle,
        description: "An entry was written to the chapter audit log.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save settings",
        description: getErrorMessage(
          error,
          "The API rejected the update. Retry in a moment.",
        ),
        variant: "destructive",
      });
    }
  }

  async function saveAccent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateChapter.mutateAsync({
        accent_color: accentDraft || undefined,
      });
      toast({
        title: "Accent color saved",
        description: "Buttons, chat tags, and branded reports use it.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save accent color",
        description: getErrorMessage(
          error,
          "Retry or check the accent color contrast.",
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

  function renderConfigGated(node: React.ReactNode) {
    if (orgConfigQuery.isPending) {
      return <LoadingState message="Loading chapter configuration..." />;
    }
    if (orgConfigQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load chapter configuration"
          description="The archetype, modules, and vocabulary couldn't be fetched. Retry to try again."
          onRetry={() => void orgConfigQuery.refetch()}
        />
      );
    }
    return node;
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          Chapter settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure your organization identity, modules, branding, and chapter
          administration.
        </p>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6 lg:flex-row lg:items-start"
      >
        <TabsList className="flex h-auto w-full flex-row flex-wrap justify-start gap-1 bg-muted/50 p-1 lg:w-56 lg:flex-col lg:flex-nowrap">
          <TabsTrigger value="org" className={RAIL_TRIGGER_CLASS}>
            Organization
          </TabsTrigger>
          <TabsTrigger value="modules" className={RAIL_TRIGGER_CLASS}>
            Modules
          </TabsTrigger>
          <TabsTrigger value="roles" className={RAIL_TRIGGER_CLASS}>
            Roles
          </TabsTrigger>
          <TabsTrigger value="fields" className={RAIL_TRIGGER_CLASS}>
            Fields
          </TabsTrigger>
          <TabsTrigger value="workflows" className={RAIL_TRIGGER_CLASS}>
            Workflows
          </TabsTrigger>
          <TabsTrigger value="dues" className={RAIL_TRIGGER_CLASS}>
            Dues
          </TabsTrigger>
          <TabsTrigger value="theme" className={RAIL_TRIGGER_CLASS}>
            Theme
          </TabsTrigger>
          <TabsTrigger value="beta" className={RAIL_TRIGGER_CLASS}>
            Beta
          </TabsTrigger>
          <TabsTrigger value="audit" className={RAIL_TRIGGER_CLASS}>
            Audit
          </TabsTrigger>
        </TabsList>

        <div className="min-w-0 flex-1">
          <TabsContent value="org" className="mt-0 space-y-6">
            {renderConfigGated(
              <SettingsOrgTab
                archetypeKey={archetypeKey}
                vocabulary={vocabulary}
                branding={branding}
                profile={profile}
                canManage={canManage}
                onSaveProfile={saveProfile}
                onPatchConfig={(diff) =>
                  patchConfig(diff, "Organization settings saved")
                }
                savingProfile={updateChapter.isPending}
                savingConfig={patchOrgConfig.isPending}
              />,
            )}

            <Can
              permission="semester:rollover"
              deniedFallback={null}
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
                        onChange={(event) => setSemesterLabel(event.target.value)}
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
                        onChange={(event) => setSemesterStart(event.target.value)}
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

            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Billing &amp; danger zone
                </CardTitle>
                <CardDescription>
                  Manage payment methods, download invoices, or cancel the
                  subscription from the Stripe-hosted portal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
                  Chapter deactivation is a supported-by-Frapp action. Contact
                  support from the billing portal — data is preserved
                  indefinitely in read-only mode (see privacy policy).
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="modules" className="mt-0">
            {renderConfigGated(
              <SettingsModulesTab
                enabledModules={enabledModules}
                canManage={canManage}
                isSaving={patchOrgConfig.isPending}
                onToggle={(key, enabled) =>
                  patchConfig(
                    { enabled_modules: { [key]: enabled } },
                    enabled ? "Module enabled" : "Module disabled",
                  )
                }
              />,
            )}
          </TabsContent>

          <TabsContent value="roles" className="mt-0">
            {renderConfigGated(
              <SettingsRolesTab
                archetypeKey={archetypeKey}
                canManage={canManage}
                catalog={permissionsCatalog}
              />,
            )}
          </TabsContent>

          <TabsContent value="workflows" className="mt-0">
            {renderConfigGated(
              <SettingsWorkflowsTab
                workflows={workflows}
                canManage={canManage}
                isSaving={patchOrgConfig.isPending}
                onSave={(next) =>
                  patchConfig({ workflows: next }, "Workflows saved")
                }
              />,
            )}
          </TabsContent>

          <TabsContent value="dues" className="mt-0">
            {renderConfigGated(
              <SettingsDuesTab
                dues={dues}
                canManage={canManage}
                isSaving={patchOrgConfig.isPending}
                onSave={(next) => patchConfig({ dues: next }, "Dues saved")}
              />,
            )}
          </TabsContent>

          <TabsContent value="theme" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Accent color</CardTitle>
                <CardDescription>
                  Shown on primary buttons, chat name tags, and branded PDF
                  reports. Must meet WCAG AA contrast against white; invalid
                  colors fall back to the Frapp default. Full theme
                  customization (chapter palette) arrives in Chunk 07.
                </CardDescription>
              </CardHeader>
              <form onSubmit={saveAccent}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <Input
                      type="color"
                      aria-label="Accent color picker"
                      value={accentDraft || accent.resolvedAccent}
                      onChange={(event) => setAccentDraft(event.target.value)}
                      className="h-12 w-24 p-1"
                    />
                    <Input
                      aria-label="Accent color hex value"
                      value={accentDraft}
                      onChange={(event) => setAccentDraft(event.target.value)}
                      placeholder="#7A5A2F"
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
                      The color you entered didn&apos;t meet contrast
                      requirements. Using the safe fallback{" "}
                      {accent.resolvedAccent}.
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="flex justify-end">
                  <Button type="submit" disabled={!canManage || updateChapter.isPending}>
                    {updateChapter.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save accent color
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          {COMING_SOON_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-0">
              <SettingsComingSoon
                title={tab.title}
                description={tab.description}
                chunk={tab.chunk}
              />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
