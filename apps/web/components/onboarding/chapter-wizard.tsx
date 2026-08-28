"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  PencilLine,
} from "lucide-react";
import {
  ARCHETYPES,
  getArchetype,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import {
  DIRECTORY_MIN_QUERY_LENGTH,
  useAccessibleChapters,
  useChapterDirectorySearch,
  useCreateInvite,
  useOnboardChapter,
  type ChapterDirectoryResult,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { StepDots } from "@/components/onboarding/step-dots";
import { SearchGlyph } from "@/components/profile/profile-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { useToast } from "@/hooks/use-toast";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { asArray, cn, getErrorMessage } from "@/lib/utils";

const CHAT_LANDING_PATH = "/chat?channel=general";
// Legal pages (Terms / Privacy / FERPA) live on the marketing site and are linked
// from the onboarding consent step (spec/behavior/legal.md). Override per-env with
// NEXT_PUBLIC_LANDING_URL; default to production so the links always resolve.
const LEGAL_BASE_URL =
  process.env.NEXT_PUBLIC_LANDING_URL ?? "https://frapp.live";
const DEFAULT_ACCENT = "#F2B72E";
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const INVITE_ROLE = "Member";

type WizardStep = "find" | "archetype" | "identity" | "invite";
const STEP_ORDER: WizardStep[] = ["find", "archetype", "identity", "invite"];
const STEP_LABELS: Record<WizardStep, string> = {
  find: "Find your chapter",
  archetype: "Pick your archetype",
  identity: "Confirm identity",
  invite: "Invite members",
};

type IdentityForm = {
  name: string;
  university: string;
  greekLetters: string;
  designation: string;
  schoolShort: string;
  foundedYear: string;
  colorAccent: string;
};

const EMPTY_IDENTITY: IdentityForm = {
  name: "",
  university: "",
  greekLetters: "",
  designation: "",
  schoolShort: "",
  foundedYear: "",
  colorAccent: DEFAULT_ACCENT,
};

function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX6.test(withHash) ? withHash : fallback;
}

/** Guard-parse a founded-year input. Returns a finite year >= 1776 or undefined. */
function parseFoundedYear(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1776 || parsed > 9999) return undefined;
  return parsed;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * First-officer onboarding wizard (Chunk 03). Fires when a signed-in user has
 * no chapters. Turns "I just signed up" into "I'm in #general with my chapter
 * set up": directory autofill → archetype → identity → invite, then routes to
 * /chat?channel=general. All writes go through the cold-path onboarding
 * endpoint — never the chat Edge Functions.
 */
export function ChapterWizardGate() {
  const chaptersQuery = useAccessibleChapters();
  const [open, setOpen] = useState(false);

  const memberships = asArray<unknown>(chaptersQuery.data);
  // Trigger: the user has zero chapter memberships. Once opened, the wizard
  // owns its own lifecycle (the membership count flips to 1 mid-flow after the
  // chapter is created), so we never auto-close it from here.
  const hasNoChapters = chaptersQuery.isSuccess && memberships.length === 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch the wizard open; auto-close on membership flip would unmount an in-progress create
    if (hasNoChapters) setOpen(true);
  }, [hasNoChapters]);

  if (!open) return null;
  return <ChapterWizard onComplete={() => setOpen(false)} />;
}

export function ChapterWizard({ onComplete }: { onComplete: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const selectChapter = useSelectChapter();

  const onboardChapter = useOnboardChapter();
  const createInvite = useCreateInvite();

  const [step, setStep] = useState<WizardStep>("find");
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery, 250);

  const [directoryId, setDirectoryId] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<ArchetypeKey>("ifc");
  const [identity, setIdentity] = useState<IdentityForm>(EMPTY_IDENTITY);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

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
      designation: row.chapter_designation ?? "",
      schoolShort: row.university_short ?? "",
      foundedYear: row.founded_year ? String(row.founded_year) : "",
      colorAccent: normalizeHex(row.default_colors?.accent, DEFAULT_ACCENT),
    });
    // A different chapter identity invalidates any prior consent — re-affirm.
    setAcceptedLegal(false);
    setStep("archetype");
  }

  function startManualEntry() {
    setDirectoryId(null);
    setArchetype("ifc");
    setIdentity({
      ...EMPTY_IDENTITY,
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

  const identityValid =
    identity.name.trim().length >= 3 && identity.university.trim().length >= 2;
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
        branding: {
          greek_letters: identity.greekLetters.trim() || undefined,
          designation: identity.designation.trim() || undefined,
          school_short: identity.schoolShort.trim() || undefined,
          founded_at: parseFoundedYear(identity.foundedYear),
          colors: {
            accent: normalizeHex(identity.colorAccent, DEFAULT_ACCENT),
          },
        },
      });
      const id =
        chapter && typeof chapter === "object" && "id" in chapter
          ? (chapter as { id?: string }).id ?? null
          : null;
      if (id) await selectChapter(id);
      toast({
        title: "Chapter created",
        description: "Your chapter is set up. Invite your members to start chatting.",
      });
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
          ? (invite as { token?: string }).token ?? null
          : null;
      if (!token) throw new Error("Invite did not return a token.");
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(`${origin}/join?token=${encodeURIComponent(token)}`);
    } catch (error) {
      toast({
        title: "Unable to create invite link",
        description: getErrorMessage(error, "You can invite members later from Members."),
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

  function finish() {
    onComplete();
    router.replace(CHAT_LANDING_PATH);
    router.refresh();
  }

  return (
    // Radix Dialog gives us focus trap, initial-focus, focus restore on close,
    // and an inert (aria-hidden) background for free. The flow is intentionally
    // non-dismissable — a user with no chapter must finish setup — so Escape and
    // outside interaction are suppressed and no close button is rendered.
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
                />
              ) : null}
            </main>

            <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
              {step !== "find" && step !== "invite" ? (
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
                <Button onClick={submitChapter} disabled={!canSubmit || onboardChapter.isPending}>
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
                  {inviteLink ? "Finish" : "Skip for now"}
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
            New colony or a small org — enter your details by hand.
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
                `profile-contrast.test.ts` measures the pair again here.

                **The hover was a colour washed over itself.** `--accent` holds
                `--popover`'s value, so `hover:bg-accent/50` was 1.000:1 —
                invisible rather than dim, the alias
                `components/shared/elevation-contrast.test.ts` exists to catch.

                **There was no visible focus indicator**, which is a §6
                release-gate failure rather than a repaint nit. `focus.ts`
                records that "the ring alone does not carry the indicator" —
                `--ring` at 25% composites to ~1.3:1 — and it is the border
                going solid accent that makes focus visible. This had the ring
                and not the border swap. `FOCUS_RING` is the whole recipe.
                (Importing it is not touching the primitive #1215 is filed
                against; that issue is about `FOCUS_RING_OFFSET`.)
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
  isManual,
  accepted,
  onAcceptedChange,
}: {
  identity: IdentityForm;
  onChange: (next: IdentityForm) => void;
  isManual: boolean;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
}) {
  function set<K extends keyof IdentityForm>(key: K, value: IdentityForm[K]) {
    onChange({ ...identity, [key]: value });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {isManual
          ? "Tell us about your chapter. We'll add it to our directory backlog so the next officer finds it."
          : "Confirm your chapter details — everything is editable."}
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
            min={1776}
            max={9999}
            value={identity.foundedYear}
            onChange={(e) => set("foundedYear", e.target.value)}
            placeholder="1948"
          />
        </div>
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
            <span className="font-mono text-[12.5px] text-muted-foreground">
              {identity.colorAccent.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          id="wiz-accept-legal"
          checked={accepted}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          className={cn(dashboardTableCheckboxClassName, "mt-0.5")}
        />
        {/*
          Deliberately not wrapped in `dashboardCheckboxHitAreaClassName`.
          That recipe is an implicit `<label>` for a row-select checkbox that
          has no other label; this control has an explicit multi-line `<Label
          htmlFor>` beside it, so its tappable area already far exceeds §2's
          44px floor — and adding the wrapper would give one input two labels,
          trading a floor it already clears for an accessibility regression.
        */}
        <Label
          htmlFor="wiz-accept-legal"
          className="text-sm font-normal leading-snug text-muted-foreground"
        >
          I agree to the{" "}
          <a
            href={`${LEGAL_BASE_URL}/terms`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href={`${LEGAL_BASE_URL}/privacy`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Privacy Policy
          </a>
          . Member-uploaded Backwork is shared voluntarily — see our{" "}
          <a
            href={`${LEGAL_BASE_URL}/ferpa`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            FERPA notice
          </a>
          .
        </Label>
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
}: {
  inviteLink: string | null;
  copied: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Share a join link so your chapter can hop into{" "}
        <span className="font-medium text-foreground">#general</span>. This step
        is optional — you can always invite members later.
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
            <Button variant="secondary" onClick={onCopy} aria-label="Copy invite link">
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

      <p className="text-xs text-muted-foreground">
        Frapp collects pseudonymous usage analytics (on by default) to fix bugs
        and improve the product — never message content. You can turn it off
        anytime in Settings → Privacy.
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
