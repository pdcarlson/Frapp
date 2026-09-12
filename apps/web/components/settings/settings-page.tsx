"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
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
  type SemesterArchive,
} from "@repo/hooks";
import {
  CurrentChapterPayloadSchema,
  type CurrentChapterPayload,
  type PatchChapterConfig,
} from "@repo/validation";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { AA_NORMAL, contrastRatio, parseHex } from "@repo/color";
import { signetDarkTokens } from "@repo/theme/signet";
import { titleCase, vocab } from "@/lib/vocabulary";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { PageHeader } from "@/components/layout/page-header";
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
import { can, isOpsNudgeModuleKey } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, getErrorMessage } from "@/lib/utils";
import { SettingsOrgTab } from "@/components/settings/settings-org-tab";
import { SettingsModulesTab } from "@/components/settings/settings-modules-tab";
import { SettingsWorkflowsTab } from "@/components/settings/settings-workflows-tab";
import { SettingsDuesTab } from "@/components/settings/settings-dues-tab";
import { SettingsRolesTab } from "@/components/settings/settings-roles-tab";
import { SettingsPrivacyTab } from "@/components/settings/settings-privacy-tab";
import { SettingsFieldsTab } from "@/components/settings/settings-fields-tab";

type Branding = {
  greek_letters?: string;
  designation?: string;
  school_short?: string;
  founded_at?: number;
};

// Board `4d`: rail rows are `height:34px;border-radius:10px;padding:0 10px`,
// inactive `#A9A399`, active a filled gold chip (`background:#2A2410;
// color:#F0CD5E;font-weight:600`) rather than the §6 2px edge indicator this
// rail used to run down its side.
//
// **The fill is the chapter accent, not `--gold-ask-*`.** The board paints the
// Ask pill and the active tab at the same hexes only because the demo tenant's
// seed and the house gold coincide — the trap `tokens.md` §L-01 names and
// `pro-chip.tsx` already refused once in this lane. Ask is fixed; a settings
// tab is product UI and retints.
//
// **`--accent-subtle`/`--accent-text` are that retinting family. Plain
// `--accent` is not**: it is the neutral hover surface (`signet.css:103`,
// `#2A2621`), so `bg-accent` would paint the active tab a dead grey on every
// chapter, gold included.
//
// Below `lg` the rail is still a horizontal wrap row, so the chip reads the
// same either way — there is no underline variant to keep in sync any more.
const RAIL_TRIGGER_CLASS =
  "h-[34px] justify-start rounded-[10px] px-[10px] text-sm text-muted-foreground data-[state=active]:bg-accent-subtle data-[state=active]:font-semibold data-[state=active]:text-accent-text data-[state=active]:shadow-none lg:w-full lg:flex-none";

const RAIL_DANGER_TRIGGER_CLASS =
  "h-[34px] justify-start rounded-[10px] px-[10px] text-sm text-destructive data-[state=active]:bg-destructive/15 data-[state=active]:font-semibold data-[state=active]:text-destructive data-[state=active]:shadow-none lg:mt-auto lg:w-full lg:flex-none";

// Valid `?tab=` deep-link targets — mirrors the rail triggers below.
//
// Order is board `4d`'s: Chapter, Accent, Subscription, Modules, Roles, Join
// code, Semester, Fields, Privacy, then Danger zone pinned last. Three
// departures, each forced by what this product actually has:
//
// - **No `joincode`.** The board draws a Join code tab. `apps/web` has no
//   join-code surface at all — a repo-wide grep for `join_code`, `joinCode`
//   and `invite_code` returns nothing outside the API SDK. Building one is a
//   capability, and this lane is chrome (`deletion-checklist.md` §8).
// - **No `subscription`.** The board puts plan status behind this rail, but
//   `/billing` is a route a member reaches to pay their own invoice — see the
//   note in `billing-page.tsx`, which is why `4d`'s "Members never see this
//   page" was already refused there. A tab would hide it from the members it
//   is for. `/billing` stays a route; Danger zone links to the Stripe portal.
// - **`dues` and `workflows` are ours.** The board draws neither. Both are
//   live chapter configuration with no other home, so they keep rail entries,
//   slotted after Fields where the board's own knob tabs sit.
//
// `beta` and `audit` are gone rather than reordered. They rendered
// `SettingsComingSoon` stubs naming "Chunk 08" — generated chrome advertising
// unbuilt work, which is exactly what this epic deletes.
const SETTINGS_TAB_VALUES: readonly string[] = [
  "org",
  "theme",
  "modules",
  "roles",
  "semester",
  "fields",
  "dues",
  "workflows",
  "privacy",
  "danger",
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


/**
 * Names the surface a server-reported §8 contrast failure was measured
 * against, for the fixed three checks `deriveSignetPalette` can return
 * (`packages/chapter-theme/src/signet.ts`). Falls back to the raw values for
 * a shape a future engine change adds — never hides a real failure behind an
 * unrecognized pair.
 */
function describeFailedContrastCheck(check: {
  role: string;
  against: string;
  ratio: number;
}): string {
  const ratio = check.ratio.toFixed(1);
  if (
    check.role === "--signet-accent-text" &&
    check.against === "--signet-accent-subtle-bg"
  ) {
    return `Accent text on its own tinted background reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  // Only claim "app background" when `against` is the literal background hex
  // this check is actually specified for — never inferred from `role` alone,
  // so a future engine check on `--signet-accent-text` against some other
  // surface falls to the raw fallback below instead of being mislabeled.
  if (
    check.role === "--signet-accent-text" &&
    !check.against.startsWith("--signet-")
  ) {
    return `Accent text on the app background reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  if (
    check.role === "--signet-accent-on-primary" &&
    check.against === "--signet-accent-primary"
  ) {
    return `Text on the accent's solid fill reads at ${ratio}:1, under the 4.5:1 minimum.`;
  }
  return `${check.role} against ${check.against} reads at ${ratio}:1, under the 4.5:1 minimum.`;
}

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

  const canManage = can(
    "chapter-config:manage",
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

  const [accentDraft, setAccentDraft] = useState("");
  // The server's own §8 disclosure from the last successful save — distinct
  // from `previewInkFailsAA` below, which is a client-side check of the
  // unsaved draft. Cleared on the next edit so a stale warning never survives
  // past the accent it was measured against (#1183).
  const [accentContrastWarning, setAccentContrastWarning] = useState<
    { role: string; against: string; ratio: number }[] | null
  >(null);
  const [semesterLabel, setSemesterLabel] = useState("");
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  // Defaults to off: promotion rewrites roles across the whole chapter and is
  // not one-click undoable, so it is opted into per rollover, never inherited.
  const [promoteNewMembers, setPromoteNewMembers] = useState(false);

  useEffect(() => {
    const parsed = CurrentChapterPayloadSchema.safeParse(chapterQuery.data);
    if (!parsed.success) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the accent draft from the chapter query
    setAccentDraft(parsed.data.accent_color ?? "");
    // A resync (chapter switch, another tab's save, a background refetch) can
    // change the draft out from under a still-displayed warning, which would
    // otherwise describe a colour this render no longer shows (#1183).
    setAccentContrastWarning(null);
  }, [chapterQuery.data]);

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

  const parsedChapter = CurrentChapterPayloadSchema.safeParse(
    chapterQuery.data,
  );
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
  // #351: this chapter's term for the pre-promotion role, e.g. "New Member"
  // (IFC default), "Aspirant" (NPHC), "Candidate" (professional) — the
  // rollover copy below promotes members holding this role, so it should
  // read in the chapter's own vocabulary rather than the hardcoded IFC term.
  // Capitalized: the rollover copy uses it as a role-name reference
  // alongside "Member" (itself always capitalized), and `vocab()`'s own
  // defaults are sentence-case prose ("New member") rather than the title
  // case the seeded role is actually displayed with elsewhere (e.g. the
  // Discord-import role mapping step).
  const pledgeTerm = titleCase(vocab("pledge", config));
  // "every X", not "Xs": `pledgeTerm` can be an officer-typed free-text
  // override with no plural-form guarantee (see settings-org-tab.tsx's
  // vocab editor) — naively appending "s" breaks for a term already plural
  // or ending in s/x/z/ch/sh.
  const promoteToggleLabel = `Also promote every ${pledgeTerm} to Member`;
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
    The on-accent tone for the *draft* colour, and whether it is legible.

    See the swatch below for why `--primary-foreground` cannot answer this.
    What matters here is the `?? ` this used to end with: `pickAccessibleColor`
    returns `null` when *neither* candidate clears AA, and falling back to
    `gold.onHouse` reasserted a tone it had just rejected. The review typed an
    ordinary blue — nothing exotic — and got "Preview" at a sub-AA ratio with
    no warning, which is the same defect one layer down from the one this
    swatch was being fixed for. (`#0086FE` on the current ladder: kept by the
    resolver at 4.62:1 on `--card`, ink at 4.446:1. The original `#0080FD`
    stopped reaching this branch when the greenfield ladder lightened `--card`
    and the resolver began substituting it.)

    The docstring's excuse was wrong too: `resolveChapterAccentColor` does not
    reject that accent. It asks whether the accent is legible **as text on the
    card**, which is a different question from whether text is legible **on
    the accent**, and it answers `reason: "ok"`.

    So: always the better of the two rather than the first that passes, which
    is defined for every input; and when the better one still misses, the
    screen says so instead of drawing an illegible label and calling it a
    preview. `writing.md` §7 carries the string.
  */
  const accentRgb = parseHex(accent.resolvedAccent);
  const inkCandidates = [
    signetDarkTokens.color.gold.onHouse,
    signetDarkTokens.color.text.foreground,
  ] as const;
  const previewInk = accentRgb
    ? (inkCandidates.reduce((best, candidate) =>
        contrastRatio(parseHex(candidate)!, accentRgb) >
        contrastRatio(parseHex(best)!, accentRgb)
          ? candidate
          : best,
      ) as string)
    : signetDarkTokens.color.gold.onHouse;
  const previewInkRatio = accentRgb
    ? contrastRatio(parseHex(previewInk)!, accentRgb)
    : 0;
  const previewInkFailsAA = accentRgb !== null && previewInkRatio < AA_NORMAL;
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

  function updateAccentDraft(value: string) {
    setAccentDraft(value);
    // A new edit invalidates the previous save's server-reported warning —
    // it described a different colour.
    setAccentContrastWarning(null);
  }

  async function saveAccent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await updateChapter.mutateAsync({
        accent_color: accentDraft || undefined,
      });
      setAccentContrastWarning(result?.failedContrastChecks ?? null);
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
      description: promoteNewMembers
        ? `The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves. Every ${pledgeTerm} is also promoted to Member; they keep any other roles they hold, and this cannot be undone in one step.`
        : "The current leaderboard period is archived and a new one begins. Points already awarded are kept — only the leaderboard's default window moves.",
      confirmLabel: "Start new semester",
      // Not destructive: a rollover archives rather than deletes, and
      // `writing.md` §7's own copy for this flow says the history stays. A red
      // button would state a loss the API does not perform. Promotion is a role
      // change rather than a deletion, so it does not change that reading — the
      // description above states its scope instead.
      tone: "default",
    });
    if (!confirmed) return;
    try {
      await rollover.mutateAsync({
        label: semesterLabel,
        start_date: semesterStart,
        end_date: semesterEnd,
        promote_new_members: promoteNewMembers,
      });
      toast({
        title: "Semester archived",
        description: promoteNewMembers
          ? `${semesterLabel} is now the active period, and every ${pledgeTerm} was promoted to Member.`
          : `${semesterLabel} is now the active period.`,
      });
      setSemesterLabel("");
      setSemesterStart("");
      setSemesterEnd("");
      setPromoteNewMembers(false);
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
      {/*
        No description paragraph. "Configure your organization identity,
        modules, branding, and chapter administration" restated the rail
        immediately under it — `1f` pin 2 gives a route's body one toolbar row
        with "no wrapper card, no description paragraph", and lane 4 and lane 5
        deleted the same sentence off four other routes.
      */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6 lg:flex-row lg:items-start"
      >
        {/*
          Board `4d`: `width:200px`, `padding:12px 8px`, `gap:2px`, a right
          hairline. `lg:w-[200px]` is that width exactly rather than the `w-56`
          (224px) this rail used to take.
        */}
        <TabsList className="flex h-auto w-full flex-row flex-wrap justify-start gap-0.5 bg-transparent p-0 lg:w-[200px] lg:flex-col lg:flex-nowrap lg:items-stretch lg:self-stretch lg:border-r lg:border-border lg:px-2 lg:py-3">
          <TabsTrigger value="org" className={RAIL_TRIGGER_CLASS}>
            Chapter
          </TabsTrigger>
          <TabsTrigger value="theme" className={RAIL_TRIGGER_CLASS}>
            Accent
          </TabsTrigger>
          <TabsTrigger value="modules" className={RAIL_TRIGGER_CLASS}>
            Modules
          </TabsTrigger>
          <TabsTrigger value="roles" className={RAIL_TRIGGER_CLASS}>
            Roles
          </TabsTrigger>
          <TabsTrigger value="semester" className={RAIL_TRIGGER_CLASS}>
            Semester
          </TabsTrigger>
          <TabsTrigger value="fields" className={RAIL_TRIGGER_CLASS}>
            Fields
          </TabsTrigger>
          <TabsTrigger value="dues" className={RAIL_TRIGGER_CLASS}>
            Dues
          </TabsTrigger>
          <TabsTrigger value="workflows" className={RAIL_TRIGGER_CLASS}>
            Workflows
          </TabsTrigger>
          <TabsTrigger value="privacy" className={RAIL_TRIGGER_CLASS}>
            Privacy
          </TabsTrigger>
          <TabsTrigger value="danger" className={RAIL_DANGER_TRIGGER_CLASS}>
            Danger zone
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
          </TabsContent>

          {/*
            Board `4d` gives Semester its own rail entry. It used to be two
            cards at the bottom of Organization, under the chapter profile and
            above the danger card — three unrelated jobs on one tab, which is
            why the tab needed a sentence explaining itself.
          */}
          <TabsContent value="semester" className="mt-0 space-y-6">
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
                    {/*
                      Pledge promotion (spec/behavior/semester-rollover.md step
                      3). Optional and off by default — it rewrites roles across
                      the chapter, so it is opted into per rollover. The
                      confirmation dialog restates the consequence before it
                      runs. Same `gate.controlProps` as the submit button so an
                      ungated chapter cannot toggle a control it cannot use.

                      Wrapped in `<Can permission="roles:manage">` because the
                      API enforces exactly that on the promotion path: rewriting
                      `members.role_ids` is what `PATCH /members/:id/roles`
                      gates, and `semester:rollover` alone does not carry it.
                      Offering the toggle without it would produce a 403 at
                      submit. A rollover *without* promotion stays available —
                      this hides the toggle, never the card.

                      `aria-label` is explicit rather than inherited from the
                      wrapping `<label>`: a `<label>` does not name a `button`,
                      which is what Radix renders for `role="switch"`. Same
                      reason `settings-fields-tab.tsx` names its switches.
                    */}
                    <Can permission="roles:manage">
                      <label className="flex items-start gap-2 text-sm md:col-span-3">
                        <Switch
                          id="semester-promote"
                          aria-label={promoteToggleLabel}
                          checked={promoteNewMembers}
                          onCheckedChange={setPromoteNewMembers}
                          {...rolloverGate.controlProps(rollover.isPending)}
                        />
                        <span>
                          {promoteToggleLabel}
                          <span className="block text-xs text-muted-foreground">
                            {`Everyone currently holding the ${pledgeTerm} role becomes a Member. Other roles they hold are kept.`}
                          </span>
                        </span>
                      </label>
                    </Can>
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
          </TabsContent>

          {/*
            Board `4d` pin 1 pins Danger zone last, and this is what it holds:
            the Stripe portal (where a chapter cancels) and the deactivation
            route. It was the third card on Organization, which put "cancel the
            subscription" one scroll under "set your founding year".
          */}
          <TabsContent value="danger" className="mt-0 space-y-6">
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
                  Chapter deactivation is a supported-by-Signet action. Contact
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
            **Deliberately not `renderConfigGated`.** The nav's Roles row is
            gated on `roles:manage` (`nav-config.ts`), but this page's config
            read is gated on `chapter-config:view` — so a member holding the
            first and not the second saw the Roles row, clicked it, and landed
            on "Couldn't load chapter configuration". That combination is
            freely constructible from the matrix below, and the board makes the
            row a deep link into this tab (`4d` pin 1), so the deep link has to
            actually arrive.

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
              configUnavailable={orgConfigQuery.isError || orgConfigQuery.isPending}
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
            <Card>
              <CardHeader>
                <CardTitle>Accent color</CardTitle>
                <CardDescription>
                  Shown on primary buttons, chat name tags, and branded PDF
                  reports. Must meet WCAG AA contrast against white; invalid
                  colors fall back to the Signet default. Full theme
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
                      onChange={(event) =>
                        updateAccentDraft(event.target.value)
                      }
                      className="h-12 w-24 p-1"
                    />
                    <Input
                      aria-label="Accent color hex value"
                      value={accentDraft}
                      onChange={(event) =>
                        updateAccentDraft(event.target.value)
                      }
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
                      two ends of the text ladder — and where neither clears
                      AA, the caption below says so rather than the swatch
                      drawing an illegible word and calling it a preview.
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
                  {/*
                    A second, different question from the one above. That
                    warning fires when the accent is illegible *as text on the
                    card*; this one when text is illegible *on the accent* —
                    which is what a primary button actually is, and what this
                    card's own description promises the accent will be used
                    for. `#0080FD` passes the first and fails this one, so
                    without it an admin ships unreadable button labels having
                    been told the colour was fine.
                  */}
                  {previewInkFailsAA ? (
                    <p className="text-xs text-warning">
                      Label text on this color reads at{" "}
                      {previewInkRatio.toFixed(1)}:1, under the 4.5:1 minimum.
                      Buttons and name tags using it will be hard to read — pick
                      a lighter or darker shade.
                    </p>
                  ) : null}
                  {/*
                    A third, independent question from the two above — those
                    are client-side checks of the unsaved draft against a
                    single fixed backdrop each. This is the server's own §8
                    verdict on the colour actually saved, generated through
                    the real Signet pipeline. §8 forbids a runtime
                    substitution here, so a failing save still succeeds — this
                    discloses rather than corrects (#1183).
                  */}
                  {accentContrastWarning && accentContrastWarning.length > 0 ? (
                    <p className="text-xs text-warning">
                      {accentContrastWarning
                        .map(describeFailedContrastCheck)
                        .join(" ")}{" "}
                      Try a lighter or darker shade of this hue and save again.
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={!canManage || updateChapter.isPending}
                  >
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
      <Suspense fallback={<LoadingState message="Loading chapter settings..." />}>
        <SettingsPageContent />
      </Suspense>
    </>
  );
}
