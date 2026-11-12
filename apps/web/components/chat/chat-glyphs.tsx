/**
 * Signet duotone glyphs for the chat family.
 *
 * Recipe and the shared `Svg` / `stroke` / `detail` / `fillProps` primitives:
 * `components/ui/duotone.tsx` (`spec/ui/design-system/iconography.md` §1). The
 * intent → glyph map lives in `iconography.md` §6.2.2 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * **What is deliberately NOT here.** Two classes of drawing stay off this file:
 *
 * - **Control furniture** — `Loader2`, `RefreshCw`, `X`, `Check`, `Trash2` —
 *   stays on Lucide, exactly the split the shell made (`iconography.md` §6.2:
 *   "control furniture, not nav intents"). A spinner is not an intent.
 * - **The channel sigil and the DM avatar.** `canvas-screens.dc.html` s04 draws
 *   a channel as a **text `#`** at 17px/700 and a DM as an initials avatar, not
 *   as icons. The reference wins over a tidier all-icons row.
 *
 * The seven silhouettes chat shares with the shell's nav intents (events, tasks,
 * points, polls, search, service hours, and the directory as the member list toggle)
 * are re-exported rather than redrawn — a second
 * copy of the same path data is exactly the drift §1 rule 1 bans.
 */

import { MARK_GLYPH_PATHS } from "@repo/theme/nav-glyphs";
import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  DirectoryGlyph as MembersGlyph,
  EventsGlyph,
  PointsGlyph,
  PollsGlyph,
  SearchGlyph,
  ServiceGlyph,
  TasksGlyph,
} from "@/components/layout/nav-glyphs";

export type ChatGlyphProps = DuotoneGlyphProps;

/**
 * Pinned message — pin body filled, needle stroke-only. Also a channel pinned
 * to the top of the member's own list (#2877), filled while it is pinned.
 */
export function PinGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path d={MARK_GLYPH_PATHS.pin.body} {...stroke} {...fillProps(active)} />
      <path d={MARK_GLYPH_PATHS.pin.detail} {...detail} />
    </Svg>
  );
}

/**
 * Bookmarked message — the personal counterpart to `PinGlyph` (#462).
 *
 * A ribbon rather than a second pin, and that distinction is doing real work
 * rather than decoration: pin and bookmark sit in the same action cluster on
 * the same row, and `spec/behavior/chat/README.md` makes them opposites — pin
 * is the chapter-public elevation, a bookmark is private to the bookmarker.
 * Two similar silhouettes there would invite a member to elevate a message to
 * the whole chapter while meaning to save it for themselves.
 *
 * Filled when `active`, matching `PinGlyph`'s convention for "this state is on"
 * (§1), so the toggle reads at a glance without relying on the label alone.
 */
export function BookmarkGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M6.5 3.75h11v16.5l-5.5-4.2-5.5 4.2z"
        {...stroke}
        {...fillProps(active)}
      />
    </Svg>
  );
}

/**
 * Attach a file.
 *
 * Stroke-only, like the shell's `MenuGlyph`: a paperclip is an
 * open curve with no silhouette, and SVG closes an open path implicitly when it
 * fills one — an earlier cut spread `fillProps` over `detail` here and painted a
 * lens-shaped wedge across the clip.
 */
export function AttachGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M8 11.2l6-6a3.6 3.6 0 015.1 5.1l-8.2 8.2a5.6 5.6 0 01-7.9-7.9l7.4-7.4"
        {...detail}
      />
    </Svg>
  );
}

export function ReactionGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...stroke} {...fillProps(active)} />
      <path d="M8.6 14.2a4.2 4.2 0 006.8 0" {...detail} />
      <path d="M9.3 9.6h.01M14.7 9.6h.01" {...detail} strokeWidth={2} />
    </Svg>
  );
}

/**
 * The composer's **+** (#3865): the one control that opens everything a
 * message can carry besides text (a file, and every command's form). Stroke
 * only, like `SendArrowGlyph`: a plus has no area to fill. Deliberately not a
 * sparkle, for the reason the slash palette's old button wasn't one: ✦ is
 * claimed by the Ask/AI affordance (`components.md` §11), and this is a
 * launcher, not an answer surface.
 */
export function PlusGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" {...detail} strokeWidth={2} />
    </Svg>
  );
}

/**
 * Send — an up arrow, the mobile composer's `↑` (principles.md P6.5). Stroke
 * only and heavier than the family's 1.6, because it is drawn at 16px on a
 * filled accent circle where the thin stroke disappears.
 */
const SEND_ARROW = (
  <path d="M12 19.5V5M5.5 11.5L12 5l6.5 6.5" {...detail} strokeWidth={2.4} />
);

export function SendArrowGlyph({ className }: ChatGlyphProps) {
  return <Svg className={className}>{SEND_ARROW}</Svg>;
}

/**
 * Jump to latest — a down arrow, the web face of mobile's `↓` over the thread
 * (`jump-to-latest-button.tsx`). `SendArrowGlyph` turned over, at its weight,
 * since it is drawn at 16px on a small round control too.
 */
export function JumpToLatestGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <g transform="rotate(180 12 12)">{SEND_ARROW}</g>
    </Svg>
  );
}

/** Announcement / broadcast. Horn filled, sound lines stroke-only. */
export function AnnouncementGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M4 10.2v3.6a1.6 1.6 0 001.6 1.6h2.1L14 19V5l-6.3 3.6H5.6A1.6 1.6 0 004 10.2z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M17.2 9.2a4 4 0 010 5.6" {...detail} />
    </Svg>
  );
}

/**
 * Sign-up sheet, in the composer's **+** menu (#3926): a clipboard, its board
 * filled, the clip and a ticked line stroke-only.
 */
export function SignupGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M6.6 5h10.8a1.6 1.6 0 011.6 1.6v12.8a1.6 1.6 0 01-1.6 1.6H6.6A1.6 1.6 0 015 19.4V6.6A1.6 1.6 0 016.6 5z"
        {...stroke}
        {...fillProps(active)}
      />
      <path
        d="M9.4 3.4h5.2v3.2H9.4zM8.8 12.2l1.6 1.6 3-3M8.8 16.8h6.4"
        {...detail}
      />
    </Svg>
  );
}

/** `#chapter-audit` — a shield, distinct from the shell's shield-and-check Roles intent. */
export function AuditGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 3.2l7 2.6v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M9.2 10.4h5.6M9.2 13.4h3.6" {...detail} />
    </Svg>
  );
}

/** Private / role-gated channel. Body filled, shackle stroke-only. */
export function LockGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="4.8"
        y="10.5"
        width="14.4"
        height="9.5"
        rx="3"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M8.4 10.5V8a3.6 3.6 0 017.2 0v2.5" {...detail} />
    </Svg>
  );
}

/** Direct / group message. Two overlapping bubbles; the leading one is filled. */
export function DirectMessageGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M3.5 8A3.5 3.5 0 017 4.5h7A3.5 3.5 0 0117.5 8v3.5A3.5 3.5 0 0114 15H8.5l-5 3.5v-3.5z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M17.5 8.6h.9a2.6 2.6 0 012.6 2.6v6.6l-2.8-2h-3.3" {...detail} />
    </Svg>
  );
}

/** Pin location on an event card. Pin body filled, dot stroke-only. */
export function LocationGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 21s-6.5-5.6-6.5-10.4a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"
        {...stroke}
        {...fillProps(active)}
      />
      <circle cx="12" cy="10.5" r="2.4" {...detail} />
    </Svg>
  );
}

/** Reply to a message. Stages an inline reply-with-quote, not a side thread. */
export function ThreadGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M9 6.5L4.5 11 9 15.5" {...detail} />
      <path d="M4.5 11h9.7a5.3 5.3 0 015.3 5.3v1.9" {...detail} />
    </Svg>
  );
}

/**
 * Start a thread (#3785, #4034): a side conversation off a message, where
 * {@link ThreadGlyph}'s Reply quotes it in the channel. A speech bubble
 * (filled when `active`) with a reply branching from under it and running on
 * to the right. One bubble, so it doesn't read as {@link DirectMessageGlyph}'s
 * overlapping pair, and no bell: Follow stays text, since the bell is the
 * notification inbox's (#3362).
 */
export function StartThreadGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M6.5 3.5h9A2.5 2.5 0 0118 6v3.5a2.5 2.5 0 01-2.5 2.5H10l-3.5 2.6V12A2.5 2.5 0 014 9.5V6a2.5 2.5 0 012.5-2.5z"
        {...stroke}
        {...fillProps(active)}
      />
      <path
        d="M13.5 12v3a3 3 0 003 3h3.5M18 15.8l2.2 2.2-2.2 2.2"
        {...detail}
      />
    </Svg>
  );
}

/**
 * Notification level (#296). A speaker (a box and its cone, split by a detail
 * stroke) with two sound waves; `active` means muted, and an × replaces the
 * waves so the muted state reads at a glance rather than only through the
 * label beside it. The box, the split and the second wave are what tell it
 * from {@link AnnouncementGlyph}, a single flared horn with one wave.
 *
 * A speaker, not a bell, since #3362: the bell is the notification inbox's
 * glyph (`NotificationsGlyph` in the top bar, and on the phone's Chat home), so
 * a channel's alert level must not draw the same silhouette.
 */
export function MuteGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 01-1-1v-3a1 1 0 011-1z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M7.5 9.5v5" {...detail} />
      {active ? (
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" {...detail} />
      ) : (
        <path
          d="M15.5 9.2a4 4 0 010 5.6M18 6.8a7.4 7.4 0 010 10.4"
          {...detail}
        />
      )}
    </Svg>
  );
}

/**
 * Rush / recruitment candidate card. Funnel silhouette — the module catalog
 * names this intent `funnel` (`packages/org-archetypes`). Not a nav intent, so
 * it lives here rather than in `nav-glyphs.tsx`.
 */
export function RushGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M4.5 4.5h15l-4.2 7.2v6.3l-6.6 1.5V11.7z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M7.4 8.8h9.2" {...detail} />
    </Svg>
  );
}
