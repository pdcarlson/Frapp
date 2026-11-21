/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * The rules both product frames follow (static JSX, one labelled `role="img"`,
 * board-transcribed internals, bounded by `spec/behavior/`) open `chat-frame.tsx`.
 */

export function EventFrame() {
  return (
    <div
      role="img"
      aria-label="The Frapp mobile app: an event detail with check-in open, a line saying to scan the officer's code here or with the phone's camera, and a Scan code link."
      /*
       * Phone geometry is the base and desktop is the override, because the two
       * boards draw different frames rather than one frame at two widths:
       * `Phone.dc.html` is 350x560 at radius 28 with 44/16 insets,
       * `Main.dc.html` is 390x600 at radius 36 with 56/20. Varying only the
       * width would have shipped a phone frame at the desktop's height and
       * insets, cropping different content than the board approves.
       */
      className="flex h-[560px] w-[350px] max-w-full flex-col overflow-hidden rounded-[28px] border border-input bg-background px-4 pt-11 sm:h-[600px] sm:w-[390px] sm:rounded-[36px] sm:px-5 sm:pt-14"
    >
      <p className="text-[15px] font-semibold leading-5 text-accent-text">
        ‹ Events
      </p>

      <div className="mt-5 flex items-center gap-2">
        {/*
          The danger chip is the board's literal `rgba(248,81,73,.13)` rather
          than `bg-destructive/[0.13]`, and that is not laziness. Tailwind
          compiles an alpha-modified token to `color-mix`, with the OPAQUE token
          as the un-guarded fallback: below the `color-mix` floor the fill
          resolves to `--destructive` and the lifted `--destructive-text` label
          on top of it all but disappears. That exposure was #2376, which gave
          the dashboard `rgba()` `bg-*-tint` tokens with no floor. A literal has
          no `color-mix` dependency, renders the same in every engine, and is
          what the frame is transcribed from anyway, since frame internals
          follow the reference boards rather than the token map.
        */}
        <span className="inline-flex h-6 items-center rounded-xs bg-[rgba(248,81,73,0.13)] px-2.5 text-[12.5px] font-semibold text-destructive-text">
          Mandatory
        </span>
        <span className="inline-flex h-6 items-center rounded-xs border border-accent-border bg-accent-subtle px-2.5 text-[12.5px] font-semibold text-accent-text">
          +10 pts
        </span>
      </div>

      <p className="mt-3 text-[32px] font-bold leading-[37px] tracking-[-0.02em] text-foreground">
        Chapter meeting
      </p>
      <p className="mt-2 text-[16px] leading-[25px] text-muted-foreground">
        Tonight · 6:30 to 7:30 PM · Chapter room
      </p>

      <div className="mt-6 flex flex-col gap-3.5 rounded-lg border border-accent-border bg-accent-subtle p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            `relative` is load-bearing: the ring is this span's `::after` and
            is positioned against it. `globals.css` § the check-in dot's ring
            carries why the gesture is two beats at the micro duration.
          */}
          <span className="checkin-ring relative h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
          <span className="text-[16px] font-semibold text-accent-text">
            Check-in is open
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            closes 7:45
          </span>
        </div>
        {/*
          What the app's check-in card says to a member while the window is
          open (`apps/mobile/app/(app)/event-details.tsx`, `CheckInCard`): one
          line naming the phone's camera, since the QR is a link the camera
          opens, and a quieter Scan code text action. The boards' gold "Scan QR
          to check in" button is a product the app no longer has (#4768).
        */}
        <p className="text-[16px] leading-[25px] text-foreground">
          Scan the code on the officer&apos;s screen, here or with your
          phone&apos;s camera.
        </p>
        <span className="flex h-11 items-center justify-center text-[16px] font-semibold text-accent-text">
          Scan code
        </span>
      </div>

      <p className="mt-6 text-[12.5px] font-semibold uppercase leading-[17px] tracking-[0.1em] text-muted-foreground">
        Details
      </p>
      <p className="mt-2 text-[16px] leading-[25px] text-muted-foreground">
        Committee reports and the philanthropy vote. Attendance inside the
        window awards the event&apos;s points.
      </p>

      {/*
        No Host block: an event has no host or creator list to show (#3762),
        so the frame ends on its details (#3869).
      */}
    </div>
  );
}
