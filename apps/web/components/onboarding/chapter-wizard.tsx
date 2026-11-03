"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Mail,
  PencilLine,
} from "lucide-react";
import {
  ARCHETYPES,
  getArchetype,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import {
  EMPTY_CHAPTER_IDENTITY,
  FOUNDED_YEAR_MIN,
  chapterIdentityBranding,
  chapterIdentityIsValid,
  latestFoundedYear,
  normalizeAccentInput,
  type ChapterIdentityForm,
} from "@repo/hooks/chapter-identity";
import {
  DIRECTORY_MIN_QUERY_LENGTH,
  useChapterDirectorySearch,
  useCreateInvite,
  useEmailInvites,
  useOnboardChapter,
  useUploadChapterLogo,
  type ChapterDirectoryResult,
  type ChapterLogoUpload,
} from "@repo/hooks";
import {
  CHAPTER_SHORT_NAME_MAX_LENGTH,
  EmailInviteSchema,
  acceptAttribute,
  dedupeEmails,
  resolveChapterMark,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CrestTile } from "@/components/layout/crest-tile";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { StepDots } from "@/components/onboarding/step-dots";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { SearchGlyph } from "@/components/profile/profile-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { useToast } from "@/lib/hooks/use-toast";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { buildJoinUrl } from "@/lib/invite-link";
import { inspectLogoFile } from "@/lib/chapter-logo";
import { FERPA_URL } from "@/lib/legal-links";

/**
 * Where a brand-new founder lands when the wizard finishes.
 *
 * **Checkout, not chat (#2297).** `ChapterService.create` has no billing
 * dependency, so a freshly created chapter sits at `subscription_status
 * 'incomplete'` — every screen loads and every paid-ops *write* 403s, with
 * each failure inviting a retry that cannot succeed (Guideline 2.1). The
 * recorded decision is to make that state unreachable on the normal path
 * rather than to widen the free tier, so the founder is put in front of
 * checkout while `#913`'s 14-day trial makes it free on day zero
 * (`grantTrial: !chapter.subscription_id` → Stripe reports `trialing`, which
 * `mapStripeStatus` folds to `active`, opening every gate immediately).
 *
 * **A landing, not a gate.** Nothing blocks navigating away — the dashboard
 * shell and its nav are fully available, which is what keeps this consistent
 * with `spec/product/positioning.md`'s "inline nudges rather than a mandatory
 * gate". `/billing` already offers checkout at this exact status.
 */
const POST_CREATE_PATH = "/billing";
const INVITE_ROLE = "Member";

type WizardStep = "find" | "archetype" | "identity" | "invite";
const STEP_ORDER: WizardStep[] = ["find", "archetype", "identity", "invite"];
const STEP_LABELS: Record<WizardStep, string> = {
  find: "Find your chapter",
  archetype: "Pick your archetype",
  identity: "Confirm identity",
  invite: "Invite members",
};

export function ChapterWizard({ onComplete }: { onComplete: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const selectChapter = useSelectChapter();

  const onboardChapter = useOnboardChapter();
  const uploadLogo = useUploadChapterLogo();
  const createInvite = useCreateInvite();
  const emailInvites = useEmailInvites();

  const [step, setStep] = useState<WizardStep>("find");
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery, 250);

  const [directoryId, setDirectoryId] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<ArchetypeKey>("ifc");
  const [identity, setIdentity] = useState<ChapterIdentityForm>(
    EMPTY_CHAPTER_IDENTITY,
  );
  // The logo waits in the browser until the chapter exists: the logo routes
  // are chapter-scoped, so nothing can be uploaded before the create lands.
  const [logo, setLogo] = useState<ChapterLogoUpload | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [emailFailures, setEmailFailures] = useState<string[]>([]);
  const [emailSentCount, setEmailSentCount] = useState(0);

  const searchQuery = useChapterDirectorySearch(debouncedQuery, {
    enabled: step === "find",
  });
  const results = asArray<ChapterDirectoryResult>(searchQuery.data);

  const stepIndex = STEP_ORDER.indexOf(step);

  function applyDirectoryMatch(row: ChapterDirectoryResult) {
    const resolvedArchetype = getArchetype(row.archetype).key;
    setDirectoryId(row.id);
    setArchetype(resolvedArchetype);
    setIdentity({
      name: row.org_name ?? "",
      university: row.university ?? "",
      greekLetters: row.org_letters ?? "",
      // The directory knows letters, not whether an organization shows them,
      // so these two keep whatever the founder already chose.
      shortName: identity.shortName,
      showGreekLetters: identity.showGreekLetters,
      designation: row.chapter_designation ?? "",
      schoolShort: row.university_short ?? "",
      foundedYear: row.founded_year ? String(row.founded_year) : "",
      colorAccent: normalizeAccentInput(row.default_colors?.accent),
    });
    // A different chapter identity invalidates any prior consent — re-affirm.
    setAcceptedLegal(false);
    setStep("archetype");
  }

  function startManualEntry() {
    setDirectoryId(null);
    setArchetype("ifc");
    setIdentity({
      ...EMPTY_CHAPTER_IDENTITY,
      // Seed the chapter name from whatever the officer was searching for.
      name: rawQuery.trim(),
    });
    setAcceptedLegal(false);
    setStep("archetype");
  }

  function goBack() {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setStep(prev);
  }

  const identityValid = chapterIdentityIsValid(identity);
  // Gate "Create chapter" on the required Terms/Privacy acceptance as well as a
  // valid identity (spec/behavior/legal.md). The API enforces the same rule
  // server-side (ChapterOnboardingDto.accept_terms_privacy must be true).
  const canSubmit = identityValid && acceptedLegal;

  async function submitChapter() {
    if (!canSubmit) return;
    try {
      const chapter = await onboardChapter.mutateAsync({
        name: identity.name.trim(),
        university: identity.university.trim(),
        org_archetype: archetype,
        directory_id: directoryId ?? undefined,
        accept_terms_privacy: true,
        branding: chapterIdentityBranding(identity),
      });
      const id =
        chapter && typeof chapter === "object" && "id" in chapter
          ? ((chapter as { id?: string }).id ?? null)
          : null;
      if (id) await selectChapter(id);
      // After the switch, so the logo routes resolve the new chapter. A failed
      // upload doesn't undo a created chapter: say so and point at Settings,
      // where the same control lives.
      let logoFailed = false;
      if (id && logo) {
        try {
          await uploadLogo.mutateAsync(logo);
        } catch {
          logoFailed = true;
        }
      }
      toast(
        logoFailed
          ? {
              title: "Chapter created, but the logo didn't upload",
              description:
                "Add it from Settings → Chapter. Everything else is set up.",
              variant: "destructive",
            }
          : {
              title: "Chapter created",
              description:
                "Your chapter is set up. Invite your members to start chatting.",
            },
      );
      setStep("invite");
    } catch (error) {
      toast({
        title: "Unable to create chapter",
        description: getErrorMessage(error, "Please try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function generateInviteLink() {
    try {
      const invite = await createInvite.mutateAsync({ role: INVITE_ROLE });
      const token =
        invite && typeof invite === "object" && "token" in invite
          ? ((invite as { token?: string }).token ?? null)
          : null;
      if (!token) throw new Error("Invite did not return a token.");
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(buildJoinUrl(origin, token));
    } catch (error) {
      toast({
        title: "Unable to create invite link",
        description: getErrorMessage(
          error,
          "You can invite members later from Members.",
        ),
        variant: "destructive",
      });
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the link and copy it manually.",
        variant: "destructive",
      });
    }
  }

  function parseEmailInput(value: string): string[] {
    // Comma- or newline-separated, matching the placeholder copy.
    // `dedupeEmails` is the same de-dup the server runs in
    // `InviteService.createWithEmails`, shared via @repo/validation so the
    // two runtimes' notion of "how many unique addresses" can't drift apart.
    return dedupeEmails(value.split(/[,\n]/));
  }

  async function sendEmailInvites() {
    const emails = parseEmailInput(emailInput);
    if (emails.length === 0) return;

    const parsed = EmailInviteSchema.safeParse({ role: INVITE_ROLE, emails });
    if (!parsed.success) {
      toast({
        title: "Check the email addresses",
        description:
          "One or more addresses look invalid, or the list has more than 50.",
        variant: "destructive",
      });
      return;
    }

    setEmailStatus("sending");
    try {
      const result = await emailInvites.mutateAsync({
        role: INVITE_ROLE,
        emails,
      });
      const failed =
        result && typeof result === "object" && "failed" in result
          ? ((result as { failed?: string[] }).failed ?? [])
          : [];
      const invites =
        result && typeof result === "object" && "invites" in result
          ? ((result as { invites?: unknown[] }).invites ?? [])
          : [];
      setEmailFailures(failed);
      setEmailSentCount(invites.length - failed.length);
      setEmailStatus("sent");
      setEmailInput("");
      if (failed.length === 0 && invites.length > 0) {
        toast({
          title: "Invites sent",
          description: `Emailed ${invites.length} invite${invites.length === 1 ? "" : "s"}.`,
        });
      }
    } catch (error) {
      setEmailStatus("idle");
      toast({
        title: "Unable to send invites",
        description: getErrorMessage(error, "Please try again in a moment."),
        variant: "destructive",
      });
    }
  }

  function finish() {
    onComplete();
    router.replace(POST_CREATE_PATH);
    router.refresh();
  }

  return (
    // Radix Dialog gives us focus trap, initial-focus, focus restore on close,
    // and an inert (aria-hidden) background for free. Escape and outside
    // interaction stay suppressed so a first officer cannot abandon mid-create
    // by accident. Invited members leave on the find step via "I have an
    // invite" → `/join` (the overlay lives in DashboardShell and does not
    // mount on that route).
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 overflow-y-auto bg-background focus:outline-none"
        >
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-8 sm:px-6 sm:py-12">
            <header className="mb-6">
              {/*
                No glyph. This read `<Sparkles className="text-primary" />`,
                and `components.md` §11 reserves ✦ for the Ask entry point —
                it "MUST NOT mark anything that is not an Ask/AI entry point".
                The label already names the intent, which is how the points
                adjustment dialog resolved the same question
                (`iconography.md` §6.2.3).

                `EYEBROW` rather than `font-mono text-xs`: foundations §7
                reserves mono for numeric, status and code-like strings, and 12
                is off the type scale — the recipe is 12.5/600 tracked out.
              */}
              <p className={cn(EYEBROW, "text-muted-foreground")}>
                Set up your chapter
              </p>
              <DialogPrimitive.Title asChild>
                <h1
                  id="chapter-wizard-title"
                  className="mt-1 text-2xl font-semibold tracking-tight"
                >
                  {STEP_LABELS[step]}
                </h1>
              </DialogPrimitive.Title>
              <StepDots
                current={stepIndex}
                total={STEP_ORDER.length}
                className="mt-4"
              />
            </header>

            <main className="flex-1">
              {step === "find" ? (
                <FindStep
                  rawQuery={rawQuery}
                  onQueryChange={setRawQuery}
                  isFetching={searchQuery.isFetching}
                  isError={searchQuery.isError}
                  onRetry={() => searchQuery.refetch()}
                  results={results}
                  debouncedQuery={debouncedQuery}
                  onSelect={applyDirectoryMatch}
                  onManual={startManualEntry}
                />
              ) : null}

              {step === "archetype" ? (
                <ArchetypeStep selected={archetype} onSelect={setArchetype} />
              ) : null}

              {step === "identity" ? (
                <IdentityStep
                  identity={identity}
                  onChange={setIdentity}
                  logo={logo}
                  onLogoChange={setLogo}
                  isManual={directoryId === null}
                  accepted={acceptedLegal}
                  onAcceptedChange={setAcceptedLegal}
                />
              ) : null}

              {step === "invite" ? (
                <InviteStep
                  inviteLink={inviteLink}
                  copied={copied}
                  isGenerating={createInvite.isPending}
                  onGenerate={generateInviteLink}
                  onCopy={copyInviteLink}
                  emailInput={emailInput}
                  onEmailInputChange={setEmailInput}
                  emailStatus={emailStatus}
                  emailFailures={emailFailures}
                  emailSentCount={emailSentCount}
                  onSendEmails={sendEmailInvites}
                />
              ) : null}
            </main>

            <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
              {step === "find" ? (
                <Button variant="ghost" onClick={() => router.push("/join")}>
                  I have an invite
                </Button>
              ) : step !== "invite" ? (
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              ) : (
                <span />
              )}

              {step === "archetype" ? (
                <Button onClick={() => setStep("identity")}>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : null}

              {step === "identity" ? (
                <Button
                  onClick={submitChapter}
                  disabled={!canSubmit || onboardChapter.isPending}
                >
                  {onboardChapter.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Create chapter
                </Button>
              ) : null}

              {step === "invite" ? (
                <Button onClick={finish}>
                  {inviteLink || emailSentCount > 0 ? "Finish" : "Skip for now"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : null}
            </footer>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FindStep({
  rawQuery,
  onQueryChange,
  isFetching,
  isError,
  onRetry,
  results,
  debouncedQuery,
  onSelect,
  onManual,
}: {
  rawQuery: string;
  onQueryChange: (value: string) => void;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  results: ChapterDirectoryResult[];
  debouncedQuery: string;
  onSelect: (row: ChapterDirectoryResult) => void;
  onManual: () => void;
}) {
  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length >= DIRECTORY_MIN_QUERY_LENGTH;
  const showEmpty = hasQuery && !isFetching && !isError && results.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Search the Greek-life directory by chapter letters, organization, or
        school. We&apos;ll pre-fill the rest.
      </p>

      {/*
        These four states stay inline rather than taking
        `components/shared/nested-states.tsx`, which is §4's "strong reason to
        diverge" and is worth recording: this is a *third* container for the
        state family, after a screen and a card. `CommandList` is a bordered
        `max-h-72` scroll region whose own rows are two-line list items, so a
        `min-h-40` bordered box inside it is a box in a box — the shape §10
        already rules out one step up, met from a new direction. The states
        take the list's row geometry instead, and the input stays mounted
        through all four so a query is never interrupted mid-type.
      */}
      <Command shouldFilter={false} className="rounded-lg border border-border">
        <CommandInput
          value={rawQuery}
          onValueChange={onQueryChange}
          placeholder="e.g. Sigma Phi Epsilon, ΣΦΕ, or UCLA"
          aria-label="Search the chapter directory"
        />
        <CommandList className="max-h-72">
          {!hasQuery ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Type at least {DIRECTORY_MIN_QUERY_LENGTH} characters to search.
            </p>
          ) : null}

          {hasQuery && isFetching ? (
            <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching the directory…
            </p>
          ) : null}

          {hasQuery && isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm font-bold text-foreground">
                Couldn&apos;t reach the directory
              </p>
              <p className="text-sm text-muted-foreground">
                Retry the search, or enter your chapter&apos;s details by hand.
              </p>
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry search
              </Button>
            </div>
          ) : null}

          {showEmpty ? (
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
              <SearchGlyph className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t find{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{trimmed}&rdquo;
                </span>{" "}
                in our directory.
              </p>
              <Button variant="secondary" size="sm" onClick={onManual}>
                <PencilLine className="h-4 w-4" />
                Enter chapter details manually
              </Button>
            </div>
          ) : null}

          {!isFetching && !isError
            ? results.map((row) => (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  onSelect={() => onSelect(row)}
                  className="flex-col items-start gap-0.5 py-2"
                >
                  <span className="font-medium">
                    {row.org_letters ? `${row.org_letters} · ` : ""}
                    {row.org_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[row.chapter_designation, row.university]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </CommandItem>
              ))
            : null}
        </CommandList>
      </Command>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
        <div>
          <p className="text-sm font-medium">Not in our directory?</p>
          <p className="text-xs text-muted-foreground">
            New colony or a small org? Enter your details by hand.
          </p>
        </div>
        <Button variant="secondary" onClick={onManual}>
          <PencilLine className="h-4 w-4" />
          Manual entry
        </Button>
      </div>
    </div>
  );
}

function ArchetypeStep({
  selected,
  onSelect,
}: {
  selected: ArchetypeKey;
  onSelect: (key: ArchetypeKey) => void;
}) {
  const archetypes = useMemo(() => Object.values(ARCHETYPES), []);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your archetype sets sensible defaults for modules, roles, and
        vocabulary. You can fine-tune everything later in Settings.
      </p>
      <div
        role="radiogroup"
        aria-label="Chapter archetype"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {archetypes.map((archetype) => {
          const isActive = archetype.key === selected;
          return (
            <button
              key={archetype.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onSelect(archetype.key)}
              /*
                Three fixes in one class string.

                **The selection did not render.** `bg-primary/5` is a raw
                opacity wash of the chapter hex, which
                `spec/ui/design-system/README.md` §2 bans outright — and at 5%
                it measures 1.075:1 against the overlay's `--background`, so
                the state it was expressing was invisible. The recipe is §5's
                two card-seated accent states, which the Settings archetype
                grid already took in the #920 Settings & Roles slice. Note the
                measurement does **not** carry over from that guard: that grid
                sits on `--card` and this overlay is `--background`, so
                `profile-contrast.spec.ts` measures the pair again here.

                **The hover was a colour washed over itself.** `--accent` held
                `--popover`'s value (the alias is deleted, #3036), so
                `hover:bg-accent/50` was 1.000:1 — invisible rather than dim,
                the defect `components/shared/elevation-contrast.spec.ts`
                records.

                **There was no visible focus indicator**, which is a §6
                release-gate failure rather than a repaint nit. `focus.ts`
                records that "the ring alone does not carry the indicator" —
                `--ring` at 25% composites to ~1.3:1 — and it is the border
                going solid accent that makes focus visible. This had the ring
                and not the border swap. `FOCUS_RING` is the whole recipe.
              */
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3 text-left transition",
                FOCUS_RING,
                isActive
                  ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                  : "border-border hover:bg-accent-subtle",
              )}
            >
              {/*
                `font-mono text-[0.65rem]` was 10.4px and off foundations §7's
                locked scale, on a council abbreviation that is a label rather
                than a machine value. `EYEBROW` is the recipe.
              */}
              <span className={cn(EYEBROW, "text-muted-foreground")}>
                {archetype.short}
              </span>
              <span className="text-sm font-semibold">{archetype.label}</span>
              <span className="text-xs text-muted-foreground">
                {archetype.council}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IdentityStep({
  identity,
  onChange,
  logo,
  onLogoChange,
  isManual,
  accepted,
  onAcceptedChange,
}: {
  identity: ChapterIdentityForm;
  onChange: (next: ChapterIdentityForm) => void;
  logo: ChapterLogoUpload | null;
  onLogoChange: (next: ChapterLogoUpload | null) => void;
  isManual: boolean;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
}) {
  function set<K extends keyof ChapterIdentityForm>(
    key: K,
    value: ChapterIdentityForm[K],
  ) {
    onChange({ ...identity, [key]: value });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {isManual
          ? "Tell us about your chapter. We'll add it to our directory backlog so the next officer finds it."
          : "Confirm your chapter details. Everything is editable."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wiz-name">Chapter / organization name</Label>
          <Input
            id="wiz-name"
            value={identity.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Sigma Phi Epsilon"
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wiz-university">University</Label>
          <Input
            id="wiz-university"
            value={identity.university}
            onChange={(e) => set("university", e.target.value)}
            placeholder="University of California, Los Angeles"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-letters">Greek letters</Label>
          <Input
            id="wiz-letters"
            value={identity.greekLetters}
            onChange={(e) => set("greekLetters", e.target.value)}
            placeholder="ΣΦΕ"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-designation">Chapter designation</Label>
          <Input
            id="wiz-designation"
            value={identity.designation}
            onChange={(e) => set("designation", e.target.value)}
            placeholder="California Eta"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-school-short">School short name</Label>
          <Input
            id="wiz-school-short"
            value={identity.schoolShort}
            onChange={(e) => set("schoolShort", e.target.value)}
            placeholder="UCLA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-founded">Founded year</Label>
          <Input
            id="wiz-founded"
            type="number"
            inputMode="numeric"
            min={FOUNDED_YEAR_MIN}
            max={latestFoundedYear()}
            value={identity.foundedYear}
            onChange={(e) => set("foundedYear", e.target.value)}
            placeholder="1948"
          />
        </div>
        <ChapterMarkFields
          identity={identity}
          onSet={set}
          logo={logo}
          onLogoChange={onLogoChange}
        />
        {/*
          Spans the pair so the grid does not end on a ragged half-row. The
          identity step had six single-column fields — three even pairs — until
          the #920 slice-9 cutover removed the second brand colour; five would
          leave this one alone beside an empty cell at `sm:` and above.
        */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wiz-color-accent">Accent color</Label>
          <div className="flex items-center gap-2">
            <input
              id="wiz-color-accent"
              type="color"
              value={identity.colorAccent}
              onChange={(e) => set("colorAccent", e.target.value)}
              // 36px was under §2's 44px floor on a control that is nothing but
              // a tap target. `rounded` already maps to `--radius` (12) via the
              // preset's `DEFAULT`; spelled `rounded-md` so the radius step is
              // named rather than inherited.
              className="h-11 w-14 cursor-pointer rounded-md border border-border bg-background"
              aria-label="Accent color"
            />
            <span className="font-mono text-caption text-muted-foreground">
              {identity.colorAccent.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/*
        The officer's acceptance, for the chapter and for themselves (#2302).
        The web dashboard keeps Backwork (#2258), so its FERPA note stays here,
        beside the checkbox rather than inside what the officer agrees to.
      */}
      <div className="space-y-2">
        <TermsAcceptance
          id="wiz-accept-legal"
          accepted={accepted}
          onAcceptedChange={onAcceptedChange}
        />
        <p className="text-xs text-muted-foreground">
          Member-uploaded Backwork is shared voluntarily. See our{" "}
          <a
            href={FERPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            FERPA notice
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function InviteStep({
  inviteLink,
  copied,
  isGenerating,
  onGenerate,
  onCopy,
  emailInput,
  onEmailInputChange,
  emailStatus,
  emailFailures,
  emailSentCount,
  onSendEmails,
}: {
  inviteLink: string | null;
  copied: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  emailInput: string;
  onEmailInputChange: (value: string) => void;
  emailStatus: "idle" | "sending" | "sent";
  emailFailures: string[];
  emailSentCount: number;
  onSendEmails: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Share a join link so your chapter can hop into{" "}
        <span className="font-medium text-foreground">#general</span>. This step
        is optional. You can always invite members later.
      </p>

      {inviteLink ? (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <Label htmlFor="wiz-invite-link">Your chapter invite link</Label>
          <div className="flex items-center gap-2">
            {/* foundations §7 names invite tokens in the reserved mono list. */}
            <Input
              id="wiz-invite-link"
              readOnly
              className="font-mono"
              value={inviteLink}
            />
            <Button
              variant="secondary"
              onClick={onCopy}
              aria-label="Copy invite link"
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with this link can join as a member. Revoke it anytime from
            Members.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-border p-4">
        <Label htmlFor="wiz-invite-emails">Or invite by email</Label>
        <Textarea
          id="wiz-invite-emails"
          placeholder="name@example.com, another@example.com"
          value={emailInput}
          onChange={(event) => onEmailInputChange(event.target.value)}
          disabled={emailStatus === "sending"}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Separate addresses with commas or new lines. Up to 50 at a time.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={onSendEmails}
            disabled={
              emailStatus === "sending" || emailInput.trim().length === 0
            }
          >
            {emailStatus === "sending" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Send invites
          </Button>
        </div>

        {emailStatus === "sent" &&
        emailFailures.length === 0 &&
        emailSentCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Sent {emailSentCount} invite{emailSentCount === 1 ? "" : "s"}.
          </p>
        ) : null}

        {emailFailures.length > 0 ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold text-destructive-text">
              {emailFailures.length} invite
              {emailFailures.length === 1 ? "" : "s"} could not be emailed
            </p>
            <p className="mt-1 text-muted-foreground">
              Their invite links were still created. Share the link above, or
              retry these addresses.
            </p>
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
              {emailFailures.slice(0, 20).map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Frapp collects pseudonymous usage analytics (on by default) to fix bugs
        and improve the product. It never collects message content. You can turn
        it off anytime in Settings → Privacy.
      </p>

      {!inviteLink ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Generate a one-tap invite link to drop in your group chat.
          </p>
          <Button onClick={onGenerate} disabled={isGenerating}>
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Generate invite link
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The chapter mark step (#2876): what stands for the chapter in the nav, in
 * the order `resolveChapterMark` reads it. It sits in the identity step rather
 * than a step of its own because the directory autofill has already filled the
 * Greek letters here, and a chapter that doesn't show them (FIJI's custom)
 * needs to say so beside them, before they reach the nav and the welcome
 * message.
 */
function ChapterMarkFields({
  identity,
  onSet,
  logo,
  onLogoChange,
}: {
  identity: ChapterIdentityForm;
  onSet: <K extends keyof ChapterIdentityForm>(
    key: K,
    value: ChapterIdentityForm[K],
  ) => void;
  logo: ChapterLogoUpload | null;
  onLogoChange: (next: ChapterLogoUpload | null) => void;
}) {
  const [logoError, setLogoError] = useState<string | null>(null);
  // Cleared with the queued logo: an input still holding the file would show
  // its name while nothing is queued, and re-choosing the same file would fire
  // no change event, so the chapter would be created without it.
  const logoInput = useRef<HTMLInputElement>(null);
  // The preview's object URL is created and revoked by one effect, so each
  // URL is released exactly when the file it points at is replaced. A memo
  // paired with a cleanup effect would revoke the URL under Strict Mode's
  // mount-unmount-mount and leave the preview on a dead blob.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external resource this effect owns
      setLogoUrl(null);
      return;
    }
    const url = URL.createObjectURL(logo.body);
    setLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);
  const branding = {
    short_name: identity.shortName,
    greek_letters: identity.greekLetters,
    show_greek_letters: identity.showGreekLetters,
  };
  const mark = resolveChapterMark({ logoUrl, branding, name: identity.name });

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">Chapter mark</legend>
      <div className="flex items-center gap-3">
        <CrestTile mark={mark} />
        <p className="text-xs text-muted-foreground">
          How your chapter shows in the nav: your logo, else your short name,
          else your Greek letters.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-short-name">Short name (optional)</Label>
          <Input
            id="wiz-short-name"
            value={identity.shortName}
            onChange={(e) => onSet("shortName", e.target.value)}
            maxLength={CHAPTER_SHORT_NAME_MAX_LENGTH}
            placeholder="FIJI"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-logo">Logo (optional)</Label>
          <div className="flex items-center gap-2">
            <Input
              ref={logoInput}
              id="wiz-logo"
              type="file"
              accept={acceptAttribute("image")}
              aria-describedby={logoError ? "wiz-logo-error" : undefined}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const inspected = inspectLogoFile(file);
                if (!inspected.ok) {
                  setLogoError(inspected.message);
                  e.target.value = "";
                  return;
                }
                setLogoError(null);
                onLogoChange(inspected.upload);
              }}
            />
            {logo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (logoInput.current) logoInput.current.value = "";
                  onLogoChange(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          {logoError ? (
            <p id="wiz-logo-error" className="text-xs text-destructive">
              {logoError}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="wiz-show-letters" className="font-normal">
          Show Greek letters
          <span className="block text-xs text-muted-foreground">
            Turn off if your organization doesn&apos;t display its letters.
          </span>
        </Label>
        <Switch
          id="wiz-show-letters"
          checked={identity.showGreekLetters}
          onCheckedChange={(checked) => onSet("showGreekLetters", checked)}
        />
      </div>
    </fieldset>
  );
}
