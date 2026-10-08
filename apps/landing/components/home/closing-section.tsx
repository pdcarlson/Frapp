import { RevealOnView } from "../reveal-on-view";
import { SignetCrest } from "../signet-crest";
import { TrackedCta } from "../tracked-cta";
import {
  BUTTON_PRIMARY,
  LINK_ACCENT,
  SECTION_H2,
  SHELL,
  type StaggerStyle,
} from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/* 6 · Closing. */
export function ClosingSection({
  signupUrl,
  loginUrl,
}: {
  signupUrl: string;
  loginUrl: string;
}) {
  return (
    <section
      aria-labelledby="closing"
      className={`${SHELL} flex flex-col items-center gap-6 pb-24 pt-20 text-center sm:pt-30`}
    >
      <RevealOnView className="flex w-full flex-col items-center gap-6">
        {/*
          Decorative: the heading beside it carries the meaning and the
          header lockup has already named the brand, so a second
          announcement would only repeat it. The crest paints whole from the
          first frame. The Motion sheet's signature moment, which would have
          wiped it in here, is cut until D4's brand sign-off clears (#2378).
        */}
        <span className="reveal-item" style={{ "--i": 0 } as StaggerStyle}>
          <SignetCrest className="h-14 w-14 sm:h-18 sm:w-18" />
        </span>
        {/*
          D8 holds the locked tagline off the page body until Ask can
          answer. `layout.tsx` keeps it in the meta and OG titles, where it
          is the brand tagline rather than a product claim.
        */}
        <h2
          id="closing"
          className={`${SECTION_H2} reveal-item max-w-[860px]`}
          style={{ "--i": 1 } as StaggerStyle}
        >
          Everything your chapter needs is already in chat.
        </h2>
        <p
          className="reveal-item max-w-[560px] text-lead text-muted-foreground"
          style={{ "--i": 2 } as StaggerStyle}
        >
          Sign up, name the chapter, invite the members. The officer tools
          are there when the chapter needs them.
        </p>
        <div
          className="reveal-item flex flex-wrap items-center gap-x-6 gap-y-3"
          style={{ "--i": 3 } as StaggerStyle}
        >
          <TrackedCta
            cta="get-started"
            surface="cta-band"
            href={signupUrl}
            className={BUTTON_PRIMARY}
          >
            Get started
          </TrackedCta>
          <TrackedCta
            cta="log-in"
            surface="cta-band"
            href={loginUrl}
            className={LINK_ACCENT}
          >
            Sign in
          </TrackedCta>
        </div>
      </RevealOnView>
    </section>
  );
}
