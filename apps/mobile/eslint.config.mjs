import { config as reactInternalConfig } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...reactInternalConfig,
  {
    files: ["*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },
  {
    // Non-Expo-Go native modules crash Go at launch if imported directly
    // (#937 Expo Go rules). They live behind isolation modules with a runtime
    // execution-environment check; only those files may touch the raw package.
    // `patterns` (not `paths`) so subpath imports are caught too. Severity
    // renders as a warning because the shared config's eslint-plugin-only-warn
    // downgrades everything process-wide — enforcement still holds: the lint
    // script runs `--max-warnings 0`, so any hit fails lint and CI.
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: ["lib/keyboard.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react-native-keyboard-controller",
                "react-native-keyboard-controller/*",
              ],
              message:
                "Import via @/lib/keyboard — a direct import crashes Expo Go at launch.",
            },
            {
              group: [
                "@stripe/stripe-react-native",
                "@stripe/stripe-react-native/*",
              ],
              message:
                "Import via the payments isolation module (lib/payments/stripe.ts, later slice) — a direct import crashes Expo Go at launch.",
            },
          ],
        },
      ],
    },
  },
];
