import { config as reactInternalConfig } from "@repo/eslint-config/react-internal";
import { mobileUiSyntaxExcept, TEST_FILES } from "@repo/eslint-config/ui-rules";

/**
 * A dynamic `import()` of a non-Expo-Go native module (see the rule below).
 * Named so the spec override can keep it while dropping the emoji rule.
 */
const nativeModuleImport = {
  selector:
    "ImportExpression > Literal[value=/^(@stripe\\/stripe-react-native|react-native-keyboard-controller|expo-notifications|expo-apple-authentication|expo-audio|expo-speech-recognition|@react-native-google-signin\\/google-signin)($|\\/)/]",
  message:
    "Dynamic import() of a non-Expo-Go native module is still an import. Go through the isolation module (@/lib/payments/stripe, @/lib/keyboard, @/lib/notifications/push, @/lib/apple-auth, @/lib/google-auth, @/lib/minutes/recorder/device, @/lib/dictation/speech).",
};

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
        // The owner's UI rulings a syntax tree can check
        // (packages/eslint-config/ui-rules.js). They share this one entry
        // because a second config object setting the rule would replace it.
        ...mobileUiSyntaxExcept([]),
        nativeModuleImport,
      ],
      "no-restricted-imports": [
        "error",
        {
          // Not a native-module guard: a screen that picks React Native's
          // avoiding view itself is how the chat thread came to switch it off
          // on Android, where the app-wide KeyboardProvider stops the window
          // resizing (#3346). `KeyboardAvoidingArea` makes that choice once.
          paths: [
            {
              name: "react-native",
              importNames: ["KeyboardAvoidingView"],
              message:
                "Use KeyboardAvoidingArea from @/lib/keyboard. On Android store builds React Native's view does nothing under the app-wide KeyboardProvider.",
            },
            {
              // FRAPP-MOBILE-10: the library's scroll lock re-enters itself
              // through Reanimated's synchronous scrollTo until the stack
              // runs out. The guarded copies stop that once, for every sheet.
              name: "@gorhom/bottom-sheet",
              importNames: ["BottomSheetScrollView", "BottomSheetFlatList"],
              message:
                "Import from @/lib/sheet-scrollables: the library's own scroll lock can recurse until the app crashes (FRAPP-MOBILE-10).",
            },
          ],
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
            {
              group: ["expo-audio", "expo-audio/*"],
              message:
                "Import via @/lib/minutes/recorder/device. The recorder needs the store build's background-recording service and microphone string, so it is absent in Expo Go and on web.",
            },
            {
              group: ["expo-speech-recognition", "expo-speech-recognition/*"],
              message:
                "Import via @/lib/dictation/speech. The package reads its native module at import, which crashes Expo Go, and on web it would run the browser's recogniser, which Ask doesn't offer.",
            },
            {
              group: [
                "expo-apple-authentication",
                "expo-apple-authentication/*",
              ],
              message:
                "Import via @/lib/apple-auth — a direct import kills expo export --platform web the same way Stripe does.",
            },
            {
              group: [
                "@react-native-google-signin/google-signin",
                "@react-native-google-signin/google-signin/*",
              ],
              message:
                "Import via @/lib/google-auth — the package reads its native module at import, which crashes Expo Go and kills expo export --platform web.",
            },
          ],
        },
      ],
    },
  },
  {
    // Specs use emoji as members' own content (a reaction, a message body);
    // they keep the native-module guard. A later object replaces the rule's
    // options, so this one restates the guard (ui-rules.js).
    files: TEST_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...mobileUiSyntaxExcept(["emoji", "systemMenu"]),
        nativeModuleImport,
      ],
    },
  },
  {
    // The keyboard isolation module is outside the native-module guard above,
    // which would otherwise leave it outside the UI rules too.
    files: ["lib/keyboard.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...mobileUiSyntaxExcept([])],
    },
  },
];
