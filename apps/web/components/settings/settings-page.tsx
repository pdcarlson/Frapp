"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import {
  type OrgDues,
  useCreatePortal,
  useCurrentChapter,
  useMyPermissions,
  useOrgConfig,
  usePatchOrgConfig,
  usePendingConfigKeys,
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
import { parseHex, pickAccessibleColor } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";
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
  OfflineState,
} from "@/components/shared/async-states";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import { BillingGlyph } from "@/components/layout/nav-glyphs";
import { Can } from "@/components/shared/can";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { can } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, getErrorMessage } from "@/lib/utils";
import { SettingsOrgTab } from "@/components/settings/settings-org-tab";
import { SettingsModulesTab } from "@/components/settings/settings-modules-tab";
import { SettingsWorkflowsTab } from "@/components/settings/settings-workflows-tab";
import { SettingsDuesTab } from "@/components/settings/settings-dues-tab";
import { SettingsRolesTab } from "@/components/settings/settings-roles-tab";
import { SettingsPrivacyTab } from "@/components/settings/settings-privacy-tab";
import { SettingsFieldsTab } from "@/components/settings/settings-fields-tab";
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

// The vertical rail is the one place the §6 underline runs down the side
// rather than along the bottom: on `lg` the list becomes a column with a right
// hairline, so each item moves its 2px accent indicator to its right edge to
// match. Below `lg` it is an ordinary horizontal underline row.
const RAIL_TRIGGER_CLASS =
  "flex-1 justify-start lg:w-full lg:flex-none lg:-mr-px lg:mb-0 lg:border-b-0 lg:border-r-2 lg:px-3";

// Valid `?tab=` deep-link targets — mirrors the rail triggers below.
const SETTINGS_TAB_VALUES: readonly string[] = [
  "org",
  "modules",
  "roles",
  "fields",
  "workflows",
  "dues",
  "theme",
  "privacy",
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

function SettingsPageContent() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { isOffline } = useNetwork();
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
  // Which settings are saving, not merely whether something is. One shared
  // `isPending` used to disable every control on every tab at once (#881).
  const pendingConfigKeys = usePendingConfigKeys();
  const rollover = useSemesterRollover();
  const createPortal = useCreatePortal();
  // Scoped to the rollover card on purpose. `SemesterRolloverController` is the
  // only paid-ops write on this screen (#841); `chapter-config`, `chapter`, and
  // `user` are `@FreeTier` and `notification` is not chapter-guarded at all, so
  // gating the rest would lock a lapsed chapter out of settings it is still
  // entitled to change — over-gating is the worse defect here.
  const rolloverGate = useSubscriptionGate();

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follow `?tab=` deep links without wiping a tab the member already picked
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the accent draft from the chapter query
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

  /*
    §4's flags, and the two things `/settings` was missing.

    `isPending` alone gated the spinner, but `useCurrentChapter` is
    `enabled: !!chapterId` and a paused query shares that flag — the
    no-chapter case is already handled by the card above, so what was left was
    a query paused offline spinning forever. And the route had **no offline
    state at all**, which is README §4 item 4 unmet on the only settings route
    the responsive-floor gate visits.

    The branches produce a value rather than returning, because
    `{confirmDialog}` has to outlive them: a background refetch failure landing
    while the rollover confirmation is open would otherwise unmount the dialog
    and settle its promise `null`, so the member's click on "Start new
    semester" would vanish with no toast and no error. `window.confirm` could
    not fail that way — it blocks the thread — so this is a cost the
    conversion introduces and has to pay for. Found by the pre-push review.
  */
  const chapterPaused =
    chapterQuery.isPending && chapterQuery.fetchStatus === "paused";
  let stateBanner: React.ReactNode = null;
  if (isOffline && chapterQuery.data === undefined) {
    stateBanner = (
      <OfflineState
        title="Chapter settings unavailable offline"
        description="Reconnect to load this chapter's identity, modules, and branding."
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  } else if (chapterQuery.isLoading || chapterPaused) {
    stateBanner = <LoadingState message="Loading chapter settings..." />;
  } else if (chapterQuery.isError) {
    stateBanner = (
      <ErrorState
        title="Couldn't load chapter settings"
        description="Confirm your chapter access and retry. Changes here update every surface in the dashboard."
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  }

  if (stateBanner) {
    return (
      <div className="space-y-6">
        {confirmDialog}
        {stateBanner}
      </div>
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

  // #1157: the preview swatch sits on a Signet card, so the WCAG check must
  // run against that dark surface (with a dark-legible fallback), not the
  // resolver's white default.
  const accent = resolveChapterAccentColor(accentDraft || undefined, {
    background: signetDarkTokens.color.surface.card,
    fallbackAccent: signetDarkTokens.color.gold.house,
  });

  /*
    The on-accent tone for the *draft* colour. See the swatch below for why the
    `--primary-foreground` token cannot answer this, and why it has to be
    recomputed here rather than read.
  */
  const accentRgb = parseHex(accent.resolvedAccent);
  const previewInk =
    (accentRgb
      ? pickAccessibleColor(
          [
            signetDarkTokens.color.gold.onHouse,
            signetDarkTokens.color.text.foreground,
          ],
          accentRgb,
        )
      : null) ?? signetDarkTokens.color.gold.onHouse;
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
    const confirmed = await confirm({
      title: `Start a new semester labelled "${semesterLabel}"?`,
      description:
        "The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves.",
      confirmLabel: "Start new semester",
      // Not destructive: a rollover archives rather than deletes, and
      // `writing.md` §7's own copy for this flow says the history stays. A red
      // button would state a loss the API does not perform.
      tone: "default",
    });
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
      {/*
        Above the tabs, so switching tab never unmounts an open confirmation
        mid-flight — `ConfirmDialogHost` would settle it `null` and the
        rollover would silently not run. Same reason the Chapter Ops slice
        keeps `{confirmDialog}` out from under its screens' early returns.
      */}
      {confirmDialog}
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
        <TabsList className="flex h-auto w-full flex-row flex-wrap justify-start gap-1 lg:w-56 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-b-0 lg:border-r">
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
          <TabsTrigger value="privacy" className={RAIL_TRIGGER_CLASS}>
            Privacy
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
                savingConfig={
                  pendingConfigKeys.has("branding") ||
                  pendingConfigKeys.has("vocabulary") ||
                  pendingConfigKeys.has("org_archetype")
                }
              />,
            )}

            <Can
              permission="semester:rollover"
              deniedFallback={null}
              offlineFallback={(retry) => (
                <PermissionsOfflineSurface
                  description="Reconnect to check whether you can start a new semester."
                  onRetry={retry}
                />
              )}
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
                    {/*
                      Disable, don't hide (§5 rule 4) — and the notice sits on
                      the rollover card rather than the page header so it never
                      reads as "all of settings is blocked". `mb-0` because the
                      grid gap already spaces it.
                    */}
                    <SubscriptionNotice
                      gate={rolloverGate}
                      feature="semester rollover"
                      className="mb-0 md:col-span-3"
                    />
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
                    {/*
                      No dialog to gate here, so the submit *is* the entry
                      control — and a disabled default button also suppresses
                      implicit Enter submission from the three fields above.
                    */}
                    <Button
                      type="submit"
                      {...rolloverGate.controlProps(rollover.isPending)}
                    >
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
                    variant="secondary"
                    onClick={() => void openBillingPortal()}
                    disabled={createPortal.isPending}
                  >
                    {createPortal.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      // Names the destination, not the verb — §6.2 keeps
                      // Lucide for control furniture, and the billing intent
                      // is already a Signet duotone in `nav-glyphs.tsx`.
                      // `AlertTriangle` above stays Lucide: it is the danger
                      // marker `async-states.tsx` draws for the same tone, not
                      // a domain intent.
                      <BillingGlyph className="h-4 w-4" />
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
                pendingModuleKeys={pendingConfigKeys}
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

          <TabsContent value="fields" className="mt-0">
            {renderConfigGated(<SettingsFieldsTab canManage={canManage} />)}
          </TabsContent>

          <TabsContent value="workflows" className="mt-0">
            {renderConfigGated(
              <SettingsWorkflowsTab
                workflows={workflows}
                canManage={canManage}
                isSaving={pendingConfigKeys.has("workflows")}
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
                isSaving={pendingConfigKeys.has("dues")}
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
                      placeholder={signetDarkTokens.color.gold.seed}
                      className="max-w-xs font-mono"
                    />
                    {/*
                      The one place a raw chapter hex legitimately paints — it
                      is a preview *of* that hex, which is the carve-out
                      README §2's ban is written around. The text on top is the
                      part that has been wrong twice.

                      It shipped as `text-white`: a guess, and wrong for every
                      light seed the directory holds (`#FFFFFF`, `#C0C0C0`,
                      `#C9A56F`), where white on the fill is 1.0–2.2:1 and the
                      word disappears. The obvious fix — `text-primary-foreground`
                      — is wrong in a subtler way, and the pre-push review
                      caught it: that token is `--signet-accent-on-primary`,
                      written once from the chapter's **saved** palette. This
                      swatch previews the **draft**, recomputed on every
                      keystroke, so an admin on a dark saved accent typing a
                      light draft would watch the fill go pale while the text
                      stayed white. `resolveChapterAccentColor` cannot help:
                      it returns the accent's legibility *as text on a
                      background*, and no on-accent tone at all.

                      So it is computed here, from the draft, against §4's own
                      two ends of the text ladder. `null` means neither clears
                      AA — a mid-tone accent the engine would itself reject —
                      and the fallback names §6's own preference for the darker
                      of two failures rather than picking by luck.
                    */}
                    <div
                      className="flex h-12 w-36 items-center justify-center rounded-md text-sm font-semibold"
                      style={{
                        backgroundColor: accent.resolvedAccent,
                        color: previewInk,
                      }}
                    >
                      Preview
                    </div>
                  </div>
                  {accent.fallbackApplied ? (
                    <p className="text-xs text-warning">
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

          <TabsContent value="privacy" className="mt-0">
            {renderConfigGated(
              <SettingsPrivacyTab
                analyticsOptOut={config?.analytics_opt_out === true}
                canManage={canManage}
                isSaving={pendingConfigKeys.has("analytics_opt_out")}
                onToggle={(optOut) =>
                  patchConfig(
                    { analytics_opt_out: optOut },
                    optOut ? "Analytics disabled" : "Analytics enabled",
                  )
                }
              />,
            )}
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

// `SettingsPageContent` reads `?tab=` via `useSearchParams`, which Next requires
// to sit under a Suspense boundary (matches the sign-in/sign-up/join pattern).
export function SettingsPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading chapter settings..." />}>
      <SettingsPageContent />
    </Suspense>
  );
}
