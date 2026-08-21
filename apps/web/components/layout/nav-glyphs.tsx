/**
 * Signet duotone glyphs for the dashboard shell — sidebar nav and top-bar
 * controls.
 *
 * Recipe (`spec/ui/design-system/iconography.md` §1): 1.6px stroke on a 24px
 * grid with rounded caps and joins; the icon's primary silhouette carries a
 * low-opacity fill of the glyph's own hue — white at 6% when neutral, the
 * stroke hue at 18% when active — and detail strokes (clock hands, calendar
 * rules, checkmarks, bell clappers) stay stroke-only. A state change recolors
 * the one glyph; there is no second, filled variant to swap to.
 *
 * Geometry is transcribed from the committed reference boards — the chat /
 * calendar / check-circle silhouettes match `apps/mobile/components/tab-glyphs.tsx`
 * (itself transcribed from `canvas-screens.dc.html`), and the study clock,
 * document, directory, dues card, bell, and search shapes come from the s09 /
 * s04 screens. Glyphs the reference does not draw (star, shield, pin, book,
 * polls, reports, service, gear) are drawn fresh in the same recipe. The
 * intent → glyph map lives in `iconography.md` §6.2 and MUST be updated in the
 * same PR as any change here.
 *
 * These are shell chrome. In-screen icons stay on the Lucide interim pack
 * (`iconography.md` §5) until each screen family's #920 slice lands.
 */

export type NavGlyphProps = {
  className?: string;
  /**
   * Emphasis state. The parent that knows selection passes it down
   * (`ProtectedNavItem` does); the fill hue follows `currentColor`, so the
   * accent comes from the text color the parent already sets.
   */
  active?: boolean;
};

export type NavGlyphComponent = (props: NavGlyphProps) => React.ReactNode;

/** Silhouette fill per state: white 6% neutral, stroke-hue 18% active. */
function fillProps(active: boolean | undefined) {
  return active
    ? { fill: "currentColor", fillOpacity: 0.18 }
    : { fill: "#FFFFFF", fillOpacity: 0.06 };
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const detail = { ...stroke, fill: "none" } as const;

function Svg({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ── Sidebar nav intents ─────────────────────────────────────────────────── */

export function ChatGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M4 6.5A3.5 3.5 0 017.5 3h9A3.5 3.5 0 0120 6.5v6a3.5 3.5 0 01-3.5 3.5H10l-4.5 4v-4A3.5 3.5 0 014 12.5z"
        {...stroke}
        {...fillProps(active)}
      />
    </Svg>
  );
}

export function EventsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="4"
        y="5"
        width="16"
        height="15"
        rx="3.5"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M4 9.5h16M8.5 3v4M15.5 3v4" {...detail} />
    </Svg>
  );
}

export function TasksGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...stroke} {...fillProps(active)} />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" {...detail} />
    </Svg>
  );
}

export function PointsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 3.5l2.3 4.9 5.2.6-3.9 3.6 1.1 5.2-4.7-2.7-4.7 2.7 1.1-5.2-3.9-3.6 5.2-.6z"
        {...stroke}
        {...fillProps(active)}
      />
    </Svg>
  );
}

export function StudyGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...stroke} {...fillProps(active)} />
      <path d="M12 7.5V12l3 2" {...detail} />
    </Svg>
  );
}

export function ServiceGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 20.2s-6.8-4.2-8.7-8.2a4.9 4.9 0 018.7-4.5 4.9 4.9 0 018.7 4.5c-1.9 4-8.7 8.2-8.7 8.2z"
        {...stroke}
        {...fillProps(active)}
      />
    </Svg>
  );
}

export function PollsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M8.2 16v-3.5M12 16V8M15.8 16v-5.5" {...detail} />
    </Svg>
  );
}

export function DocumentsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M6 3.5h8l4 4V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 20V5A1.5 1.5 0 016.5 3.5z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M14 3.5V8h4.5" {...detail} />
    </Svg>
  );
}

export function BackworkGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 6.4C10.4 4.9 8.4 4.4 4 4.4v14.2c4.4 0 6.4.5 8 2 1.6-1.5 3.6-2 8-2V4.4c-4.4 0-6.4.5-8 2z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M12 6.4v14.2" {...detail} />
    </Svg>
  );
}

export function DirectoryGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="9" r="3.4" {...stroke} {...fillProps(active)} />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" {...detail} />
      <circle cx="16.5" cy="10" r="2.6" {...detail} />
      <path d="M16 15.5c2.4 0 4 1.4 4.5 3.5" {...detail} />
    </Svg>
  );
}

export function BillingGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="3.5"
        y="6"
        width="17"
        height="12.5"
        rx="3"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M3.5 10h17" {...detail} />
    </Svg>
  );
}

export function RolesGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 3.2l7 2.6v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M9 11.8l2.2 2.2 4-4.5" {...detail} />
    </Svg>
  );
}

export function StudyZonesGlyph({ className, active }: NavGlyphProps) {
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

export function ReportsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M7.5 14.8l3-3 2.5 2 3.5-4.3" {...detail} />
    </Svg>
  );
}

export function SettingsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M10.7 3.2h2.6l.5 2.2a7 7 0 012 1.2l2.1-.8 1.3 2.3-1.7 1.5a7.2 7.2 0 010 2.3l1.7 1.5-1.3 2.3-2.1-.8a7 7 0 01-2 1.2l-.5 2.2h-2.6l-.5-2.2a7 7 0 01-2-1.2l-2.1.8-1.3-2.3 1.7-1.5a7.2 7.2 0 010-2.3L4.8 8.1l1.3-2.3 2.1.8a7 7 0 012-1.2z"
        {...stroke}
        {...fillProps(active)}
      />
      <circle cx="12" cy="12" r="2.7" {...detail} />
    </Svg>
  );
}

/* ── Top-bar controls ────────────────────────────────────────────────────── */

export function SearchGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="10.5" cy="10.5" r="6.2" {...stroke} {...fillProps(active)} />
      <path d="M15.2 15.2l4.3 4.3" {...detail} />
    </Svg>
  );
}

export function NotificationsGlyph({ className, active }: NavGlyphProps) {
  return (
    <Svg className={className}>
      <path
        d="M12 3a6 6 0 016 6v3.2l1.4 2.8H4.6L6 12.2V9a6 6 0 016-6z"
        {...stroke}
        {...fillProps(active)}
      />
      <path d="M9.8 18a2.3 2.3 0 004.4 0" {...detail} />
    </Svg>
  );
}

export function MenuGlyph({ className }: NavGlyphProps) {
  // A hamburger has no silhouette to fill; its three rules are all detail
  // strokes, so this one is legitimately stroke-only under the recipe.
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" {...detail} />
    </Svg>
  );
}
