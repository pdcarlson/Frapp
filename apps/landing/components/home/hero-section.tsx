import { TrackedCta } from "../tracked-cta";
import { ChatFrame } from "./chat-frame";
import {
  BUTTON_PRIMARY,
  EYEBROW,
  FRAME_CAPTION,
  LINK_ACCENT,
  SHELL,
} from "./styles";

/* 1 · Hero (D9, HeroB.dc.html). */
export function HeroSection({
  signupUrl,
  joinUrl,
}: {
  signupUrl: string;
  joinUrl: string;
}) {
  return (
    <section
      aria-labelledby="hero"
      className={`${SHELL} grid gap-10 overflow-hidden pt-10 sm:pt-18 lg:grid-cols-12 lg:gap-x-6`}
    >
      <div className="flex flex-col gap-6 lg:col-span-6 lg:pb-10">
        <p className={EYEBROW}>Chapter operations, chat first</p>
        <h1 id="hero" className="text-hero text-balance text-foreground">
          Run your chapter where it already talks.
        </h1>
        <p className="max-w-[616px] text-lead text-muted-foreground">
          Frapp is chat first. Events, check-in and points land in the
          conversation your members already read. Officers stop chasing.
          Members stop asking where things are.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <TrackedCta
            cta="get-started"
            surface="hero"
            href={signupUrl}
            className={BUTTON_PRIMARY}
          >
            Get started
          </TrackedCta>
          <TrackedCta
            cta="join-chapter"
            surface="hero"
            href={joinUrl}
            className={LINK_ACCENT}
          >
            Have an invite? Join your chapter
          </TrackedCta>
        </div>
        <p className="max-w-[616px] text-body text-muted-foreground">
          Free for chat, members and announcements. No card. Officers add
          Chapter Pro when the chapter needs events, dues and points.
        </p>
      </div>

      {/*
        The frame bleeds off the right edge at `lg` and only at `lg`, which
        is where the board draws it: at 720 wide it overruns its column, and
        `overflow-hidden` on the section clips it at the shell rather than
        letting it open a horizontal scrollbar. The header is a sibling of
        this section, not a descendant, so that clip cannot break its
        stickiness.

        Below `lg` it is a whole, fully bordered frame at the column width.
        Bleeding it there would crop a 720 frame to phone width and cut the
        thread mid-word, which reads as a rendering bug rather than as a
        composition; the phone board carries no bleeding frame either.

        `min-w-0` lets this grid item shrink below the frame's min-content,
        which the header's nowrap subtitle sets. Without it, at 320 the
        subtitle held the column, and the frame, 35px wider than the shell,
        and the section's clip cut off the frame's right edge.
      */}
      <div className="min-w-0 lg:col-span-6 lg:-mr-20">
        <div className="flex flex-col gap-3">
          <ChatFrame
            variant="fold"
            label="The Frapp web app, the general channel: an event card in the conversation with a Check in button and a live count, an officer's reply, and a mention."
          />
          <p className={`${FRAME_CAPTION} lg:pr-20`}>
            Demo chapter, seen as an officer. Names and messages are
            illustrative.
          </p>
        </div>
      </div>
    </section>
  );
}
