import { RevealOnView } from "../reveal-on-view";
import { EventFrame } from "./event-frame";
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

const eventsProof = [
  {
    title: "One check-in, everywhere.",
    body: "Checked in on the card is checked in on the app. Same state, no drift.",
  },
  {
    title: "Points post themselves.",
    body: "Attendance inside the window awards the event's points. Nobody types a number.",
  },
  {
    title: "Past events keep their record.",
    body: "Attendance status stays on every past event, per member.",
  },
];

/* 4 · Proof, events. */
export function EventsProofSection() {
  return (
    <section aria-labelledby="events" className={`${SHELL} ${SECTION_GAP}`}>
      {/*
        The copy leads in the DOM and the frame follows, which is the phone
        board's order and the sensible one for a screen reader: the heading
        that names the section before the picture of it. Desktop keeps the
        frame on the left, as `Main.dc.html` draws it, through explicit grid
        placement rather than a flex `order`, so the two live in the same
        row without the source order changing.

        Both grid items carry `min-w-0`. The grid has no explicit column
        below `lg`, so its one implicit track is sized from its items, and
        the event frame's 350px (`w-[350px] max-w-full`) is the min-content
        that held it: the track stayed 350 wide, `max-w-full` capped the
        frame at a track that had already grown, and both items, stacked in
        that one track, ran to 370. At 320 and 360 that opened a horizontal
        scrollbar (#3079); at 375 it ate 15 of the shell's 20px right
        gutter. `min-w-0` lets the track shrink to the shell's content box,
        so below 390 the frame narrows with it (335 at 375, gutters even)
        and reflows at full type size; the board's own frame crops with
        `overflow-hidden` too. The hero's grid item did the same for the
        chat frame (#2893).
      */}
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
        <RevealOnView className="flex min-w-0 flex-col gap-6 lg:col-span-5 lg:col-start-6 lg:row-start-1">
          <p className={`${EYEBROW} reveal-item`}>Events and check-in</p>
          <h2
            id="events"
            className={`${SECTION_H2} reveal-item`}
            style={{ "--i": 1 } as StaggerStyle}
          >
            Check-in that keeps its own books.
          </h2>
          <p className={`${PROOF_BODY} reveal-item`} style={{ "--i": 2 } as StaggerStyle}>
            An officer opens check-in for a window. Members scan the QR in
            the room, attendance is recorded, and the points post. Nobody
            keeps a spreadsheet.
          </p>
          <div className="reveal-rule mt-2 border-t border-border" />
          <div className="flex flex-col">
            {eventsProof.map((row, index) => (
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
            Demo chapter. Names and events are illustrative.
          </p>
        </RevealOnView>

        {/*
          The wrapper is here for the check-in dot's ring and nothing else.
          The frame itself carries no `reveal-item`, so it is drawn at rest
          exactly as before: `reveal-armed` hides only `reveal-item`
          children, and the ring is a pseudo-element with no rest state. A
          reader who never sees the ring is missing nothing.
        */}
        <RevealOnView className="flex min-w-0 justify-center lg:col-span-5 lg:col-start-1 lg:row-start-1 lg:justify-start">
          <EventFrame />
        </RevealOnView>
      </div>
    </section>
  );
}
