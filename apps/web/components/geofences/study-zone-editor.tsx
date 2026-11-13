"use client";

import { useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCreateGeofence, useUpdateGeofence } from "@repo/hooks";
import { useKeptFormDraft } from "@repo/hooks/kept-drafts";
import { KeptDraftNote } from "@/components/shared/kept-draft-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import {
  cn,
  getErrorMessage,
  guardIntDraft,
  parseGuardedInt,
} from "@/lib/utils";
import { ZonePicker } from "@/components/geofences/zone-picker";
import {
  draftFromZone,
  emptyZoneDraft,
  zoneShapeBody,
  type ZoneDraft,
} from "@/components/geofences/zone-shape";

export type StudyZone = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number }[] | null;
  circle?: unknown;
  is_active: boolean;
  minutes_per_point: number;
  points_per_interval: number;
  min_session_minutes: number;
  pause_grace_minutes: number;
};

type RuleKey =
  | "minutes_per_point"
  | "points_per_interval"
  | "min_session_minutes"
  | "pause_grace_minutes";

/** Each rate's floor, from the API's `@Min` on the study-zone DTOs. */
const RULE_MIN: Record<RuleKey, number> = {
  minutes_per_point: 1,
  points_per_interval: 1,
  min_session_minutes: 0,
  pause_grace_minutes: 1,
};

const RULE_DEFAULTS: Record<RuleKey, string> = {
  minutes_per_point: "30",
  points_per_interval: "1",
  min_session_minutes: "15",
  pause_grace_minutes: "5",
};

/** Read as a sentence: "1 point every 30 minutes". */
const RULES: readonly { key: RuleKey; label: string; hint?: string }[] = [
  { key: "points_per_interval", label: "Points" },
  { key: "minutes_per_point", label: "Every (minutes)" },
  {
    key: "min_session_minutes",
    label: "Shortest session (minutes)",
    hint: "Shorter sessions earn nothing.",
  },
  {
    key: "pause_grace_minutes",
    label: "Pause grace (minutes)",
    hint: "How long a session can sit in the background before it ends.",
  },
];

/** Whether the officer left the zone's shape as it opened. */
function sameShape(a: ZoneDraft, b: ZoneDraft): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode === "circle"
    ? a.radius_m === b.radius_m &&
        a.center?.lat === b.center?.lat &&
        a.center?.lng === b.center?.lng
    : JSON.stringify(a.points) === JSON.stringify(b.points);
}

/** One zone's kept draft (`@repo/hooks/kept-drafts`, #4593); null is New. */
export function zoneDraftName(zoneId: string | null): string {
  return zoneId ? `study-zone-edit:${zoneId}` : "study-zone-create";
}

type ZoneFields = {
  name: string;
  shape: ZoneDraft;
  rules: Record<RuleKey, string>;
};

/** What is kept: the fields, and for an edit the zone as it opened. */
type ZoneFormDraft = ZoneFields & { base: ZoneFields | null };

function fieldsOf(zone: StudyZone | null): ZoneFields {
  return {
    name: zone?.name ?? "",
    shape: zone ? draftFromZone(zone) : emptyZoneDraft(),
    rules: zone
      ? {
          minutes_per_point: String(zone.minutes_per_point ?? 30),
          points_per_interval: String(zone.points_per_interval ?? 1),
          min_session_minutes: String(zone.min_session_minutes ?? 15),
          pause_grace_minutes: String(zone.pause_grace_minutes ?? 5),
        }
      : RULE_DEFAULTS,
  };
}

/**
 * An edit's kept draft laid over the zone as it is now: only what the officer
 * changed from the zone they opened, so another officer's change to the rest
 * isn't undone (the Events editor's `keepEditsOver`).
 */
function keepZoneEditsOver(kept: ZoneFormDraft, now: ZoneFields): ZoneFields {
  const base = kept.base;
  if (!base) return { name: kept.name, shape: kept.shape, rules: kept.rules };
  const rules = { ...now.rules };
  for (const key of Object.keys(RULE_MIN) as RuleKey[]) {
    if (kept.rules[key] !== base.rules[key]) rules[key] = kept.rules[key];
  }
  return {
    name: kept.name !== base.name ? kept.name : now.name,
    shape: sameShape(kept.shape, base.shape) ? now.shape : kept.shape,
    rules,
  };
}

function parseRules(
  draft: Record<RuleKey, string>,
): Record<RuleKey, number> | null {
  const rules = {} as Record<RuleKey, number>;
  for (const key of Object.keys(RULE_MIN) as RuleKey[]) {
    const value = parseGuardedInt(draft[key], RULE_MIN[key]);
    if (value === undefined) return null;
    rules[key] = value;
  }
  return rules;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The zone being edited, or null for a new one. */
  zone: StudyZone | null;
  /** Every zone the chapter has, drawn faintly behind the one being drawn. */
  zones: readonly StudyZone[];
  campus?: string | null;
  gate: SubscriptionGate;
  contentProps?: { onCloseAutoFocus?: (event: Event) => void };
};

/**
 * New and Edit study zone, one form: where the zone is (the map), what it is
 * called, and what studying in it earns.
 *
 * Docked (panel.tsx): it takes the place of Chapter settings with a back
 * arrow, so the map gets the page's width instead of a 576px sheet, and the
 * officer comes back to the zone list they left.
 *
 * Going back or leaving the page keeps the draft (#4593), per zone, and it
 * opens on it next time, saying so; an edit's draft keeps only what the
 * officer changed. Cancel and saving give it up.
 */
export function StudyZoneEditor({
  open,
  onOpenChange,
  zone,
  zones,
  campus,
  gate,
  contentProps,
}: Props) {
  const { toast } = useToast();
  const createZone = useCreateGeofence();
  const updateZone = useUpdateGeofence();
  const pending = createZone.isPending || updateZone.isPending;
  const nameId = useId();

  const [name, setName] = useState("");
  const [shape, setShape] = useState<ZoneDraft>(emptyZoneDraft);
  // The shape as it opened, so a rename or a rate change leaves the stored
  // shape exactly as it was instead of redrawing it from the draft.
  const [openedShape, setOpenedShape] = useState<ZoneDraft | null>(null);
  const [rules, setRules] = useState<Record<RuleKey, string>>(RULE_DEFAULTS);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  // The zone as this editor opened on it, kept with an edit's draft.
  const [openedBase, setOpenedBase] = useState<ZoneFields | null>(null);
  const kept = useKeptFormDraft<ZoneFormDraft>(
    zoneDraftName(zone?.id ?? null),
    open,
    { name, shape, rules, base: openedBase },
    { signature: JSON.stringify([name, shape, rules]) },
  );

  /** Fill the form: the kept draft over the zone, or the zone (or a blank). */
  function fill(draft: ZoneFormDraft | undefined) {
    const opened = fieldsOf(zone);
    const fields = draft ? keepZoneEditsOver(draft, opened) : opened;
    setName(fields.name);
    setShape(fields.shape);
    setRules(fields.rules);
    setOpenedShape(zone ? opened.shape : null);
    setOpenedBase(zone ? opened : null);
    setShapeError(null);
    setRulesError(null);
  }

  // Each time it opens: the kept draft, else the zone's own values or a blank
  // new one. Keyed by the zone's id, not the object, so a refetch while the
  // officer is editing doesn't wipe what they've changed.
  const formKey = open ? (zone?.id ?? "new") : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (formKey !== loadedKey) {
    setLoadedKey(formKey);
    if (formKey) fill(kept.take());
  }

  /** Cancel: give the draft up and close. */
  function cancel() {
    kept.drop();
    onOpenChange(false);
  }

  /** Discard: start over from the zone as it is now, or a blank one. */
  function discard() {
    kept.discard();
    fill(undefined);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shapeBody =
      openedShape && sameShape(shape, openedShape)
        ? ({ ok: true, body: {} } as const)
        : zoneShapeBody(shape);
    const parsedRules = parseRules(rules);
    setShapeError(shapeBody.ok ? null : shapeBody.error);
    setRulesError(
      parsedRules
        ? null
        : "Each needs a whole number of 1 or more. The shortest session can be 0.",
    );
    if (!shapeBody.ok || !parsedRules) return;
    const trimmed = name.trim();
    kept.hold();
    try {
      if (zone) {
        await updateZone.mutateAsync({
          id: zone.id,
          body: { name: trimmed, ...shapeBody.body, ...parsedRules },
        });
        toast({ title: "Study zone saved", description: `${trimmed} saved.` });
      } else {
        await createZone.mutateAsync({
          name: trimmed,
          is_active: true,
          ...shapeBody.body,
          ...parsedRules,
        });
        toast({
          title: "Study zone created",
          description: `Members can study at ${trimmed} now.`,
        });
      }
      kept.drop();
      onOpenChange(false);
    } catch (error) {
      kept.release();
      toast({
        title: zone ? "Couldn't save study zone" : "Couldn't create study zone",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  // Memoized: the map re-tiles the other zones whenever this changes.
  const zoneId = zone?.id;
  const others = useMemo(
    () =>
      zones
        .filter((other) => other.id !== zoneId)
        .map((other) => ({ id: other.id, coordinates: other.coordinates })),
    [zones, zoneId],
  );

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      docked
      backLabel="Back to Study zones"
    >
      <PanelContent aria-describedby={undefined} {...contentProps}>
        <PanelHeader>{zone ? `Edit ${zone.name}` : "New study zone"}</PanelHeader>
        <PanelBody
          as="form"
          id="study-zone-form"
          onSubmit={submit}
          // The full column, not the docked panel's centred width: from
          // `@4xl` the form and the map sit side by side.
          className="@container px-5 pt-4"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 @4xl:flex-row">
            <div className="flex shrink-0 flex-col gap-4 @4xl:w-[300px]">
              <div className="grid gap-1">
                <Label htmlFor={nameId}>Name</Label>
                <Input
                  id={nameId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Main library"
                  maxLength={120}
                  required
                />
              </div>
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="col-span-2 mb-1 text-sm font-semibold text-foreground">
                  What studying here earns
                </legend>
                {RULES.map((rule) => (
                  <div
                    key={rule.key}
                    className={cn(
                      "grid content-start gap-1",
                      rule.hint && "col-span-2",
                    )}
                  >
                    <Label htmlFor={`${nameId}-${rule.key}`}>{rule.label}</Label>
                    <Input
                      id={`${nameId}-${rule.key}`}
                      type="number"
                      min={RULE_MIN[rule.key]}
                      value={rules[rule.key]}
                      aria-invalid={rulesError ? true : undefined}
                      onChange={(event) => {
                        const next = guardIntDraft(event.target.value);
                        if (next === undefined) return;
                        setRules((prev) => ({ ...prev, [rule.key]: next }));
                      }}
                    />
                    {rule.hint ? (
                      <p className="text-caption text-muted-foreground">
                        {rule.hint}
                      </p>
                    ) : null}
                  </div>
                ))}
                {rulesError ? (
                  <p
                    role="alert"
                    className="col-span-2 text-caption text-destructive"
                  >
                    {rulesError}
                  </p>
                ) : null}
              </fieldset>
            </div>
            <div className="flex min-h-[440px] min-w-0 flex-1 flex-col">
              <ZonePicker
                draft={shape}
                onChange={(next) => {
                  setShape(next);
                  if (shapeError && zoneShapeBody(next).ok) setShapeError(null);
                }}
                otherZones={others}
                campus={campus}
                error={shapeError}
                onPlacePicked={(place) => {
                  if (!name.trim()) setName(place.name);
                }}
              />
            </div>
          </div>
        </PanelBody>
        <PanelFooter className="px-5">
          {kept.restored ? <KeptDraftNote onDiscard={discard} /> : null}
          <Button
            type="button"
            variant="secondary"
            onClick={cancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            form="study-zone-form"
            type="submit"
            {...gate.controlProps(pending)}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {zone ? "Save changes" : "Create study zone"}
          </Button>
        </PanelFooter>
      </PanelContent>
    </Panel>
  );
}
