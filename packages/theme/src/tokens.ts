export const frappTokens = {
  color: {
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
  },
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
    title: 30,
    section: 18,
    body: 15,
    label: 12,
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

export type FrappTokens = typeof frappTokens;
