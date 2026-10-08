"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  useRemoveChapterLogo,
  useUpdateChapter,
  useUploadChapterLogo,
  type ChapterLogoUpload,
  type SemesterArchive,
} from "@repo/hooks";
import { type PatchChapterConfig } from "@repo/validation";
import { titleCase, vocab } from "@/lib/vocabulary";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { PageHeader } from "@/components/layout/page-header";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useSubscriptionGate } from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import {
  can,
  canAll,
  CHAPTER_PROFILE_PERMISSIONS,
  isOpsNudgeModuleKey,
} from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  isSettingsTabVisible,
  visibleSettingsTools,
} from "@/components/settings/settings-access";
import {
  SETTINGS_TABS,
  SETTINGS_TAB_VALUES,
  SettingsRail,
  SettingsToolsOnly,
} from "@/components/settings/settings-rail";
import {
  SettingsAccentTab,
  useAccentDraft,
} from "@/components/settings/settings-accent-tab";
import {
  SettingsSemesterTab,
  useRolloverForm,
} from "@/components/settings/settings-semester-tab";
import { SettingsDangerTab } from "@/components/settings/settings-danger-tab";
import { SettingsOrgTab } from "@/components/settings/settings-org-tab";
import { SettingsModulesTab } from "@/components/settings/settings-modules-tab";
import { SettingsWorkflowsTab } from "@/components/settings/settings-workflows-tab";
import { SettingsDuesTab } from "@/components/settings/settings-dues-tab";
import { SettingsRolesTab } from "@/components/settings/settings-roles-tab";
import { SettingsPrivacyTab } from "@/components/settings/settings-privacy-tab";
import { SettingsFieldsTab } from "@/components/settings/settings-fields-tab";

type Branding = {
  greek_letters?: string;
  short_name?: string;
  show_greek_letters?: boolean;
  designation?: string;
  school_short?: string;
  founded_at?: number;
};

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
  const isModuleEnabled = useChapterModuleGate();
  const catalogQuery = usePermissionsCatalog();
  const semestersQuery = useSemesters();
  const updateChapter = useUpdateChapter();
  const uploadLogo = useUploadChapterLogo();
  const removeLogo = useRemoveChapterLogo();
  const patchOrgConfig = usePatchOrgConfig();
  // Which settings are saving, not merely whether something is. One shared
  // `isPending` used to disable every control on every tab at once (#881).
  const pendingConfigKeys = usePendingConfigKeys();
  const rollover = useSemesterRollover();
  const createPortal = useCreatePortal();
  // Scoped to the rollover card; `SettingsSemesterTab` says why.
  const rolloverGate = useSubscriptionGate();

  const canManage = can(
    "chapter-config:manage",
    permissionsPayload?.permissions,
  );
  // The profile and accent saves go through `PATCH /v1/chapters/current`, which
  // guards on this constant; reading the same one keeps the page from enabling
  // a save the server refuses, or disabling one it accepts (#2575).
  const canEditProfile = canAll(
    CHAPTER_PROFILE_PERMISSIONS,
    permissionsPayload?.permissions,
  );

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

  /**
   * `?module=` narrows a `?tab=modules` deep link to one row, so chat's
   * ops-setup nudge (#492) can land an officer on the module it named rather
   * than at the top of the full module list. Validated against the nudge
   * catalog rather than passed through: an unrecognised value should be an
   * unfocused Modules tab, not a `querySelector` for an id that does not exist.
   *
   * **Consumed once, not held for the visit.** `TabsContent` carries no
   * `forceMount`, so Radix unmounts the inactive tab's content — and the tab is
   * driven by local state without rewriting the URL, so `?module=` survives the
   * whole visit. Without this latch, an officer who follows the nudge, enables
   * the module, wanders to Theme and comes back to Modules gets focus yanked to
   * the same switch and the list scrolled back to it, every single time.
   */
  const moduleParam = searchParams.get("module");
  const requestedModuleKey = isOpsNudgeModuleKey(moduleParam)
    ? moduleParam
    : undefined;
  const [consumedModuleKey, setConsumedModuleKey] = useState<string | null>(
    null,
  );
  const focusModuleKey =
    requestedModuleKey && consumedModuleKey !== requestedModuleKey
      ? requestedModuleKey
      : undefined;
  /*
    Latched by the row that actually took focus, NOT by an effect up here.
    An effect on this component would fire on renders where the Modules panel
    was never mounted — this function early-returns for "no active chapter"
    below, and again for the loading / offline / error banner — so a cold load
    (a pasted link, a refresh, open-in-new-tab, or just a slow first
    `useCurrentChapter`) would consume `?module=` while there was nothing to
    focus, and the officer would land at the top of the full module list. That
    is the exact thing this param exists to prevent, so the latch has to mean
    "focus was delivered", not "a render happened".

    State rather than a ref because `focusModuleKey` is read during render, and
    `react-hooks/refs` rightly forbids reading `ref.current` there.
  */
  const handleModuleFocused = useCallback(
    (key: string) => setConsumedModuleKey(key),
    [],
  );

  const accentDraft = useAccentDraft(chapterQuery.data);
  const rolloverForm = useRolloverForm();

  if (!activeChapterId) {
    return (
      <Card>
        <CardHeader>
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
  if (isOffline && anyReadUncached(chapterQuery)) {
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

  // Read through the contract type, not a second schema: a whole-payload
  // parse emptied the profile form whenever one field (a malformed `branding`
  // key) failed it, and a DTO rename typechecked green and blanked a field
  // (#2844).
  const chapter = chapterQuery.data;
  const profile = {
    name: chapter?.name ?? "",
    university: chapter?.university ?? "",
    donation_url: chapter?.donation_url ?? "",
  };

  const config = orgConfigQuery.data;
  // A viewer the config read refuses still gets the chapter's own terms: a
  // `semester:rollover` holder without `chapter-config:view` reaches the
  // Semester tab (#2946), whose promotion copy names the chapter's pledge
  // role. The member view of the chapter carries `org_archetype` and
  // `vocabulary` as well, for exactly this kind of reader.
  const memberView = chapterQuery.data as
    | {
        org_archetype?: string | null;
        vocabulary?: Record<string, string> | null;
      }
    | undefined;
  const archetypeKey =
    config?.org_archetype ?? memberView?.org_archetype ?? "ifc";
  const vocabulary = config?.vocabulary ?? memberView?.vocabulary ?? {};
  // #351: this chapter's term for the pre-promotion role, e.g. "New Member"
  // (IFC default), "Aspirant" (NPHC), "Candidate" (professional) — the
  // rollover copy in `settings-semester-tab.tsx` promotes members holding
  // this role, so it should read in the chapter's own vocabulary rather than
  // the hardcoded IFC term.
  // Capitalized: the rollover copy uses it as a role-name reference
  // alongside "Member" (itself always capitalized), and `vocab()`'s own
  // defaults are sentence-case prose ("New member") rather than the title
  // case the seeded role is actually displayed with elsewhere (e.g. the
  // Discord-import role mapping step).
  const pledgeTerm = titleCase(vocab("pledge", { vocabulary }));
  const brandingRaw = config?.branding ?? {};
  const branding: Branding = {
    greek_letters:
      typeof brandingRaw.greek_letters === "string"
        ? brandingRaw.greek_letters
        : undefined,
    short_name:
      typeof brandingRaw.short_name === "string"
        ? brandingRaw.short_name
        : undefined,
    show_greek_letters:
      typeof brandingRaw.show_greek_letters === "boolean"
        ? brandingRaw.show_greek_letters
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

  async function saveLogo(upload: ChapterLogoUpload) {
    try {
      await uploadLogo.mutateAsync(upload);
      toast({
        title: "Logo saved",
        description: "An entry was written to the chapter audit log.",
      });
    } catch (error) {
      toast({
        title: "Couldn't upload the logo",
        description: getErrorMessage(error, "Retry or check your connection."),
        variant: "destructive",
      });
    }
  }

  async function deleteLogo() {
    try {
      await removeLogo.mutateAsync();
      toast({
        title: "Logo removed",
        description:
          "Your chapter mark falls back to its short name or letters.",
      });
    } catch (error) {
      toast({
        title: "Couldn't remove the logo",
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

  /*
    Settings shows each viewer only what they can use (#2946). The nav's
    Settings row admits anyone Settings holds a tab or an officer tool for
    (`hasSettingsDestination`), so a treasurer who holds only reports:export
    arrives here too. Before, every setup tab rendered for everyone and the
    config-gated ones answered a non-holder with "Couldn't load chapter
    configuration".
  */
  const permissions = permissionsPayload?.permissions;
  const tools = visibleSettingsTools(permissions, isModuleEnabled);
  const visibleTabs = SETTINGS_TABS.filter((tab) =>
    isSettingsTabVisible(tab.value, permissions),
  );
  // A `?tab=` deep link to a tab this viewer does not get, or the default
  // `org` for someone with no setup tabs, lands on the first tab they do get.
  const shownTab = visibleTabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (visibleTabs[0]?.value ?? "");

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-6">
        {confirmDialog}
        <SettingsToolsOnly tools={tools} />
      </div>
    );
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
      {/*
        No description paragraph. "Configure your organization identity,
        modules, branding, and chapter administration" restated the rail
        immediately under it — `1f` pin 2 gives a route's body one toolbar row
        with "no wrapper card, no description paragraph", and lane 4 and lane 5
        deleted the same sentence off four other routes.
      */}
      <Tabs
        value={shownTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6 lg:flex-row lg:items-start"
      >
        <SettingsRail tools={tools} visibleTabs={visibleTabs} />

        <div className="min-w-0 flex-1">
          <TabsContent value="org" className="mt-0 space-y-6">
            {renderConfigGated(
              <SettingsOrgTab
                archetypeKey={archetypeKey}
                vocabulary={vocabulary}
                branding={branding}
                profile={profile}
                mark={{
                  logoUrl: chapterQuery.data?.logo_url ?? null,
                  onUploadLogo: saveLogo,
                  onRemoveLogo: deleteLogo,
                  logoPending: uploadLogo.isPending || removeLogo.isPending,
                }}
                canManage={canManage}
                canEditProfile={canEditProfile}
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
          </TabsContent>
          {/*
            Board `4d` gives Semester its own rail entry. It used to be two
            cards at the bottom of Organization, under the chapter profile and
            above the danger card — three unrelated jobs on one tab, which is
            why the tab needed a sentence explaining itself.
          */}
          <TabsContent value="semester" className="mt-0 space-y-6">
            <SettingsSemesterTab
              form={rolloverForm}
              pledgeTerm={pledgeTerm}
              confirm={confirm}
              rollover={rollover}
              rolloverGate={rolloverGate}
              semesters={semesters}
              semestersPending={semestersQuery.isPending}
            />
          </TabsContent>

          <TabsContent value="danger" className="mt-0 space-y-6">
            <SettingsDangerTab createPortal={createPortal} />
          </TabsContent>

          <TabsContent value="modules" className="mt-0">
            {renderConfigGated(
              <SettingsModulesTab
                enabledModules={enabledModules}
                canManage={canManage}
                pendingModuleKeys={pendingConfigKeys}
                focusModuleKey={focusModuleKey}
                onModuleFocused={handleModuleFocused}
                onToggle={(key, enabled) =>
                  patchConfig(
                    { enabled_modules: { [key]: enabled } },
                    enabled ? "Module enabled" : "Module disabled",
                  )
                }
              />,
            )}
          </TabsContent>

          {/*
            **Deliberately not `renderConfigGated`.** A `roles:manage` holder
            without `chapter-config:view` reaches this tab: the nav's Settings
            row admits `roles:manage` on its own (`settings-access.ts`), and
            `/roles` redirects here. This page's config read is gated on
            `chapter-config:view`, so gating the tab on it would land that
            member on "Couldn't load chapter configuration", which is what
            happened while the nav had a Roles row of its own (#2946 folded it
            into Settings). That combination is freely constructible from the
            matrix below.

            It does not need the gate: the matrix reads `useRoles` and
            `usePermissionsCatalog`, neither of which is chapter config. Only
            the default-invite-role picker is, and it degrades on its own —
            `configUnavailable` hides that one control rather than the tab.
          */}
          <TabsContent value="roles" className="mt-0">
            <SettingsRolesTab
              archetypeKey={archetypeKey}
              canManage={canManage}
              catalog={permissionsCatalog}
              // Pending as well as error. `renderConfigGated` used to block on
              // both; covering only the error case would render the
              // default-invite-role picker as "No default" while the config
              // read is still in flight, which is indistinguishable from a
              // chapter that never set one — and picking a role there would
              // overwrite the real default the response was about to deliver.
              configUnavailable={
                orgConfigQuery.isError || orgConfigQuery.isPending
              }
              defaultInviteRoleId={config?.default_invite_role_id ?? null}
              isSavingConfig={pendingConfigKeys.has("default_invite_role_id")}
              onSaveDefaultInviteRole={(roleId) =>
                patchConfig(
                  { default_invite_role_id: roleId },
                  "Default invite role saved",
                )
              }
            />
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
                pledgeTerm={pledgeTerm}
              />,
            )}
          </TabsContent>
          <TabsContent value="theme" className="mt-0">
            <SettingsAccentTab
              draft={accentDraft}
              canEditProfile={canEditProfile}
              updateChapter={updateChapter}
            />
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
        </div>
      </Tabs>
    </div>
  );
}

// `SettingsPageContent` reads `?tab=` via `useSearchParams`, which Next requires
// to sit under a Suspense boundary (matches the sign-in/sign-up/join pattern).
export function SettingsPage() {
  return (
    <>
      {/*
        Outside the Suspense boundary so the heading is there on the pending
        path too — the shell no longer supplies one (#2141), and the content
        below deliberately renders none of its own.
      */}
      <PageHeader title="Chapter settings" />
      <Suspense
        fallback={<LoadingState message="Loading chapter settings..." />}
      >
        <SettingsPageContent />
      </Suspense>
    </>
  );
}
