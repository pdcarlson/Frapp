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
 * Web-only rulings, by name, so an app config can grandfather one file from
 * one rule without dropping the others (`webUiSyntaxExcept`).
 */
const webUiRules = {
  emoji,
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

// One component per job (owner, 2026-11-20: "12 different ways of doing
// dropdowns and menus and settings ... every screen you go to is a different
// fucking system"). Rulebook § 9 and `spec/ui/design-system/components.md`.
const MORE_MENU_MESSAGE =
  "One action menu (owner ruling 2026-11-20). A row's ⋯ is RowMenu, a header's ⋯ is ActionMenuButton, both from @/components/shared/row-menu, so right-click, hover ⋯ and header ⋯ show the same list.";
webUiRules.moreMenu = [
  {
    selector:
      "JSXOpeningElement[name.name=/^(MoreHorizontal|MoreVertical|Ellipsis|EllipsisVertical)$/]",
    message: MORE_MENU_MESSAGE,
  },
  {
    selector: "ImportDeclaration[source.value='@/components/ui/context-menu']",
    message: MORE_MENU_MESSAGE,
  },
];

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

const PHONE_MENU_MESSAGE =
  "One action menu on the phone (owner ruling 2026-11-20): the glass menu, through useItemMenu / ItemActionsMenu from components/item-actions-menu (long-press and every ⋯), and OptionSheet to pick a value. Never the system action sheet or an Alert with a list of choices.";

/** The phone's rulings, by name, as `webUiRules`. */
const mobileUiRules = {
  emoji,
  systemMenu: [
    {
      selector: "ImportSpecifier[imported.name='ActionSheetIOS']",
      message: PHONE_MENU_MESSAGE,
    },
    {
      selector: "ImportDeclaration[source.value=/(^|\\/)action-menu$/]",
      message: PHONE_MENU_MESSAGE,
    },
    // An Alert is a notice or a yes/no confirm: two buttons at most. Three or
    // more is a menu drawn by the system.
    {
      selector:
        "CallExpression[callee.object.name='Alert'][callee.property.name='alert'] > ArrayExpression[elements.length>2]",
      message: PHONE_MENU_MESSAGE,
    },
  ],
};

/**
 * Every phone UI rule except the named ones.
 *
 * @param {Array<keyof typeof mobileUiRules>} except
 * @returns {Array<{selector: string, message: string}>}
 */
export function mobileUiSyntaxExcept(except) {
  return Object.entries(mobileUiRules)
    .filter(([name]) => !except.includes(name))
    .flatMap(([, entries]) => entries);
}

/**
 * Specs and tests use emoji as members' own content (a reaction, a message
 * body), so they are checked with `except: ["emoji"]`.
 */
export const TEST_FILES = ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"];
