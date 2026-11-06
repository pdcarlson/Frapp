"use client";

import { useMemo } from "react";
import { can } from "@repo/validation";
import { useGeofences } from "./use-study";
import { useDocuments } from "./use-documents";

/**
 * Features a member isn't sent to until an officer sets them up
 * (`spec/product/modules.md` § Not-set-up features).
 *
 * A chapter with no active study zones has a Study hours page that can only
 * say so, and a chapter with no documents has a Documents page that can only
 * say so. Neither is something a member can fix, so the web nav, the mobile
 * More tab and the web Ask popover leave it out until the first zone or
 * document exists.
 *
 * Documents stays for whoever can upload, because its page is where the
 * upload happens. Study hours hides from everyone: zones are made in the web
 * app's Study zones tool, which neither Study page links to, so an officer
 * would land on the same dead end (the officer setup checklist on Chat home
 * opens the zones tool instead).
 *
 * Backwork is not here: members upload it themselves (`backwork:upload` is in
 * the Member and New Member roles), so an empty library is theirs to start,
 * and hiding it would hide the only way to add the first file.
 *
 * Nothing hides while permissions, the chapter's modules or the list are
 * still loading, or after the list's read fails. A row hides on a read that
 * answers "none", or on the list's module being off, since then nothing can
 * be in it (and the read would be refused).
 */
export type UnsetFeatureKey = "study" | "documents";

interface UnsetFeatureDefinition {
  /**
   * Holding this means the viewer makes the first item on the feature's own
   * page, so always sees it. Null when the page has no way to set it up, so
   * it hides from everyone.
   */
  setUpBy: string | null;
  /**
   * The module the list's read is gated on. While it is off the list can't
   * be read and nothing in it can be made, so it counts as empty.
   */
  module: string;
}

export const UNSET_FEATURES: Readonly<
  Record<UnsetFeatureKey, UnsetFeatureDefinition>
> = {
  // Study hours needs an active zone to study in, made in the web zones tool.
  study: { setUpBy: null, module: "geofences" },
  documents: { setUpBy: "chapter_docs:upload", module: "documents" },
};

const UNSET_FEATURE_KEYS = Object.keys(UNSET_FEATURES) as UnsetFeatureKey[];

export interface UnsetFeatureInput {
  /** Undefined or null while the viewer's permissions load. */
  permissions: readonly string[] | null | undefined;
  /** The chapter's module gate; undefined while the chapter read loads. */
  isModuleEnabled: ((moduleKey: string) => boolean) | undefined;
  /**
   * How many items each feature's list holds for the viewer. Undefined while
   * the list loads, after its read fails, or when it was never read.
   */
  counts: Partial<Record<UnsetFeatureKey, number | undefined>>;
}

/** Whether the viewer is one the feature could be hidden from, as far as is known yet. */
function canHide(
  key: UnsetFeatureKey,
  permissions: UnsetFeatureInput["permissions"],
  isModuleEnabled: UnsetFeatureInput["isModuleEnabled"],
): isModuleEnabled is (moduleKey: string) => boolean {
  return (
    permissions !== undefined &&
    permissions !== null &&
    isModuleEnabled !== undefined &&
    !canSetUp(key, permissions)
  );
}

function canSetUp(key: UnsetFeatureKey, permissions: readonly string[]) {
  const setUpBy = UNSET_FEATURES[key].setUpBy;
  return setUpBy !== null && can(setUpBy, permissions);
}

/** Whether a feature's list has to be read to decide: the viewer can't set it up, and its module is on. */
export function needsUnsetFeatureRead(
  key: UnsetFeatureKey,
  permissions: UnsetFeatureInput["permissions"],
  isModuleEnabled: UnsetFeatureInput["isModuleEnabled"],
): boolean {
  return (
    canHide(key, permissions, isModuleEnabled) &&
    isModuleEnabled(UNSET_FEATURES[key].module)
  );
}

/** Undefined while a list loads and after its read fails: either way, hide nothing. */
function lengthOf(data: unknown): number | undefined {
  return Array.isArray(data) ? data.length : undefined;
}

/**
 * Only active zones count: both Study pages list just those, and a zone with
 * sessions can't be deleted, so a chapter done with zones deactivates them.
 */
export function activeZoneCount(data: unknown): number | undefined {
  return Array.isArray(data)
    ? data.filter(
        (zone) => (zone as { is_active?: unknown })?.is_active !== false,
      ).length
    : undefined;
}

/** The features to leave out for this viewer. */
export function selectHiddenUnsetFeatures({
  permissions,
  isModuleEnabled,
  counts,
}: UnsetFeatureInput): ReadonlySet<UnsetFeatureKey> {
  const hidden = new Set<UnsetFeatureKey>();
  for (const key of UNSET_FEATURE_KEYS) {
    if (!canHide(key, permissions, isModuleEnabled)) continue;
    const count = isModuleEnabled(UNSET_FEATURES[key].module)
      ? counts[key]
      : 0;
    if (count === 0) hidden.add(key);
  }
  return hidden;
}

/**
 * The features to leave out for this viewer, reading a feature's list only
 * when the viewer can't set it up and its module is on.
 * The reads share their cache with the Study and Documents screens.
 */
export function useHiddenUnsetFeatures(
  permissions: UnsetFeatureInput["permissions"],
  isModuleEnabled: UnsetFeatureInput["isModuleEnabled"],
): ReadonlySet<UnsetFeatureKey> {
  const zones = useGeofences({
    enabled: needsUnsetFeatureRead("study", permissions, isModuleEnabled),
  });
  const documents = useDocuments({
    enabled: needsUnsetFeatureRead("documents", permissions, isModuleEnabled),
  });
  const zoneCount = activeZoneCount(zones.data);
  const documentCount = lengthOf(documents.data);
  return useMemo(
    () =>
      selectHiddenUnsetFeatures({
        permissions,
        isModuleEnabled,
        counts: { study: zoneCount, documents: documentCount },
      }),
    [permissions, isModuleEnabled, zoneCount, documentCount],
  );
}
