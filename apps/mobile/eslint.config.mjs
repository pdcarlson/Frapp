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
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/keyboard.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native-keyboard-controller",
              message:
                "Import via @/lib/keyboard — a direct import crashes Expo Go at launch.",
            },
            {
              name: "@stripe/stripe-react-native",
              message:
                "Import via the payments isolation module (lib/payments/stripe.ts, later slice) — a direct import crashes Expo Go at launch.",
            },
          ],
        },
      ],
    },
  },
];
