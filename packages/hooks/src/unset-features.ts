"use client";

import { useMemo } from "react";
import { can } from "@repo/validation";
import { useGeofences } from "./use-study";
import { useDocuments } from "./use-documents";

/**
 * Features a member isn't sent to until an officer sets them up
 * (`spec/product/modules.md` § Not-set-up features).
 *
 * A chapter with no study zones has a Study hours page that can only say so,
 * and a chapter with no documents has a Documents page that can only say so.
 * Neither is something a member can fix, so the web nav and the mobile More
 * tab leave the row out for them until the first zone or document exists.
 * Whoever can make that first item still sees the row, because for them the
 * page is where the setup happens (and the officer setup checklist on Chat
 * home points them there).
 *
 * Backwork is not here: members upload it themselves (`backwork:upload` is in
 * the Member and New Member roles), so an empty library is theirs to start,
 * and hiding it would hide the only way to add the first file.
 *
 * Every gate here fails open, as the nav's other gates do: nothing hides while
 * permissions, the chapter's modules or the list are still loading, or after
 * the list's read fails. Only a read that answers "none" hides a row.
 */
export type UnsetFeatureKey = "study" | "documents";

interface UnsetFeatureDefinition {
  /** Holding this means the viewer makes the first item, so always sees it. */
  setUpBy: string;
  /**
   * The module the list's read is gated on. While it is off the list can't
   * be read and nothing in it can be made, so it counts as empty.
   */
  module: string;
}

export const UNSET_FEATURES: Readonly<
  Record<UnsetFeatureKey, UnsetFeatureDefinition>
> = {
  // Study hours needs a zone to study in; officers add them on the web.
  study: { setUpBy: "geofences:manage", module: "geofences" },
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
    !can(UNSET_FEATURES[key].setUpBy, permissions)
  );
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
 * when the viewer can't set it up. Officers who can set both up read nothing.
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
  const zoneCount = lengthOf(zones.data);
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
