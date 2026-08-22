"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ARCHETYPES,
  VOCABULARY_DEFAULTS,
  getArchetype,
  type ArchetypeKey,
} from "@repo/org-archetypes";
import type { PatchChapterConfig } from "@repo/validation";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

type Branding = {
  greek_letters?: string;
  designation?: string;
  school_short?: string;
  founded_at?: number;
};

type Props = {
  /** Current `org_archetype`; rendered through `getArchetype()` so an unknown
   * or in-flight value falls back to `ifc` instead of crashing. */
  archetypeKey: string;
  /** Merged vocabulary (archetype defaults + chapter overrides). */
  vocabulary: Record<string, string>;
  branding: Branding;
  profile: { name: string; university: string; donation_url: string };
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** Persist the core chapter profile (name/university/donation). */
  onSaveProfile: (profile: {
    name: string;
    university: string;
    donation_url: string;
  }) => Promise<void> | void;
  /** Persist a config diff (branding / archetype / vocabulary) through PATCH. */
  onPatchConfig: (diff: PatchChapterConfig) => Promise<void> | void;
  savingProfile?: boolean;
  savingConfig?: boolean;
};

const NOW_YEAR = new Date().getFullYear();

export function SettingsOrgTab({
  archetypeKey,
  vocabulary,
  branding,
  profile,
  canManage,
  onSaveProfile,
  onPatchConfig,
  savingProfile,
  savingConfig,
}: Props) {
  const current = getArchetype(archetypeKey);

  const [profileDraft, setProfileDraft] = useState(profile);
  const [greekLetters, setGreekLetters] = useState(branding.greek_letters ?? "");
  const [designation, setDesignation] = useState(branding.designation ?? "");
  const [schoolShort, setSchoolShort] = useState(branding.school_short ?? "");
  const [foundedYear, setFoundedYear] = useState(
    branding.founded_at != null ? String(branding.founded_at) : "",
  );
  const [recruitment, setRecruitment] = useState(vocabulary.recruitment ?? "");
  const [pledge, setPledge] = useState(vocabulary.pledge ?? "");
  const [cohort, setCohort] = useState(vocabulary.class ?? "");
  const [pendingArchetype, setPendingArchetype] = useState<ArchetypeKey | null>(
    null,
  );

  // Re-sync drafts whenever the server config changes (e.g. after an archetype
  // switch resets vocabulary, or another officer edits the chapter).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed profile draft from the chapter config query
    setProfileDraft(profile);
  }, [profile]);
  /* eslint-disable react-hooks/set-state-in-effect -- re-seed branding fields from the chapter config query */
  useEffect(() => {
    setGreekLetters(branding.greek_letters ?? "");
    setDesignation(branding.designation ?? "");
    setSchoolShort(branding.school_short ?? "");
    setFoundedYear(branding.founded_at != null ? String(branding.founded_at) : "");
  }, [branding]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- re-seed vocabulary drafts from the chapter config query */
  useEffect(() => {
    setRecruitment(vocabulary.recruitment ?? "");
    setPledge(vocabulary.pledge ?? "");
    setCohort(vocabulary.class ?? "");
  }, [vocabulary]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const foundedTrimmed = foundedYear.trim();
  const foundedNum = foundedTrimmed
    ? Number.parseInt(foundedTrimmed, 10)
    : undefined;
  const foundedValid =
    foundedTrimmed === "" ||
    (Number.isInteger(foundedNum) &&
      (foundedNum as number) >= 1776 &&
      (foundedNum as number) <= NOW_YEAR + 1);

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSaveProfile({
      name: profileDraft.name,
      university: profileDraft.university,
      donation_url: profileDraft.donation_url,
    });
  }

  function saveIdentity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!foundedValid) return;
    const brandingDiff: Branding = {};
    if (greekLetters.trim()) brandingDiff.greek_letters = greekLetters.trim();
    if (designation.trim()) brandingDiff.designation = designation.trim();
    if (schoolShort.trim()) brandingDiff.school_short = schoolShort.trim();
    if (foundedTrimmed && foundedValid) brandingDiff.founded_at = foundedNum;
    void onPatchConfig({ branding: brandingDiff });
  }

  function saveVocabulary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vocab: Record<string, string> = {};
    if (recruitment.trim()) vocab.recruitment = recruitment.trim();
    if (pledge.trim()) vocab.pledge = pledge.trim();
    if (cohort.trim()) vocab.class = cohort.trim();
    void onPatchConfig({ vocabulary: vocab });
  }

  function confirmArchetypeSwitch() {
    if (!pendingArchetype) return;
    const next = getArchetype(pendingArchetype);
    // Reset modules + vocabulary to the new archetype's defaults; the role pack
    // follows `org_archetype` server-side. Identity/branding are preserved.
    void onPatchConfig({
      org_archetype: next.key,
      vocabulary: { ...VOCABULARY_DEFAULTS[next.key] },
      enabled_modules: { ...next.modules },
    });
    setPendingArchetype(null);
  }

  const manageHint = canManage ? null : (
    <p className="text-xs text-muted-foreground">
      Editing chapter settings requires the{" "}
      {/*
        `--secondary` aliases `--card` and this sits in a `CardContent`, so
        `bg-secondary` here was 1.000:1 — a chip with no chip. `--surface-1` is
        the step *below* the card, which is what §4 already specifies for an
        input fill inside a card, and a recess cannot invert the way a raised
        step can.
      */}
      <code className="rounded bg-surface-1 px-1 py-0.5">
        chapter-config:manage
      </code>{" "}
      permission.
    </p>
  );

  return (
    <div className="space-y-6">
      {/* Chapter profile (core chapter record) */}
      <Card>
        <CardHeader>
          <CardTitle>Chapter profile</CardTitle>
          <CardDescription>
            Name and university appear across the dashboard, reports, and
            member-facing screens.
          </CardDescription>
        </CardHeader>
        <form onSubmit={saveProfile}>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="chapter-name">Chapter name</Label>
                <Input
                  id="chapter-name"
                  value={profileDraft.name}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
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
                  value={profileDraft.university}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
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
                value={profileDraft.donation_url}
                onChange={(event) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    donation_url: event.target.value,
                  }))
                }
                placeholder="https://give.youruniversity.edu/..."
              />
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3">
            {manageHint ?? <span />}
            <Button type="submit" disabled={!canManage || savingProfile}>
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save profile
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Identity & founding (branding config — audited) */}
      <Card>
        <CardHeader>
          <CardTitle>Identity &amp; founding</CardTitle>
          <CardDescription>
            Greek letters and designation show in the sidebar chapter lockup.
            Saving writes an entry to the chapter audit log.
          </CardDescription>
        </CardHeader>
        <form onSubmit={saveIdentity}>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="greek-letters">Greek letters</Label>
                <Input
                  id="greek-letters"
                  value={greekLetters}
                  onChange={(event) => setGreekLetters(event.target.value)}
                  maxLength={8}
                  placeholder="ΣΦΕ"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="designation">Chapter designation</Label>
                <Input
                  id="designation"
                  value={designation}
                  onChange={(event) => setDesignation(event.target.value)}
                  placeholder="California Eta"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="school-short">School (short)</Label>
                <Input
                  id="school-short"
                  value={schoolShort}
                  onChange={(event) => setSchoolShort(event.target.value)}
                  placeholder="UCLA"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="founded-year">Founded year</Label>
                <Input
                  id="founded-year"
                  type="number"
                  inputMode="numeric"
                  value={foundedYear}
                  onChange={(event) => setFoundedYear(event.target.value)}
                  placeholder="1901"
                  aria-invalid={!foundedValid}
                />
                {!foundedValid ? (
                  <p className="text-xs text-destructive">
                    Enter a year between 1776 and {NOW_YEAR + 1}.
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3">
            {manageHint ?? <span />}
            <Button
              type="submit"
              disabled={!canManage || savingConfig || !foundedValid}
            >
              {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save identity
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Archetype */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Organization archetype
            <span className="rounded-xs border border-border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {current.short}
            </span>
          </CardTitle>
          <CardDescription>
            {current.description} Sets defaults for modules, role pack, and
            vocabulary.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.values(ARCHETYPES).map((option) => {
              const isCurrent = option.key === current.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={!canManage || isCurrent}
                  aria-pressed={isCurrent}
                  onClick={() => setPendingArchetype(option.key)}
                  /*
                    The other direction of the accent sweep. This selection is
                    accent-worthy — §5 names active filters, and a chosen
                    archetype is the same shape as `/documents`' selected
                    folder — but `bg-primary/5` was a raw opacity wash of the
                    chapter hex, which README §2 bans outright, and at 5% it
                    was invisible besides. The recipe is §2's two card-seated
                    states, the one `shared/table-contrast.test.ts` pins:
                    hover `accent-3`, selected `accent-4` plus `accent-11`
                    text. `border-primary/40` on hover went with it — the
                    border swap is `FOCUS_RING`'s job, and using it for hover
                    too left focus and hover indistinguishable on a card.
                  */
                  className={cn(
                    "flex flex-col gap-1 rounded-md border p-3 text-left transition-colors",
                    FOCUS_RING,
                    isCurrent
                      ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                      : "border-border hover:bg-accent-subtle",
                    !canManage && !isCurrent && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {option.short}
                    </span>
                    {isCurrent ? (
                      // `accent-11` rather than `--primary`: the fill under it
                      // is `accent-4`, and §1's ladder puts the readable tone
                      // at 11. It also inherits from the button above, so this
                      // states the weight and lets the colour come from one
                      // place.
                      <span className="text-[11px] font-medium">Current</span>
                    ) : null}
                  </span>
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
          {manageHint ? <div className="mt-3">{manageHint}</div> : null}
        </CardContent>
      </Card>

      {/* Vocabulary */}
      <Card>
        <CardHeader>
          <CardTitle>Vocabulary</CardTitle>
          <CardDescription>
            Tailor the words your chapter uses. Defaults follow the{" "}
            {current.short} archetype.
          </CardDescription>
        </CardHeader>
        <form onSubmit={saveVocabulary}>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="vocab-recruitment">Recruitment process</Label>
              <Input
                id="vocab-recruitment"
                value={recruitment}
                onChange={(event) => setRecruitment(event.target.value)}
                placeholder={current.recruitmentLanguage}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="vocab-pledge">New member term</Label>
              <Input
                id="vocab-pledge"
                value={pledge}
                onChange={(event) => setPledge(event.target.value)}
                placeholder={current.pledgeLanguage}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="vocab-class">Cohort label</Label>
              <Input
                id="vocab-class"
                value={cohort}
                onChange={(event) => setCohort(event.target.value)}
                placeholder={current.classLanguage}
              />
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3">
            {manageHint ?? <span />}
            <Button type="submit" disabled={!canManage || savingConfig}>
              {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save vocabulary
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Archetype-change confirmation */}
      <Dialog
        open={pendingArchetype !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchetype(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Switch to {pendingArchetype ? getArchetype(pendingArchetype).label : ""}?
            </DialogTitle>
            <DialogDescription>
              This resets modules, the role pack, and vocabulary to{" "}
              {pendingArchetype ? getArchetype(pendingArchetype).short : ""}{" "}
              defaults. Your chapter identity, branding, and custom fields are
              kept. An entry is written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingArchetype(null)}>
              Cancel
            </Button>
            <Button onClick={confirmArchetypeSwitch} disabled={savingConfig}>
              {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Switch archetype
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
