import { RevealOnView } from "../reveal-on-view";
import { TrackedCta } from "../tracked-cta";
import {
  BUTTON_PRIMARY,
  EYEBROW,
  PROOF_BODY,
  SECTION_GAP,
  SECTION_H2,
  SHELL,
  type StaggerStyle,
} from "./styles";

const freePlan = [
  "Unlimited chat, members and chapters",
  "Announcements and direct messages",
  "Member directory and invites",
  "Chapter settings and the member-visible audit log",
  "No card",
];

/*
 * The AI features are left off deliberately although `positioning.md` gates
 * them behind this tier: nothing ships that can answer a question yet
 * (`spec/behavior/ai.md`), so listing them would sell an unbuilt module.
 */
const proPlan = [
  "Everything in Free",
  "Events with QR check-in and attendance",
  "Points ledger and leaderboard",
  "Dues invoicing, collected through Stripe",
  "Backwork library, reports and exports",
];

/* 5 · Pricing (D3). */
export function PricingSection({ signupUrl }: { signupUrl: string }) {
  return (
    <section id="pricing" className={`${SHELL} ${SECTION_GAP}`}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
        <div className="flex flex-col gap-6 lg:col-span-4">
          <p className={EYEBROW}>Pricing</p>
          <h2 className={SECTION_H2}>Free for chat. Pro for the ops.</h2>
          <p className={PROOF_BODY}>
            Every chapter starts on Free. Chapter Pro is one flat price per
            chapter, whatever your size, and it turns on the officer tools.
          </p>
          {/*
            The mechanics, stated exactly as `positioning.md` records them.
            The page this replaced said every new chapter starts with a
            14-day trial, which is not how the gating model works: a chapter
            starts on Free and the trial opens at checkout.
          */}
          <p className={`${PROOF_BODY} border-t border-border pt-4`}>
            The trial starts at checkout inside the app: 14 days, card up
            front, first charge on day 15, once per chapter.
          </p>
        </div>

        <RevealOnView className="grid gap-6 sm:grid-cols-2 lg:col-span-8 lg:col-start-5">
          <div
            className="reveal-item chrome-motion flex flex-col gap-6 rounded-xl border border-border bg-card p-8 hover:border-primary hover:bg-popover focus-within:border-primary focus-within:bg-popover"
            style={{ "--i": 0 } as StaggerStyle}
          >
            <h3 className="text-title text-foreground">Free</h3>
            <p className="flex items-baseline gap-2">
              <span className="text-display-lg tabular-nums text-foreground">
                $0
              </span>
              <span className="text-body text-muted-foreground">
                per chapter
              </span>
            </p>
            <ul className="flex flex-col border-t border-border">
              {freePlan.map((item) => (
                <li key={item} className="border-b border-border py-3 text-body">
                  {item}
                </li>
              ))}
            </ul>
            {/*
              The only control in this section. Both tiers resolve to
              `/sign-up` because no checkout deep link exists, so a second
              button would be the same link twice wearing two labels.
            */}
            <TrackedCta
              cta="get-started"
              surface="pricing"
              href={signupUrl}
              className={`${BUTTON_PRIMARY} mt-auto w-full`}
            >
              Get started
            </TrackedCta>
          </div>

          <div
            className="reveal-item chrome-motion relative flex flex-col gap-6 overflow-hidden rounded-xl border border-accent-border bg-card p-8 hover:border-primary hover:bg-popover focus-within:border-primary focus-within:bg-popover"
            style={{ "--i": 1 } as StaggerStyle}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-0.5 bg-primary"
            />
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-title text-foreground">Chapter Pro</h3>
              <span className="inline-flex h-6 items-center rounded-xs border border-accent-border bg-accent-subtle px-[9px] text-caption font-semibold text-accent-text">
                14-day trial
              </span>
            </div>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-display-lg tabular-nums text-foreground">
                $149
              </span>
              <span className="text-body text-muted-foreground">
                per chapter, per month. Flat.
              </span>
            </p>
            <ul className="flex flex-col border-t border-border">
              {proPlan.map((item) => (
                <li key={item} className="border-b border-border py-3 text-body">
                  {item}
                </li>
              ))}
            </ul>
            <p className={`${PROOF_BODY} mt-auto`}>
              Upgrade any time from Settings inside the app.
            </p>
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}
