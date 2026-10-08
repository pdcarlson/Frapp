import { RevealOnView } from "../reveal-on-view";
import { ChatFrame } from "./chat-frame";
import {
  EYEBROW,
  FRAME_CAPTION,
  PROOF_BODY,
  PROOF_ROW,
  PROOF_TITLE,
  SECTION_GAP,
  SECTION_H2,
  SHELL,
  type StaggerStyle,
} from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

const chatProof = [
  {
    title: "Events post as cards.",
    body: "Check in without leaving the thread. Officers watch the count update live.",
  },
  {
    title: "Red means you.",
    body: "Mentions and DMs are red. Channel unread stays neutral.",
  },
  {
    title: "Officer changes are public.",
    body: "Dues, roles and module changes post to #chapter-audit. Every member can read it.",
  },
];

/* 3 · Proof, chat. */
export function ChatProofSection() {
  return (
    <section id="product" className={`${SHELL} ${SECTION_GAP}`}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
        <RevealOnView className="flex flex-col gap-6 lg:col-span-4">
          <p className={`${EYEBROW} reveal-item`}>Chat is the spine</p>
          <h2 className={`${SECTION_H2} reveal-item`} style={{ "--i": 1 } as StaggerStyle}>
            Ops happen in the thread.
          </h2>
          <p className={`${PROOF_BODY} reveal-item`} style={{ "--i": 2 } as StaggerStyle}>
            Members open chat. So that is where the event lands, where the
            check-in happens, and where the treasurer says the invoice batch
            went out. Nothing sits behind a tab nobody opens.
          </p>
          <div className="reveal-rule mt-2 border-t border-border" />
          <div className="flex flex-col border-t-0">
            {chatProof.map((row, index) => (
              <div
                key={row.title}
                className={`${PROOF_ROW} reveal-item`}
                style={{ "--i": index + 3 } as StaggerStyle}
              >
                <p className={PROOF_TITLE}>{row.title}</p>
                <p className={PROOF_BODY}>{row.body}</p>
              </div>
            ))}
          </div>
          <p className={FRAME_CAPTION}>
            Demo chapter, seen as an officer. Names and messages are
            illustrative.
          </p>
        </RevealOnView>

        <div className="lg:col-span-8">
          <ChatFrame
            variant="full"
            label="The Frapp web app: a channel list beside the general channel, where an event card sits in the conversation with a Check in button and a live count."
          />
        </div>
      </div>
    </section>
  );
}
