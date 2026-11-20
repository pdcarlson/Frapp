/**
 * The owner's UI rulings that a syntax tree can check
 * (`.claude/skills/ui-development/rulebook.md`, marked **lint** there).
 *
 * Each entry is a `no-restricted-syntax` selector. They are exported as arrays,
 * not as a config object, because ESLint replaces a rule's options wholesale
 * when a later config object sets the same rule: an app that already has its
 * own `no-restricted-syntax` entries (mobile's native-module guards) spreads
 * these into that one entry instead of losing one set to the other. For the
 * same reason, never add another config object that sets
 * `no-restricted-syntax` for a glob in an app: it would switch these off for
 * every file it matches. `scripts/ui-rules.test.mjs` fails if that happens.
 *
 * The shared config's eslint-plugin-only-warn downgrades every hit to a
 * warning, and each app's lint runs `--max-warnings 0`, so a hit still fails
 * lint and CI.
 *
 * A site that predates a rule is grandfathered from that rule alone, by a
 * per-file override object built with `webUiSyntaxExcept([...])` in the app's
 * config, naming the issue that removes it. Never put such a file in an
 * `ignores` list: that drops every UI rule for it. The list only shrinks.
 */

/**
 * Colour emoji: Frapp draws glyphs, never emoji, in anything it writes (owner
 * rule 2026-11-05, `spec/ui/design-system/principles.md` house rules). Members'
 * own emoji are content and never sit in product source. The class is the
 * characters that draw as colour emoji by default, plus the variation selector
 * that turns a text symbol into one, so a plain check mark, an arrow or the
 * copyright sign stays legal. It checks every string and template in a file,
 * wherever it ends up (JSX, a toast, a constant).
 */
const EMOJI = "/[\\p{Emoji_Presentation}\\u{FE0F}]/u";
const NO_EMOJI_MESSAGE =
  "No emoji in anything Frapp draws or writes (owner rule 2026-11-05). Use a glyph from the icon set, or plain words.";

const emoji = [
  { selector: `JSXText[value=${EMOJI}]`, message: NO_EMOJI_MESSAGE },
  { selector: `Literal[value=${EMOJI}]`, message: NO_EMOJI_MESSAGE },
  // `cooked`, not `raw`: an escape such as `\u{1F389}` draws the emoji too.
  {
    selector: `TemplateElement[value.cooked=${EMOJI}]`,
    message: NO_EMOJI_MESSAGE,
  },
];

const NATIVE_DATE_TIME = "/^(date|time|datetime-local|month|week)$/";
const NATIVE_DATE_TIME_MESSAGE =
  "No native date or time input on web (owner rulings 2026-11-12, 11-16, 11-19). Use DateField from @/components/ui/date-field or TimeField from @/components/ui/time-field.";

const BROWSER_DIALOG_MESSAGE =
  "No browser confirm/alert/prompt. Use useConfirmDialog from @/components/shared/confirm-dialog for a destructive step, and keep a form's draft instead of asking (owner rulings 2026-11-06, 2026-11-13).";

/**
 * Tailwind 3 wrapped a bare `--var` in an arbitrary value in `var()`; Tailwind
 * 4 doesn't, so `max-h-[--x]` compiles to `max-height: --x`, which the browser
 * drops without a word. That left every web Select with no height cap, running
 * off the window with no scroll (#5724). v4 spells it `max-h-(--x)`, or
 * `max-h-[var(--x)]`. Matches any `-[--` in a string, which is how such a
 * class reads wherever it sits (a className, `cn(...)`, a constant).
 */
const TAILWIND_BARE_VAR = "/-\\[--/";
const TAILWIND_BARE_VAR_MESSAGE =
  "Tailwind 4 doesn't wrap a bare --variable in [...] in var(), so this class compiles to nothing the browser keeps (#5724). Write it as max-h-(--x) or max-h-[var(--x)].";

/**
 * Web-only rulings, by name, so an app config can grandfather one file from
 * one rule without dropping the others (`webUiSyntaxExcept`).
 */
const webUiRules = {
  emoji,
  tailwindBareVar: [
    { selector: `Literal[value=${TAILWIND_BARE_VAR}]`, message: TAILWIND_BARE_VAR_MESSAGE },
    {
      selector: `TemplateElement[value.cooked=${TAILWIND_BARE_VAR}]`,
      message: TAILWIND_BARE_VAR_MESSAGE,
    },
  ],
  // Owner, 2026-11-16 and 2026-11-19: "time picker is horrid", no native time
  // input anywhere. The year-less DateField is the 2026-11-12 ruling. `Input`
  // too: the ShadCN wrapper passes `type` straight to the browser.
  nativeDateTime: [
    {
      selector: `JSXOpeningElement[name.name=/^[Ii]nput$/] > JSXAttribute[name.name='type'][value.value=${NATIVE_DATE_TIME}]`,
      message: NATIVE_DATE_TIME_MESSAGE,
    },
    {
      selector: `JSXOpeningElement[name.name=/^[Ii]nput$/] > JSXAttribute[name.name='type'] > JSXExpressionContainer > Literal[value=${NATIVE_DATE_TIME}]`,
      message: NATIVE_DATE_TIME_MESSAGE,
    },
  ],
  // Owner, 2026-11-06: a bare native dropdown is an exposed internal and
  // doesn't feel like part of the UI.
  nativeSelect: [
    {
      selector: "JSXOpeningElement[name.name='select']",
      message:
        "No native <select> (owner ruling 2026-11-06). Use Select from @/components/ui/select, or a DropdownMenu for actions.",
    },
  ],
  // Kept drafts, never an "are you sure" (owner rulings 2026-11-13, #4857). A
  // destructive confirmation is ConfirmDialog's job, never the browser's. A
  // bare `confirm(...)` stays legal: it is the local name callers give
  // useConfirmDialog's function.
  browserDialog: [
    {
      selector:
        "CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(confirm|alert|prompt)$/]",
      message: BROWSER_DIALOG_MESSAGE,
    },
    {
      selector:
        "CallExpression[callee.type='Identifier'][callee.name=/^(alert|prompt)$/]",
      message: BROWSER_DIALOG_MESSAGE,
    },
  ],
};

/**
 * Every web UI rule except the named ones, for a grandfathered file.
 *
 * @param {Array<keyof typeof webUiRules>} except
 * @returns {Array<{selector: string, message: string}>}
 */
export function webUiSyntaxExcept(except) {
  return [
    ...Object.entries(webUiRules)
      .filter(([name]) => !except.includes(name))
      .flatMap(([, entries]) => entries),
  ];
}

/** @type {Array<{selector: string, message: string}>} */
export const webUiSyntax = webUiSyntaxExcept([]);

/**
 * The phone's rules, by the same names.
 *
 * @param {Array<"emoji">} except
 * @returns {Array<{selector: string, message: string}>}
 */
export function mobileUiSyntaxExcept(except) {
  return except.includes("emoji") ? [] : [...emoji];
}

/**
 * Specs and tests use emoji as members' own content (a reaction, a message
 * body), so they are checked with `except: ["emoji"]`.
 */
export const TEST_FILES = ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"];
