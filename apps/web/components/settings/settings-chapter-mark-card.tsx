"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ChapterLogoUpload } from "@repo/hooks";
import {
  CHAPTER_SHORT_NAME_MAX_LENGTH,
  acceptAttribute,
  greekLettersShown,
  resolveChapterMark,
  type PatchChapterConfig,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CrestTile } from "@/components/layout/crest-tile";
import { inspectLogoFile } from "@/lib/chapter-logo";

export type ChapterMarkBrandingDraft = {
  short_name?: string;
  greek_letters?: string;
  show_greek_letters?: boolean;
};

type Props = {
  /** Chapter name, for the initials the mark falls back to. */
  name: string;
  /** Signed `logo_url` from `GET /v1/chapters/current`, or null. */
  logoUrl: string | null;
  branding: ChapterMarkBrandingDraft;
  /**
   * `CHAPTER_PROFILE_PERMISSIONS`: the logo routes guard on it, like the
   * profile PATCH (#2575).
   */
  canEditLogo: boolean;
  /** `chapter-config:manage`: the short name and opt-out go through the config PATCH. */
  canManage: boolean;
  onUploadLogo: (upload: ChapterLogoUpload) => Promise<void>;
  onRemoveLogo: () => Promise<void>;
  logoPending?: boolean;
  onPatchConfig: (diff: PatchChapterConfig) => Promise<void> | void;
  savingConfig?: boolean;
  /** The permission line the tab shows under a form the caller can't save. */
  manageHint: React.ReactNode;
  profileHint: React.ReactNode;
};

/**
 * Settings → Chapter → Chapter mark (#2876, #2591): what stands for the
 * chapter in the nav's chapter tile and on mobile Chat home's title row.
 *
 * Two writes with two gates, because they are two routes. The logo uploads
 * the moment a file is chosen (mint, PUT, confirm; `useUploadChapterLogo`),
 * gated like the profile PATCH. The short name and the Greek-letters switch
 * save through the audited config PATCH, gated on `chapter-config:manage`
 * like the identity card below it. Greek letters themselves stay in that
 * card: they are identity data a chapter may keep while not showing them.
 *
 * The preview is the nav's own tile, fed the draft, so what an officer sees
 * here is what every member's nav will show once it saves.
 */
export function SettingsChapterMarkCard({
  name,
  logoUrl,
  branding,
  canEditLogo,
  canManage,
  onUploadLogo,
  onRemoveLogo,
  logoPending,
  onPatchConfig,
  savingConfig,
  manageHint,
  profileHint,
}: Props) {
  const [shortName, setShortName] = useState(branding.short_name ?? "");
  const [showLetters, setShowLetters] = useState(greekLettersShown(branding));
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const logoErrorId = useId();

  // Keyed on the stored values, not the `branding` object, which the page
  // rebuilds on every render: an object dependency re-seeded on any re-render,
  // a logo upload starting included, and wiped unsaved edits.
  /* eslint-disable react-hooks/set-state-in-effect -- re-seed the drafts from the chapter config query */
  useEffect(() => {
    setShortName(branding.short_name ?? "");
    setShowLetters(greekLettersShown(branding));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the two stored values are the dependency; see above
  }, [branding.short_name, branding.show_greek_letters]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const draft = {
    short_name: shortName,
    greek_letters: branding.greek_letters,
    show_greek_letters: showLetters,
  };
  const mark = resolveChapterMark({ logoUrl, branding: draft, name });

  async function pickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change.
    event.target.value = "";
    if (!file) return;
    const inspected = inspectLogoFile(file);
    if (!inspected.ok) {
      setLogoError(inspected.message);
      return;
    }
    setLogoError(null);
    await onUploadLogo(inspected.upload);
  }

  function saveMark(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = shortName.trim();
    const brandingDiff: ChapterMarkBrandingDraft = {
      show_greek_letters: showLetters,
    };
    // The config PATCH deep-merges, so leaving the key out keeps a stored
    // short name. An empty string is how a cleared field is removed.
    if (trimmed || branding.short_name) brandingDiff.short_name = trimmed;
    void onPatchConfig({ branding: brandingDiff });
  }

  const logoDisabled = !canEditLogo || logoPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chapter mark</CardTitle>
        <CardDescription>
          What stands for your chapter in the nav and at the top of the mobile
          app&apos;s Chat home: your logo if you upload one, otherwise your short name, otherwise your
          Greek letters. Some organizations don&apos;t display their letters;
          turn them off and they appear nowhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <CrestTile mark={mark} />
          <span className="text-sm font-bold text-foreground">{name}</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="chapter-logo">Logo</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              id="chapter-logo"
              type="file"
              accept={acceptAttribute("image")}
              className="sr-only"
              disabled={logoDisabled}
              aria-describedby={logoError ? logoErrorId : undefined}
              onChange={(event) => void pickLogo(event)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={logoDisabled}
              onClick={() => fileInput.current?.click()}
            >
              {logoPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={logoDisabled}
                onClick={() => {
                  setLogoError(null);
                  void onRemoveLogo();
                }}
              >
                Remove logo
              </Button>
            ) : null}
          </div>
          {logoError ? (
            <p id={logoErrorId} className="text-xs text-destructive">
              {logoError}
            </p>
          ) : null}
          {profileHint}
        </div>

        <form
          onSubmit={saveMark}
          className="space-y-4 border-t border-border pt-4"
        >
          <div className="grid gap-1 md:max-w-xs">
            <Label htmlFor="chapter-short-name">Short name</Label>
            <Input
              id="chapter-short-name"
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              maxLength={CHAPTER_SHORT_NAME_MAX_LENGTH}
              placeholder="FIJI"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="chapter-show-letters" className="font-normal">
              Show Greek letters
              <span className="block text-xs text-muted-foreground">
                Off hides them wherever Frapp would show them. The letters
                stay saved under Identity &amp; founding.
              </span>
            </Label>
            <Switch
              id="chapter-show-letters"
              checked={showLetters}
              onCheckedChange={setShowLetters}
              disabled={!canManage}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            {manageHint ?? <span />}
            <Button type="submit" disabled={!canManage || savingConfig}>
              {savingConfig ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Save mark
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
