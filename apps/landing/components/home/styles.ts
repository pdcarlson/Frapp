/*
 * The class strings the landing's home sections share. Each section imports
 * what it draws from here, so a control or a section rhythm is one string, not
 * one copy per section.
 */

/*
 * The board's stage, not its content band. Main.dc.html is 1440 wide with
 * `padding:0 80px`, so the twelve-column track the canvas guides draw is 1280.
 * Capping at 1280 here would have made the track 1120 and squeezed every span
 * below. Above 1440 the track stays 1280 and the margins grow, which is the one
 * behaviour the board does not draw and a cap has to invent.
 */
export const SHELL = "mx-auto w-full max-w-[1440px] px-5 sm:px-20";

/* Sections start 64 apart on the phone board and 96 on the desktop one. */
export const SECTION_GAP = "pt-16 sm:pt-24";

export const EYEBROW =
  "text-label uppercase tracking-[0.12em] text-accent-text";

export const SECTION_H2 = "text-display-lg text-balance text-foreground";

/*
 * Controls take radius 12 and a 48 box (44 in the nav), per foundations §8 and
 * the System sheet. Focus is §10's: a 3px ring of the accent at 25% with the
 * border going solid accent-11 (`--accent-text`, #2398). The primary buttons
 * clip their fill to the padding box, so that border shows the page at rest and
 * the accent on focus rather than repainting under the fill it already sits on.
 * `chrome-motion` carries only the timing.
 */
export const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-primary/25 focus-visible:border-accent-text";

export const BUTTON_PRIMARY = `chrome-motion inline-flex h-12 items-center justify-center rounded-md border border-transparent bg-primary bg-clip-padding px-6 text-body font-bold text-primary-foreground hover:bg-primary-hover ${FOCUS_RING}`;

/* The nav's own primary sits on the 44 touch floor rather than the 48 box. */
export const BUTTON_PRIMARY_NAV = `chrome-motion inline-flex h-11 items-center justify-center rounded-md border border-transparent bg-primary bg-clip-padding px-[18px] text-label font-bold text-primary-foreground hover:bg-primary-hover ${FOCUS_RING}`;

/* Quiet links lift to the foreground; the accent link holds its colour and
 * underlines instead, so the one gold on the page never becomes two. */
export const LINK_QUIET = `chrome-motion inline-flex h-11 items-center rounded-xs border border-transparent text-label font-semibold text-muted-foreground hover:text-foreground ${FOCUS_RING}`;

export const LINK_ACCENT = `chrome-motion inline-flex h-11 items-center rounded-xs border border-transparent text-body font-semibold text-accent-text hover:underline hover:underline-offset-[3px] ${FOCUS_RING}`;

export const PROOF_ROW = "border-b border-border py-4";
export const PROOF_TITLE = "text-body font-semibold text-foreground";
export const PROOF_BODY = "text-body text-muted-foreground";

export const FRAME_CAPTION = "text-caption text-muted-foreground";

/*
 * `--i` is the stagger index a reveal's children carry. React's CSSProperties
 * does not model custom properties, and the alternative to this alias is a
 * cast at every call site.
 */
export type StaggerStyle = React.CSSProperties & Record<"--i", number>;
