import { EYEBROW, PROOF_BODY, SECTION_GAP, SHELL } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * Dues is off for every chapter in the beta (`BETA_OFF_MODULES` in
 * `packages/validation/src/beta-off-modules.ts`), so no officer here sells it.
 * When dues returns, a treasurer's line can come back with it (#3869).
 */
const officers = [
  {
    role: "President",
    outcome:
      "Chapter meeting check-in is a QR on the screen. Attendance and points post themselves.",
  },
  {
    role: "Vice president",
    outcome:
      "Points and attendance keep their own books. Nobody totals a spreadsheet at the end of term.",
  },
  {
    role: "Secretary",
    outcome:
      "Minutes and bylaws sit in Documents, and officer changes post to their own channel. Nobody asks for the link twice.",
  },
];

/*
 * 2 · Officers, at the fold.
 *
 * Drawn at rest on purpose, and it is the one block the Motion sheet
 * names for a reveal that does not get one. D9 replaced the crest column
 * with the chat frame, which moved this strip up into the 1440x900 fold:
 * it is first paint now, where README §7 prefers a static layout, and a
 * reveal armed after hydration on an already-painted block is a flash
 * rather than an entrance. The reveals below the fold are unaffected.
 */
export function OfficersSection() {
  return (
    <section aria-labelledby="officers" className={`${SHELL} ${SECTION_GAP}`}>
      <div className="grid gap-6 border-t border-border pt-6 lg:grid-cols-12 lg:gap-x-6">
        <h2 id="officers" className={`${EYEBROW} lg:col-span-3`}>
          Built for officers
        </h2>
        {officers.map((officer) => (
          <div key={officer.role} className="flex flex-col gap-2 lg:col-span-3">
            <h3 className="text-title text-foreground">{officer.role}</h3>
            <p className={PROOF_BODY}>{officer.outcome}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
