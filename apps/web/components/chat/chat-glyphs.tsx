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
 * The four silhouettes chat shares with the shell's nav intents (events, tasks,
 * points, search) are re-exported rather than redrawn — a second copy of the
 * same path data is exactly the drift §1 rule 1 bans.
 */

import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  EventsGlyph,
  PointsGlyph,
  SearchGlyph,
  TasksGlyph,
} from "@/components/layout/nav-glyphs";

export type ChatGlyphProps = DuotoneGlyphProps;

/** Pinned message — pin body filled, needle stroke-only. */
export function PinGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M9 3.5h6l-.8 5.2 3 3.1H6.8l3-3.1z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M12 11.8V20.5" {...detail} />
    </Svg>
  );
}

/**
 * Attach a file.
 *
 * Stroke-only, like `SendGlyph` and the shell's `MenuGlyph`: a paperclip is an
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

/**
 * Send. Transcribed from the s05 composer's send glyph
 * (`canvas-screens.dc.html:189`, `M2.5 8.5h9M8 3.5l6 5-6 5` on a 17 grid),
 * rescaled onto the 24 grid the recipe fixes. Arrow strokes carry no
 * silhouette, so this one is legitimately stroke-only — the same exception
 * `MenuGlyph` documents in the shell.
 */
export function SendGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 12h12.7M11.3 5l8.5 7-8.5 7" {...detail} />
    </Svg>
  );
}

/** Add a reaction. Face filled, features stroke-only. */
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
 * Slash commands. Deliberately not a sparkle: ✦ is claimed by the Ask/AI
 * affordance and "MUST NOT mark anything that is not an Ask/AI entry point or
 * answer" (`components.md` §11). A slash palette is a command launcher, so it
 * takes a command silhouette with a literal `/` as its detail stroke.
 */
export function SlashCommandGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="3.5"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M13.6 8.4l-3.2 7.2" {...detail} />
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

/** Connection lost. Cloud filled, the slash is a detail stroke. */
export function OfflineGlyph({ className, active }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M7.5 18.5a4 4 0 01-.4-8A5.5 5.5 0 0117.7 11a3.8 3.8 0 01-.2 7.5z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M4.5 4.5l15 15" {...detail} />
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

/** Reply in thread. */
export function ThreadGlyph({ className }: ChatGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M9 6.5L4.5 11 9 15.5" {...detail} />
      <path d="M4.5 11h9.7a5.3 5.3 0 015.3 5.3v1.9" {...detail} />
    </Svg>
  );
}
