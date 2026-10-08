import { EYEBROW, PROOF_BODY, SECTION_GAP, SHELL } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

const officers = [
  {
    role: "President",
    outcome:
      "Chapter meeting check-in is a QR on the screen. Attendance and points post themselves.",
  },
  {
    role: "Treasurer",
    outcome:
      "Dues invoices go out through Stripe. Paid, open and overdue are one list, not a DM thread.",
  },
  {
    role: "Secretary",
    outcome:
      "Minutes, bylaws and the audit log live where members already look. Nobody asks for the link twice.",
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
