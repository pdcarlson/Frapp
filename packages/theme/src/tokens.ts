const SHARED_TOKENS = {
  radius: {
    sm: 8,
    md: 10,
    lg: 14,
    xl: 18,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  type: {
    display: 34,
    title: 30,
    section: 18,
    body: 15,
    meta: 13,
    label: 12,
    mono: 13,
  },
  motion: {
    duration: {
      micro: 140,
      standard: 220,
      context: 300,
    },
    easing: {
      standard: "cubic-bezier(0.16, 1, 0.3, 1)",
      entrance: "cubic-bezier(0.22, 1, 0.36, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
    },
  },
} as const;

type FrappColorPalette = {
  brand: {
    navy: string;
    royalBlue: string;
    emerald: string;
  };
  surface: {
    canvas: string;
    card: string;
    muted: string;
    border: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    inverse: string;
  };
  feedback: {
    successBackground: string;
    successBorder: string;
    successText: string;
    infoBackground: string;
    infoBorder: string;
    infoText: string;
    infoTextStrong: string;
    infoBackgroundStrong: string;
    infoBorderStrong: string;
    infoTextInteractive: string;
    warningBackground: string;
    warningBorder: string;
    warningText: string;
    errorBackground: string;
    errorBorder: string;
    errorText: string;
  };
};

export type FrappTokens = {
  color: FrappColorPalette;
} & typeof SHARED_TOKENS;

const LIGHT_COLORS: FrappColorPalette = {
  brand: {
    navy: "#0F172A",
    royalBlue: "#2563EB",
    emerald: "#10B981",
  },
  surface: {
    canvas: "#F8FAFC",
    card: "#FFFFFF",
    muted: "#F1F5F9",
    border: "#E2E8F0",
  },
  text: {
    primary: "#0F172A",
    secondary: "#475569",
    muted: "#64748B",
    inverse: "#FFFFFF",
  },
  feedback: {
    successBackground: "#DCFCE7",
    successBorder: "#86EFAC",
    successText: "#166534",
    infoBackground: "#EFF6FF",
    infoBorder: "#BFDBFE",
    infoText: "#1E3A8A",
    infoTextStrong: "#1E40AF",
    infoBackgroundStrong: "#DBEAFE",
    infoBorderStrong: "#93C5FD",
    infoTextInteractive: "#1D4ED8",
    warningBackground: "#FFFBEB",
    warningBorder: "#FDE68A",
    warningText: "#92400E",
    errorBackground: "#FEF2F2",
    errorBorder: "#FECACA",
    errorText: "#B91C1C",
  },
};

const DARK_COLORS: FrappColorPalette = {
  brand: {
    navy: "#0F172A",
    royalBlue: "#60A5FA",
    emerald: "#34D399",
  },
  surface: {
    canvas: "#0F172A",
    card: "#1E293B",
    muted: "#0B1220",
    border: "#334155",
  },
  text: {
    primary: "#F8FAFC",
    secondary: "#CBD5E1",
    muted: "#94A3B8",
    inverse: "#0F172A",
  },
  feedback: {
    successBackground: "#052E16",
    successBorder: "#166534",
    successText: "#86EFAC",
    infoBackground: "#172554",
    infoBorder: "#1E40AF",
    infoText: "#BFDBFE",
    infoTextStrong: "#DBEAFE",
    infoBackgroundStrong: "#1E3A8A",
    infoBorderStrong: "#2563EB",
    infoTextInteractive: "#93C5FD",
    warningBackground: "#451A03",
    warningBorder: "#92400E",
    warningText: "#FDE68A",
    errorBackground: "#450A0A",
    errorBorder: "#991B1B",
    errorText: "#FCA5A5",
  },
};

export const frappLightTokens: FrappTokens = {
  color: LIGHT_COLORS,
  ...SHARED_TOKENS,
};

export const frappDarkTokens: FrappTokens = {
  color: DARK_COLORS,
  ...SHARED_TOKENS,
};

export type FrappColorMode = "light" | "dark";

export function getFrappTokens(mode: FrappColorMode): FrappTokens {
  return mode === "dark" ? frappDarkTokens : frappLightTokens;
}

export const frappTokens = frappLightTokens;
