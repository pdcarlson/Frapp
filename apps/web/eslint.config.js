import { nextJsConfig } from "@repo/eslint-config/next-js";
import {
  TEST_FILES,
  webUiSyntax,
  webUiSyntaxExcept,
} from "@repo/eslint-config/ui-rules";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Vendored pdf.js data copied from node_modules at build time
  // (scripts/copy-pdfjs-assets.mjs); gitignored, not our code.
  { ignores: ["public/pdfjs/**"] },
  ...nextJsConfig,
  {
    // Build-time config files run in Node, not the browser, so `process` is a
    // real global here. The shared Next preset targets app code, where it is not.
    files: ["*.config.js", "*.config.mjs", "*.config.ts"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
  {
    // Loaded by next.config.js. Node ESM, not a client module.
    files: ["lib/assert-production-public-env.js"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
  {
    files: ["components/ui/**/*.tsx"],
    rules: {
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
  },
  {
    // The owner's UI rulings a syntax tree can check (packages/eslint-config/ui-rules.js,
    // .claude/skills/ui-development/rulebook.md).
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...webUiSyntax],
    },
  },
  {
    // Specs use emoji as members' own content; every other UI rule applies.
    files: TEST_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...webUiSyntaxExcept(["emoji"])],
    },
  },
  // Files that predate a rule, grandfathered from that rule alone until the
  // issue beside them lands; every other UI rule still applies. This list only
  // shrinks: never add a file to pass lint.
  ...Object.entries(
    groupByFile({
      // Not grandfathered: the emoji picker's own data is members' content.
      emoji: ["lib/chat/drawable-emoji.ts"],
      // #5682: native date and time inputs onto DateField / TimeField.
      nativeDateTime: [
        "components/tasks/due-time-control.tsx",
        "components/meetings/minutes-details-dialog.tsx",
        "components/meetings/minutes-page.tsx",
        "components/chat/message-reminder-menu.tsx",
        "components/chat/schedule-send.tsx",
        "components/chat/event-quick-form.tsx",
        "components/chat/signup-form.tsx",
        "components/events/event-editor-dialog.tsx",
        "components/personal-settings/quiet-hours-section.tsx",
      ],
    }),
  ).map(([file, except]) => ({
    files: [file],
    rules: {
      "no-restricted-syntax": ["error", ...webUiSyntaxExcept(except)],
    },
  })),
];

/**
 * `{ rule: [files] }` to `{ file: [rules] }`, so a file grandfathered from two
 * rules gets one config object (a second would replace the first's options).
 *
 * @param {Record<string, string[]>} byRule
 * @returns {Record<string, string[]>}
 */
function groupByFile(byRule) {
  /** @type {Record<string, string[]>} */
  const byFile = {};
  for (const [rule, files] of Object.entries(byRule)) {
    for (const file of files) (byFile[file] ??= []).push(rule);
  }
  return byFile;
}
