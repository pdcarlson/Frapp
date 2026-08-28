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
    // `lib/payments/*` and `lib/notifications/*` are deliberately NOT ignored:
    // after the platform split each package is reached only through a `require()`
    // in its `*-module.native.ts`, which this rule does not cover
    // (`@typescript-eslint/no-require-imports` does, disabled inline there). So
    // the guard still fires if anyone adds a real `import` back to any of them.
    ignores: ["lib/keyboard.tsx"],
    rules: {
      // `no-restricted-imports` sees static `import` declarations and `require`
      // calls, but **not** dynamic `import()` — which is precisely the form
      // someone reaching for "just make it lazy" would write, and the form that
      // puts the specifier back in the web/SSR graph and kills
      // `expo export --platform web`. This closes that hole.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression > Literal[value=/^(@stripe\\/stripe-react-native|react-native-keyboard-controller|expo-notifications)($|\\/)/]",
          message:
            "Dynamic import() of a non-Expo-Go native module is still an import. Go through the isolation module (@/lib/payments/stripe, @/lib/keyboard, @/lib/notifications/push).",
        },
      ],
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
                "Import via @/lib/payments/stripe — a direct import crashes Expo Go at launch.",
            },
            {
              group: ["expo-notifications", "expo-notifications/*"],
              message:
                "Import via @/lib/notifications/push — remote push does not run in Expo Go and the package links native modules at import.",
            },
          ],
        },
      ],
    },
  },
];
