/**
 * Signet duotone glyphs for the Directory family — the actives and alumni tabs
 * of `/members`.
 *
 * Recipe and the shared `Svg` / `stroke` / `detail` / `fillProps` primitives:
 * `components/ui/duotone.tsx` (`spec/ui/design-system/iconography.md` §1). The
 * intent → glyph map lives in `iconography.md` §6.2.3 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * Alumni draws from this file rather than its own: `/members` hosts both tabs
 * (`directory-page.tsx`), so they are one screen with one set of intents, and
 * `spec/ui/web-dashboard/README.md` records that as the point of the Wave 0
 * merge — "asking a member to know which list a person is on before they can
 * look them up was the defect".
 *
 * **Control furniture stays Lucide**, exactly as it does in the shell and in
 * chat (§6.2.2): `Loader2`, `Trash2`, `Copy`, and the `AlertTriangle` the §10
 * state family already draws from Lucide on every surface. A verb on a button
 * is furniture; the thing the row is *about* is an intent. The rule used to be
 * illustrated by two more pairs — `ArrowUp`/`ArrowDown` for sort direction and
 * `List`/`LayoutGrid` for view mode — and both controls are gone: the
 * greenfield lane replaced four sortable table headers with one sort select and
 * deleted the table/card view toggle outright.
 *
 * The three silhouettes the Directory shares with the shell's nav intents are
 * re-exported rather than redrawn — a second copy of the same path data is the
 * drift §1 rule 1 bans.
 */

import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  DirectoryGlyph,
  RolesGlyph,
  SearchGlyph,
} from "@/components/layout/nav-glyphs";

export type DirectoryGlyphProps = DuotoneGlyphProps;

/**
 * Invite a member.
 *
 * One intent that shipped as two icons: `UserPlus` on the directory's trigger
 * and `ShieldPlus` in the dialog that trigger opens. The shield was the wrong
 * half of the story anyway — the dialog issues an invite token, it does not
 * grant a role — so both take the person-plus-mark drawing, and the head shares
 * `DirectoryGlyph`'s geometry so the two read as the same person.
 */
export function InviteGlyph({ className, active }: DirectoryGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="9.5" cy="8.6" r="3.4" {...stroke} {...fillProps(active)} />
      <path d="M3.8 19c.8-3.1 3.1-4.7 5.7-4.7s4.9 1.6 5.7 4.7" {...detail} />
      <path d="M18.6 7.2v5.2M16 9.8h5.2" {...detail} />
    </Svg>
  );
}

/*
 * `AlumniGlyph`, the mortarboard, is deleted rather than left unimported.
 *
 * It existed for one consumer: the "ALUMNI" Hairline badge on every card in the
 * alumni grid. The greenfield lane deleted that badge, because a per-row tag
 * reading ALUMNI on every row of the list the Alumni tab opens is the same fact
 * three times — the board's `1t` deletes badge rows on the same reasoning, and
 * lane 4 deleted `/backwork`'s for it. With the badge gone the glyph has no
 * call site, and `iconography.md` §6.3 requires the intent map to move in the
 * same change, so the "Alumni" row went out of §6.2.3 with it.
 *
 * The intent is not homeless: the alumni list is reached through the Directory
 * tab row, which is text, and `DirectoryGlyph` is still the nav intent for the
 * route. Git history holds the path data if a later surface needs the mark.
 */
