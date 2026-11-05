/**
 * Per-organization facts that hold for every chapter of a national
 * organization, keyed by the organization's name exactly as
 * `chapter_directory.org_name` stores it ("Phi Gamma Delta").
 *
 * Keyed by name, never by Greek letters: some organizations do not display
 * their letters at all (Phi Gamma Delta), so nothing that looks a profile up
 * should have to read or print them (`spec/behavior/branding.md`
 * § Chapter mark).
 *
 * ## Colors
 *
 * `colors` are the organization's official colors, in the organization's own
 * order, offered as accent swatches when a chapter picks its accent. Each is a
 * seed for the accent engine (`spec/ui/design-system/accent-engine.md`), which
 * derives the shades that actually paint, so a swatch needs to be the right
 * color, not an exact brand match.
 *
 * None of these values is verified. An unmarked hex is what web search
 * results quoted from the organization's brand guide or Pantone code (converted
 * to sRGB); nobody opened the brand documents themselves, because the sandbox
 * that gathered them could not reach the organizations' sites. Where only a
 * color name turned up, the hex is a conventional rendering of the name,
 * marked `// by name`. A chapter that knows better should say so, and the
 * entry should change (2026-11-04).
 *
 * Left out on purpose: white, cream, pearl, argent and black. As an accent seed
 * on Signet's dark surfaces, white and cream read as plain text and black is
 * lifted to a gray, so none looks like the organization's color. Cream is also
 * what the beta chapter was wrongly painted (the directory's `#C9A56F`).
 */

export interface OrgColor {
  /** The organization's own name for the color, shown under its swatch. */
  name: string;
  /** `#RRGGBB`, uppercase. */
  hex: string;
}

export interface OrgProfile {
  /**
   * `false` when the organization does not display its Greek letters (its
   * chapters use a short name or logo instead). Absent means it does.
   */
  displaysGreekLetters?: false;
  /** The short name the organization's chapters go by, when it has one. */
  shortName?: string;
  /** Official colors, most prominent first. */
  colors?: readonly OrgColor[];
}

function profile(p: OrgProfile): Readonly<OrgProfile> {
  return Object.freeze({
    ...p,
    colors: p.colors
      ? Object.freeze(p.colors.map((c) => Object.freeze({ ...c })))
      : undefined,
  });
}

export const ORG_PROFILES: Readonly<Record<string, Readonly<OrgProfile>>> =
  Object.freeze({
    // ── IFC ────────────────────────────────────────────────────────────────
    "Sigma Phi Epsilon": profile({
      colors: [
        { name: "Red", hex: "#DA291C" },
        { name: "Purple", hex: "#8031A7" },
        { name: "Gold", hex: "#AC8400" },
      ],
    }),
    "Pi Kappa Alpha": profile({
      colors: [
        { name: "Garnet", hex: "#79242F" },
        { name: "Old Gold", hex: "#9E8959" },
      ],
    }),
    "Sigma Alpha Epsilon": profile({
      colors: [
        { name: "Royal Purple", hex: "#6A498E" },
        { name: "Old Gold", hex: "#F4BD1D" },
      ],
    }),
    "Phi Delta Theta": profile({
      colors: [
        { name: "Azure", hex: "#619CC7" },
        { name: "Navy", hex: "#0D1433" },
      ],
    }),
    "Kappa Alpha Order": profile({
      colors: [
        { name: "Crimson", hex: "#BE2F37" },
        { name: "Old Gold", hex: "#C19709" },
      ],
    }),
    "Alpha Tau Omega": profile({
      colors: [
        { name: "Azure", hex: "#1E64B4" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Phi Kappa Psi": profile({
      colors: [
        { name: "Cardinal Red", hex: "#A6192E" },
        { name: "Hunter Green", hex: "#006341" },
      ],
    }),
    "Beta Theta Pi": profile({
      colors: [
        { name: "Blue", hex: "#4A7CC0" }, // by name
        { name: "Pink", hex: "#E8A0B8" }, // by name
      ],
    }),
    "Delta Tau Delta": profile({
      colors: [
        { name: "Purple", hex: "#5B2C83" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Lambda Chi Alpha": profile({
      colors: [
        { name: "Purple", hex: "#2E1A4B" },
        { name: "Green", hex: "#093D20" },
        { name: "Gold", hex: "#FFB71D" },
      ],
    }),
    "Alpha Epsilon Pi": profile({
      colors: [
        { name: "Blue", hex: "#1D428A" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Alpha Chi Rho": profile({
      colors: [{ name: "Garnet", hex: "#7A1F2B" }], // by name
    }),
    "Sigma Nu": profile({
      colors: [{ name: "Gold", hex: "#C9A227" }], // by name
    }),
    "Phi Gamma Delta": profile({
      // FIJI chapters never display "ΦΓΔ" (owner, 2026-09-29 and 2026-11-04).
      displaysGreekLetters: false,
      shortName: "FIJI",
      colors: [{ name: "Royal Purple", hex: "#4F2683" }], // by name
    }),
    "Theta Chi": profile({
      colors: [{ name: "Military Red", hex: "#A6192E" }], // by name
    }),
    "Theta Delta Chi": profile({
      colors: [{ name: "Blue", hex: "#1D4F91" }], // by name
    }),

    // ── NPHC ───────────────────────────────────────────────────────────────
    "Alpha Phi Alpha": profile({
      colors: [{ name: "Old Gold", hex: "#B8860B" }],
    }),
    "Omega Psi Phi": profile({
      colors: [
        { name: "Royal Purple", hex: "#6D2077" },
        { name: "Old Gold", hex: "#B7A57A" },
      ],
    }),
    "Kappa Alpha Psi": profile({
      colors: [{ name: "Crimson", hex: "#70110C" }],
    }),
    "Phi Beta Sigma": profile({
      colors: [{ name: "Royal Blue", hex: "#164F90" }],
    }),
    "Iota Phi Theta": profile({
      colors: [
        { name: "Charcoal Brown", hex: "#4A3C31" }, // by name
        { name: "Gilded Gold", hex: "#C5A048" }, // by name
      ],
    }),
    "Alpha Kappa Alpha": profile({
      colors: [
        { name: "Salmon Pink", hex: "#F3B0B1" },
        { name: "Apple Green", hex: "#A8DA61" },
      ],
    }),
    "Delta Sigma Theta": profile({
      colors: [
        { name: "Crimson", hex: "#A6192E" }, // by name
      ],
    }),
    "Zeta Phi Beta": profile({
      colors: [{ name: "Royal Blue", hex: "#1E4FA3" }], // by name
    }),
    "Sigma Gamma Rho": profile({
      colors: [
        { name: "Royal Blue", hex: "#2041A5" },
        { name: "Gold", hex: "#D0A215" },
      ],
    }),

    // ── NPC ────────────────────────────────────────────────────────────────
    "Delta Delta Delta": profile({
      colors: [
        { name: "Cerulean Blue", hex: "#2A7AB8" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
        { name: "Silver", hex: "#A7A9AC" }, // by name
      ],
    }),
    "Alpha Phi": profile({
      colors: [
        { name: "Bordeaux", hex: "#6D1A36" }, // by name
        { name: "Silver", hex: "#A7A9AC" }, // by name
      ],
    }),
    "Chi Omega": profile({
      colors: [
        { name: "Cardinal", hex: "#A6192E" }, // by name
        { name: "Straw", hex: "#E4C77A" }, // by name
      ],
    }),
    "Pi Beta Phi": profile({
      colors: [
        { name: "Wine", hex: "#861F41" },
        { name: "Silver Blue", hex: "#34657F" },
      ],
    }),
    "Alpha Delta Pi": profile({
      colors: [
        { name: "Azure Blue", hex: "#0071CE" },
        { name: "Adelphean Blue", hex: "#65B2E8" },
        { name: "Midnight", hex: "#002D5D" },
      ],
    }),
    "Gamma Phi Beta": profile({
      colors: [
        { name: "Dark Brown", hex: "#4E3629" }, // by name
        { name: "Light Brown", hex: "#A47E5B" }, // by name
        { name: "Pink", hex: "#E9A6B6" }, // by name
      ],
    }),
    "Alpha Sigma Alpha": profile({
      colors: [
        { name: "Crimson", hex: "#A6192E" }, // by name
        { name: "Palm Green", hex: "#3A7D44" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Phi Mu": profile({
      colors: [{ name: "Rose", hex: "#D51A68" }],
    }),
    "Alpha Xi Delta": profile({
      colors: [
        { name: "Dark Blue", hex: "#1D3F7A" }, // by name
        { name: "Light Blue", hex: "#7FB2E5" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Delta Zeta": profile({
      colors: [
        { name: "Rose", hex: "#9B5E9C" },
        { name: "Green", hex: "#7A9A01" },
      ],
    }),
    "Sigma Delta Tau": profile({
      colors: [
        { name: "Old Blue", hex: "#5B7DA8" }, // by name
        { name: "Café au Lait", hex: "#A67B5B" }, // by name
      ],
    }),
    "Alpha Omicron Pi": profile({
      colors: [{ name: "Cardinal Red", hex: "#C22032" }],
    }),
    "Kappa Delta": profile({
      colors: [{ name: "Olive Green", hex: "#5E6B2E" }], // by name
    }),
    "Sigma Kappa": profile({
      colors: [
        { name: "Maroon", hex: "#7A2232" }, // by name
        { name: "Lavender", hex: "#9D8AC7" }, // by name
      ],
    }),
    "Alpha Gamma Delta": profile({
      colors: [
        { name: "Red", hex: "#C8102E" }, // by name
        { name: "Buff", hex: "#D8C3A5" }, // by name
        { name: "Green", hex: "#2E6B3A" }, // by name
      ],
    }),

    // ── MGC ────────────────────────────────────────────────────────────────
    "Lambda Theta Alpha": profile({
      colors: [
        { name: "Burgundy", hex: "#7B1E3A" }, // by name
        { name: "Gray", hex: "#8A8D8F" }, // by name
      ],
    }),
    "Lambda Upsilon Lambda": profile({
      colors: [
        { name: "Brown", hex: "#5C3A21" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
        { name: "Red", hex: "#B3202A" }, // by name
      ],
    }),
    "Alpha Kappa Delta Phi": profile({
      colors: [{ name: "Purple", hex: "#5B2C83" }], // by name
    }),

    // ── Honor and professional ─────────────────────────────────────────────
    "Tau Beta Pi": profile({
      colors: [{ name: "Seal Brown", hex: "#59260B" }], // by name
    }),
    "Phi Beta Kappa": profile({
      colors: [
        { name: "Blue", hex: "#3B6AA8" }, // by name
        { name: "Pink", hex: "#E8A0B8" }, // by name
      ],
    }),
    "Pi Tau Sigma": profile({
      colors: [
        { name: "Azure", hex: "#1E64B4" }, // by name
        { name: "Murrey", hex: "#8B1E4B" }, // by name
      ],
    }),
    "Theta Tau": profile({
      colors: [
        { name: "Dark Red", hex: "#8B0000" }, // by name
        { name: "Gold", hex: "#C9A227" }, // by name
      ],
    }),
    "Alpha Omega": profile({
      colors: [{ name: "Gold", hex: "#C9A227" }], // by name
    }),
    "Delta Sigma Pi": profile({
      colors: [
        { name: "Royal Purple", hex: "#330066" },
        { name: "Old Gold", hex: "#F7B910" },
      ],
    }),
    "Alpha Chi Sigma": profile({
      colors: [
        { name: "Prussian Blue", hex: "#005695" },
        { name: "Chrome Yellow", hex: "#FFDD00" },
      ],
    }),
  });

function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const PROFILES_BY_KEY: ReadonlyMap<string, Readonly<OrgProfile>> = new Map(
  Object.entries(ORG_PROFILES).map(([name, p]) => [nameKey(name), p]),
);

/**
 * The profile for an organization name, matched case- and
 * whitespace-insensitively, or `undefined` for a name we hold nothing for
 * (a manually entered organization, or one the directory doesn't list yet).
 */
export function orgProfileFor(
  orgName: string | null | undefined,
): Readonly<OrgProfile> | undefined {
  if (!orgName) return undefined;
  return PROFILES_BY_KEY.get(nameKey(orgName));
}

/**
 * Whether the organization keeps its Greek letters off every surface (Phi
 * Gamma Delta). A screen that would show or ask for letters (a directory
 * result, a setup or settings field, the show-letters switch) draws neither
 * for such an organization; its short name stands in. It matches the name
 * exactly: for a chapter's own name, which often adds to the organization's,
 * read `orgHidingGreekLettersIn`.
 */
export function orgHidesGreekLetters(
  orgName: string | null | undefined,
): boolean {
  return orgProfileFor(orgName)?.displaysGreekLetters === false;
}

function words(name: string): string[] {
  return nameKey(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function containsRun(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

/**
 * Organizations that hide their letters, with what names them inside a longer
 * chapter name: the organization's own name, matched in any case, and its
 * short name, matched only as the profile writes it. "FIJI" is how a Phi Gamma
 * Delta chapter writes itself; "Fiji" in "Fiji Student Association" is the
 * country, and must not hide that chapter's letters or fill in FIJI's short
 * name.
 */
const LETTER_HIDING_ORGS: readonly {
  name: string;
  nameRun: string[];
  shortName?: string;
}[] = Object.entries(ORG_PROFILES)
  .filter(([, p]) => p.displaysGreekLetters === false)
  .map(([name, p]) => ({
    name,
    nameRun: words(name),
    shortName: p.shortName,
  }));

/**
 * The organization whose letters a chapter of this name must not show: one
 * that hides its letters (Phi Gamma Delta) and whose name the chapter's name
 * contains as whole words, in any case ("Phi Gamma Delta Tau Nu"), or whose
 * short name it contains as written ("FIJI at RPI", not "Fiji Student
 * Association"). Returns that organization's name, or `undefined`.
 *
 * `orgHidesGreekLetters` matches an organization's name exactly, which is
 * right for a directory row's `org_name`. A chapter's own name is often its
 * organization's plus more, so a screen deciding whether to draw a chapter's
 * letters reads this instead. It looks only at organizations that hide their
 * letters, so its looser match can hide letters but never show them.
 */
export function orgHidingGreekLettersIn(
  chapterName: string | null | undefined,
): string | undefined {
  if (!chapterName) return undefined;
  const name = words(chapterName);
  const asWritten = chapterName.split(/[^\p{L}\p{N}]+/u);
  return LETTER_HIDING_ORGS.find(
    (org) =>
      containsRun(name, org.nameRun) ||
      (org.shortName !== undefined && asWritten.includes(org.shortName)),
  )?.name;
}

/** The organization's official colors, or an empty list when unknown. */
export function orgColorsFor(
  orgName: string | null | undefined,
): readonly OrgColor[] {
  return orgProfileFor(orgName)?.colors ?? [];
}

/**
 * The accent a new chapter of this organization starts with: its first
 * official color, or `undefined` when we hold none.
 *
 * The wizards prefer this over `chapter_directory.default_colors.accent`,
 * because 45 of the directory's 50 rows carry the same placeholder gold
 * (`#C9A56F`), which is how the beta chapter ended up cream instead of purple.
 */
export function orgDefaultAccent(
  orgName: string | null | undefined,
): string | undefined {
  return orgColorsFor(orgName)[0]?.hex;
}

/** The two chapter-mark fields an organization's profile can set in setup. */
export type OrgMarkFields = { shortName: string; showGreekLetters: boolean };

/** The profile a setup form's organization name stands for. */
function markProfileFor(
  name: string | null | undefined,
): Readonly<OrgProfile> | undefined {
  return orgProfileFor(name) ?? orgProfileFor(orgHidingGreekLettersIn(name));
}

/**
 * The short name and letters switch a setup form holds after its
 * organization name changes from `previousName` to `nextName`, whether by
 * typing or by picking a directory row.
 *
 * - The same organization before and after changes nothing. A name that
 *   contains a letter-hiding organization's counts as that organization, so
 *   typing "Phi Gamma Delta Tau Nu" past "Phi Gamma Delta" keeps FIJI's short
 *   name and the letters off.
 * - Leaving an organization undoes what its profile filled in: its short name,
 *   if the field still holds exactly that, and the letters switch it turned
 *   off. Picking FIJI by mistake, then another organization, leaves neither
 *   behind.
 * - Arriving at an organization fills an empty short-name field from its
 *   profile, and turns the switch off when it hides its letters. A short name
 *   the founder typed is never replaced.
 *
 * Both setups read this, web's wizard and mobile's create-chapter, so the
 * same name leaves both forms holding the same short name and switch.
 */
export function orgMarkFieldsFor(
  nextName: string | null | undefined,
  previousName: string | null | undefined,
  current: OrgMarkFields,
): OrgMarkFields {
  const next = markProfileFor(nextName);
  const previous = markProfileFor(previousName);
  if (next === previous) {
    return {
      shortName: current.shortName,
      showGreekLetters: current.showGreekLetters,
    };
  }
  let { shortName, showGreekLetters } = current;
  if (previous?.shortName && shortName === previous.shortName) shortName = "";
  if (previous?.displaysGreekLetters === false) showGreekLetters = true;
  if (next?.shortName && !shortName.trim()) shortName = next.shortName;
  if (next?.displaysGreekLetters === false) showGreekLetters = false;
  return { shortName, showGreekLetters };
}
