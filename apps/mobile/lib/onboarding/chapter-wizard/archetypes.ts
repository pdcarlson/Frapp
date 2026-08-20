/**
 * Slim archetype catalog for the mobile first-officer wizard.
 *
 * Keys, labels, shorts, and councils match `packages/org-archetypes/src/index.ts`.
 * The full seed (modules, role packs) is applied server-side from the key —
 * mobile `package.json` is frozen, so this screen cannot depend on
 * `@repo/org-archetypes` until an integrator PR declares it.
 */

export const CHAPTER_ARCHETYPE_KEYS = [
  "ifc",
  "npc",
  "nphc",
  "mgc",
  "professional",
  "service",
  "honor",
  "colony",
] as const;

export type ChapterArchetypeKey = (typeof CHAPTER_ARCHETYPE_KEYS)[number];

export type ChapterArchetype = {
  key: ChapterArchetypeKey;
  label: string;
  short: string;
  council: string;
};

export const CHAPTER_ARCHETYPES: readonly ChapterArchetype[] = [
  {
    key: "ifc",
    label: "IFC Fraternity",
    short: "IFC",
    council: "Interfraternity Council",
  },
  {
    key: "npc",
    label: "NPC Sorority",
    short: "NPC",
    council: "Panhellenic Council",
  },
  {
    key: "nphc",
    label: "NPHC / Divine Nine",
    short: "NPHC",
    council: "National Pan-Hellenic Council",
  },
  {
    key: "mgc",
    label: "Multicultural Greek",
    short: "MGC",
    council: "Multicultural Greek Council",
  },
  {
    key: "professional",
    label: "Professional Fraternity",
    short: "Pro",
    council: "Professional Fraternity Association",
  },
  {
    key: "service",
    label: "Co-ed Service Fraternity",
    short: "Svc",
    council: "Service Fraternity",
  },
  {
    key: "honor",
    label: "Honor Society",
    short: "Honor",
    council: "Association of College Honor Societies",
  },
  {
    key: "colony",
    label: "Colony / Interest Group",
    short: "Colony",
    council: "—",
  },
];

const KEYS = new Set<string>(CHAPTER_ARCHETYPE_KEYS);

export function resolveArchetypeKey(
  raw: string | null | undefined,
): ChapterArchetypeKey {
  if (raw && KEYS.has(raw)) return raw as ChapterArchetypeKey;
  return "ifc";
}
