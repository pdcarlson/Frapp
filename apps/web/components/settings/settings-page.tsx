"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type OrgDues,
  useCurrentChapter,
  aiAvailableFrom,
  isFirstAiReadInFlight,
  useAiConsent,
  useMyPermissions,
  useOrgConfig,
  usePatchOrgConfig,
  usePendingConfigKeys,
  useSemesterRollover,
  useSemesters,
  useRemoveChapterLogo,
  useUpdateChapter,
  useUploadChapterLogo,
  type ChapterLogoUpload,
  type SemesterArchive,
} from "@repo/hooks";
import { type PatchChapterConfig } from "@repo/validation";
import { memberViewVocabulary, titleCase, vocab } from "@repo/org-archetypes";
import { InlineNote } from "@/components/shared/inline-note";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  ErrorState,
  anyReadUncached,
  OfflineState,
} from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useSubscriptionGate } from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import {
  can,
  canAll,
  CHAPTER_PROFILE_PERMISSIONS,
  isModuleEnabled as isStoredModuleEnabled,
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
  SettingsNothingHere,
  SettingsRail,
  resolveSettingsTabParam,
} from "@/components/settings/settings-rail";
import {
  isModuleSettingsTab,
  shownModuleSettings,
} from "@/components/settings/settings-modules";
import { ModuleSettingsPage } from "@/components/settings/module-settings-page";
import { StudyZonesManager } from "@/components/geofences/study-zones-manager";
import { MeetingSectionsRules } from "@/components/meetings/meeting-sections-rules";
import {
  DuesGraceRule,
  PointsRules,
  ServiceHoursRules,
} from "@/components/settings/module-rules";
import {
  SettingsAccentTab,
  useAccentDraft,
} from "@/components/settings/settings-accent-tab";
import {
  SettingsSemesterTab,
  useRolloverForm,
} from "@/components/settings/settings-semester-tab";
import { PlanAndBilling } from "@/components/billing/plan-and-billing";
import { SettingsOrgTab } from "@/components/settings/settings-org-tab";
import { SettingsDuesTab } from "@/components/settings/settings-dues-tab";
import { SettingsRolesTab } from "@/components/settings/settings-roles-tab";
import { SettingsPrivacyTab } from "@/components/settings/settings-privacy-tab";
import { SettingsAiTab } from "@/components/settings/settings-ai-tab";
import { SettingsFieldsTab } from "@/components/settings/settings-fields-tab";
import { SettingsClassesTab } from "@/components/settings/settings-classes-tab";
import {
  SettingsBodySkeleton,
  SettingsTabSkeleton,
} from "@/components/settings/settings-skeleton";

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
  const {
    data: permissionsPayload,
    isError: permissionsFailed,
    error: permissionsError,
    fetchStatus: permissionsFetchStatus,
    refetch: refetchPermissions,
  } = useMyPermissions({
    enabled: !!activeChapterId,
  });
  const isModuleEnabled = useChapterModuleGate();
  // Whether this server has AI: the AI row shows only on `true` (#4308).
  const aiConsent = useAiConsent();
  const aiAvailable = aiAvailableFrom(aiConsent);
  const semestersQuery = useSemesters();
  const updateChapter = useUpdateChapter();
  const uploadLogo = useUploadChapterLogo();
  const removeLogo = useRemoveChapterLogo();
  const patchOrgConfig = usePatchOrgConfig();
  // Which settings are saving, not merely whether something is. One shared
  // `isPending` used to disable every control on every tab at once (#881).
  const pendingConfigKeys = usePendingConfigKeys();
  const rollover = useSemesterRollover();
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
  // `?tab=theme` (Accent, folded into Chapter) resolves to `org`. The old
  // Modules list's `?tab=modules&module=<key>` opens that module's page.
  const moduleParam = searchParams.get("module");
  const requestedModuleKey =
    moduleParam && isModuleSettingsTab(moduleParam) ? moduleParam : undefined;
  const rawTabParam = searchParams.get("tab");
  const tabParam =
    rawTabParam === "modules" && requestedModuleKey
      ? requestedModuleKey
      : resolveSettingsTabParam(rawTabParam);
  const [activeTab, setActiveTab] = useState(tabParam ?? "org");
  useEffect(() => {
    if (tabParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follow `?tab=` deep links without wiping a tab the member already picked
      setActiveTab(tabParam);
    }
  }, [tabParam]);
  // Switching rows starts the panel at its top, not wherever the last one
  // was scrolled to: the panel scrolls inside the shell's tool pane.
  const changeTab = useCallback((next: string) => {
    setActiveTab(next);
    document.querySelector("[data-tool-page]")?.scrollTo?.({ top: 0 });
  }, []);

  /**
   * `?module=` lands an officer on that module's page with its switch
   * focused, which is how chat's ops-setup nudge (#492) sends them to turn a
   * module on. Validated against the module pages rather than passed
   * through.
   *
   * **Consumed once, not held for the visit.** `TabsContent` carries no
   * `forceMount`, so Radix unmounts the inactive page, and the tab is driven
   * by local state without rewriting the URL, so `?module=` survives the whole
   * visit. Without this latch, an officer who follows the nudge, wanders to
   * another row and comes back gets focus yanked to the switch every time.
   */
  const [consumedModuleKey, setConsumedModuleKey] = useState<string | null>(
    null,
  );
  const focusModuleKey =
    requestedModuleKey && consumedModuleKey !== requestedModuleKey
      ? requestedModuleKey
      : undefined;
  /*
    Latched by the switch that actually took focus, NOT by an effect up here.
    An effect on this component would fire on renders where the module page
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
      <InlineNote>
        Select an active chapter to edit its organization, modules, and
        branding.
      </InlineNote>
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
  if (
    isOffline &&
    (anyReadUncached(chapterQuery) || permissionsPayload === undefined)
  ) {
    stateBanner = (
      <OfflineState
        title="Chapter settings unavailable offline"
        description="Reconnect to load this chapter's identity, modules, and branding."
        onRetry={() => {
          void chapterQuery.refetch();
          void refetchPermissions();
        }}
      />
    );
  } else if (chapterQuery.isLoading || chapterPaused) {
    stateBanner = <SettingsBodySkeleton />;
  } else if (chapterQuery.isError && chapterQuery.data === undefined) {
    // Only a first load that failed. A background refetch that fails keeps
    // the page it already drew: unmounting it would throw away a study zone
    // half drawn in the map editor, or an open delete confirmation.
    stateBanner = (
      <ErrorState
        title="Couldn't load chapter settings"
        description={`${describeLoadFailure(chapterQuery.error)} Changes here update every surface in the dashboard.`}
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  } else if (permissionsPayload === undefined) {
    /*
      The tabs and tools below are filtered by the viewer's permissions, and
      while those are unknown there is nothing to draw: not an officer's rail
      for a member who arrived by URL (#3854), and not "Nothing in Chapter
      settings" for an officer whose read is still in flight. So the page holds
      its skeleton until the read answers. A failed read refuses to guess.
    */
    stateBanner =
      permissionsFailed && permissionsFetchStatus !== "fetching" ? (
        <ErrorState
          title="Couldn't load chapter settings"
          description={`${describeLoadFailure(permissionsError)} Your role decides what this page shows.`}
          onRetry={() => void refetchPermissions()}
        />
      ) : (
        <SettingsBodySkeleton />
      );
  } else if (isFirstAiReadInFlight(aiConsent)) {
    /*
      The same hold for the AI row (#4308): drawn without it and then
      inserted, it pushed every row below Privacy down and sent `?tab=ai` to
      the first tab. The read runs beside the permissions read, so the wait
      is rarely longer. A paused read, or a first attempt that failed, stops
      waiting and leaves the row out, as with AI off, without waiting out
      the retries (#4504).
    */
    stateBanner = <SettingsBodySkeleton />;
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
  // `memberViewVocabulary` lays the archetype's words under the chapter's: a
  // reader the config read refuses gets the member view's stored column as
  // it is, which can be `{}` (a chapter created without onboarding's seed) or
  // hold a cleared `""`, and either alone would name an NPHC chapter's
  // aspirants "New Member".
  const chapterWords = memberViewVocabulary({
    org_archetype: archetypeKey,
    vocabulary,
  });
  const pledgeTerm = titleCase(vocab("pledge", chapterWords));
  // The chapter's words for a pledge class and a member's order number, which
  // name the pledge class tab and everything in it (#3939).
  const classTerm = vocab("class", chapterWords);
  const orderTerm = vocab("order", chapterWords);
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
  const enabledModules = config?.enabled_modules;
  const workflows = config?.workflows ?? [];
  const dues = config?.dues ?? DEFAULT_DUES;
  const semesters = asArray<SemesterArchive>(semestersQuery.data);

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
          "Your change wasn't saved. Try again in a moment.",
        ),
        variant: "destructive",
      });
    }
  }

  function renderConfigGated(node: React.ReactNode) {
    if (orgConfigQuery.isPending) {
      return <SettingsTabSkeleton />;
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

  /** The Rules block for a module that has stored rules, else nothing. */
  function renderModuleRules(key: string): React.ReactNode {
    const patchRules = (diff: PatchChapterConfig, title: string) =>
      patchConfig(diff, title);
    if (key === "hours") {
      return renderConfigGated(
        <ServiceHoursRules
          minutesPerPoint={config?.service?.minutes_per_point}
          workflows={workflows}
          canManage={canManage}
          savingRate={pendingConfigKeys.has("service")}
          savingWorkflows={pendingConfigKeys.has("workflows")}
          onPatch={patchRules}
        />,
      );
    }
    if (key === "points") {
      return renderConfigGated(
        <PointsRules
          points={config?.points}
          canManage={canManage}
          saving={pendingConfigKeys.has("points")}
          onPatch={patchRules}
        />,
      );
    }
    if (key === "dues") {
      return renderConfigGated(
        <div className="space-y-4">
          <SettingsDuesTab
            dues={dues}
            canManage={canManage}
            isSaving={pendingConfigKeys.has("dues")}
            onSave={(next) => patchConfig({ dues: next }, "Dues saved")}
            pledgeTerm={pledgeTerm}
          />
          <DuesGraceRule
            workflows={workflows}
            canManage={canManage}
            saving={pendingConfigKeys.has("workflows")}
            onPatch={patchRules}
          />
        </div>,
      );
    }
    if (key === "meetings") {
      return <MeetingSectionsRules canManage={canManage} />;
    }
    return undefined;
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
  /*
    A module's switch, as `ChapterGuard` enforces it (#3028). The config read
    answers for a config viewer; a viewer it refuses (a treasurer reaching
    Reports through `reports:export`) reads the member view's gate, which
    applies the same `isModuleEnabled`. Unresolved reads say on, like the
    nav, so no row flashes "Off".
  */
  const moduleOn = (key: string): boolean => {
    if (enabledModules) return isStoredModuleEnabled(enabledModules, key);
    return isModuleEnabled ? isModuleEnabled(key) : true;
  };
  const visibleTabs = SETTINGS_TABS.filter(
    (tab) =>
      isSettingsTabVisible(tab.value, permissions, isModuleEnabled) &&
      // The AI row waits for the server to say it has AI (#4308).
      (tab.value !== "ai" || aiAvailable === true),
  ).map((tab) => {
    if (tab.value === "classes") return { ...tab, label: classTerm };
    if (isModuleSettingsTab(tab.value)) {
      return { ...tab, off: !moduleOn(tab.value) };
    }
    return tab;
  });
  const canViewConfig = can("chapter-config:view", permissions);
  const canSeeWhoCan = can("members:view", permissions);
  // A `?tab=` deep link to a tab this viewer does not get, or the default
  // `org` for someone with no setup tabs, lands on the first tab they do get.
  const shownTab = visibleTabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (visibleTabs[0]?.value ?? "");

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-6">
        {confirmDialog}
        <SettingsNothingHere />
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
      {/*
        One layout for every row (#3713): the rail at its fixed 200px, sticky,
        and the panel beside it at one width whichever row is open, so nothing
        moves sideways when the officer switches rows. Chapter settings has the
        whole width: chat closes beside it (decision 3 of #4068,
        `isFullWidthToolRoute`).
      */}
      <Tabs
        value={shownTab}
        onValueChange={changeTab}
        className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10"
      >
        <SettingsRail visibleTabs={visibleTabs} />

        <div className="w-full min-w-0 max-w-[960px] flex-1">
          <TabsContent value="org" className="mt-0">
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
                accentSection={
                  <SettingsAccentTab
                    draft={accentDraft}
                    canEditProfile={canEditProfile}
                    updateChapter={updateChapter}
                    orgName={chapter?.name}
                  />
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
          <TabsContent value="semester" className="mt-0">
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

          {/*
            Plan and billing (#3827): the old `/billing` route, gated on
            `billing:view` like the sidebar row it replaces. No config gate:
            it reads the billing record and invoices, not chapter config.
          */}
          <TabsContent value="billing" className="mt-0">
            <PlanAndBilling />
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
            tier permission pages below.

            It does not need the gate: the roles pages read `useRoles` and
            `useRoleTiers`, neither of which is chapter config. Only
            the default-invite-role picker is, and it degrades on its own —
            `configUnavailable` hides that one control rather than the tab.
          */}
          <TabsContent value="roles" className="mt-0">
            <SettingsRolesTab
              canManage={canManage}
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

          {/*
            No config gate: the tab reads the pledge class list and the
            roster, neither of which is chapter config, and its words fall
            back to the member view's vocabulary.
          */}
          <TabsContent value="classes" className="mt-0">
            <SettingsClassesTab
              canManage={can("roles:manage", permissions)}
              classTerm={classTerm}
              orderTerm={orderTerm}
            />
          </TabsContent>

          <TabsContent value="fields" className="mt-0">
            {renderConfigGated(<SettingsFieldsTab canManage={canManage} />)}
          </TabsContent>

          {/*
            One page per module (#4073). The switch and "who can" read no
            config a tool-only viewer lacks the way rules do, so only the
            rules wait on the config read.
          */}
          {shownModuleSettings().map((module) => (
            <TabsContent key={module.key} value={module.key} className="mt-0">
              <ModuleSettingsPage
                module={module}
                on={moduleOn(module.key)}
                canManage={canManage}
                switchPending={pendingConfigKeys.has(
                  `enabled_modules.${module.key}`,
                )}
                onToggle={(enabled) =>
                  patchConfig(
                    { enabled_modules: { [module.key]: enabled } },
                    enabled
                      ? `${module.label} turned on`
                      : `${module.label} turned off`,
                  )
                }
                tools={tools.filter((tool) => tool.page === module.key)}
                toolBody={
                  module.key === "geofences" &&
                  tools.some((tool) => tool.id === "study-zones") ? (
                    <StudyZonesManager />
                  ) : undefined
                }
                canSeeWhoCan={canSeeWhoCan}
                canEditRoles={can("roles:manage", permissions)}
                focusSwitch={focusModuleKey === module.key}
                onSwitchFocused={handleModuleFocused}
                rules={
                  canViewConfig ? renderModuleRules(module.key) : undefined
                }
              />
            </TabsContent>
          ))}
          <TabsContent value="ai" className="mt-0">
            <SettingsAiTab />
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
      <Suspense fallback={<SettingsBodySkeleton />}>
        <SettingsPageContent />
      </Suspense>
    </>
  );
}
