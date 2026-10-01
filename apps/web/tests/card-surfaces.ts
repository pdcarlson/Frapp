/**
 * Elements painting `--card` that are not controls: what a flush route must
 * not grow back.
 *
 * The greenfield lanes deleted the card as a **container** on every flushed
 * route, and the whole-screen async states (`async-states.tsx`) paint `--card`
 * too. But `bg-card` is also the Secondary *button* recipe (`ui/button.tsx`),
 * which is legitimate and unrelated, so a bare `.bg-card` query counts a Retry
 * button as a restored panel. This looks only at what is not a control.
 *
 * The idle presence dot is deliberately `bg-card` (`presence-status.ts`: a
 * transparent interior lets an avatar photo show through and destroys the
 * shape cue). It is a 10px disc, not a container.
 *
 * Started in `members-directory.spec.tsx`; shared once `/chat-admin` and
 * `/discord-import` needed the same guard (#2500).
 */
export function cardFilledContainers(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".bg-card")).filter(
    (el) => el.tagName !== "BUTTON" && !el.hasAttribute("data-presence"),
  );
}
