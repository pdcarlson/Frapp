import type { Config } from "tailwindcss";
import { frappTokens } from "./tokens";

const motionDuration = frappTokens.motion.duration;
const motionEasing = frappTokens.motion.easing;

const config: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        /*
         * Named brand colors (for direct use: text-navy, bg-royal-blue,
         * etc.). The KEYS are preserved so existing utility classes
         * (`text-navy-900`, `bg-royal-blue`) keep compiling, but the
         * VALUES now map to the bone / bronze / ink palette. Mark the
         * "navy" key as ink and "royal-blue" as bronze in your mental
         * model — the chat-first redesign no longer ships with blue.
         *
         * The TS tokens in `tokens.ts` now carry honest names (`ink`,
         * `bronze`, `moss`) with the old ones kept as deprecated aliases.
         * These Tailwind scale keys deliberately did NOT follow, and adding
         * honest aliases here would be worse than leaving them: `emerald`
         * overrides only DEFAULT/50/100/400/500/600, so `emerald-300`,
         * `emerald-700`, and `emerald-900` — all in live use — fall through
         * to stock Tailwind green. A `moss` alias built from the five
         * overridden steps would therefore render `moss-700` at a different
         * color than `emerald-700`. Renaming these is web/landing reskin
         * work, done when the class sites move with them.
         */
        navy: {
          DEFAULT: "#1F1A15", /* ink */
          50: "#FAF7F2",
          100: "#F2EEE7",
          800: "#2A241D",
          900: "#1F1A15",
          950: "#0F0C09",
        },
        "royal-blue": {
          DEFAULT: "#7A5A2F", /* bronze */
          50: "#F5EFE3",
          100: "#E5DCC6",
          400: "#B89A6B",
          500: "#9A7A45",
          600: "#7A5A2F",
          700: "#5C4423",
        },
        emerald: {
          DEFAULT: "#3D6B4A", /* moss */
          50: "#E6F0E4",
          100: "#CFE0CC",
          400: "#6E9C7B",
          500: "#52805F",
          600: "#3D6B4A",
        },
        /* Sidebar tokens (always dark ink) — driven by CSS variables. */
        side: {
          bg: "hsl(var(--side-bg))",
          "bg-hi": "hsl(var(--side-bg-hi))",
          fg: "hsl(var(--side-fg))",
          "fg-hi": "hsl(var(--side-fg-hi))",
          muted: "hsl(var(--side-muted))",
          divider: "hsl(var(--side-divider))",
          accent: "hsl(var(--side-accent))",
        },

        /* ── Semantic tokens (mapped to CSS variables for ShadCN compatibility) ── */
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "hsl(var(--primary-50))",
          100: "hsl(var(--primary-100))",
          200: "hsl(var(--primary-200))",
          300: "hsl(var(--primary-300))",
          400: "hsl(var(--primary-400))",
          500: "hsl(var(--primary-500))",
          600: "hsl(var(--primary-600))",
          700: "hsl(var(--primary-700))",
          800: "hsl(var(--primary-800))",
          900: "hsl(var(--primary-900))",
          950: "hsl(var(--primary-950))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "count-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-100%)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-up": `fade-up ${motionDuration.context}ms ${motionEasing.standard} forwards`,
        "fade-in": `fade-in ${motionDuration.standard}ms ${motionEasing.standard} forwards`,
        "count-up": `count-up ${motionDuration.standard}ms ${motionEasing.standard} forwards`,
        "slide-down": `slide-down ${motionDuration.context}ms ${motionEasing.entrance} forwards`,
        "slide-in-right": `slide-in-right ${motionDuration.context}ms ${motionEasing.entrance} forwards`,
      },
    },
  },
};

export default config;
