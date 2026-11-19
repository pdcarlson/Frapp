/**
 * The owner's UI rulings that a syntax tree can check (`.claude/skills/ui-development/rulebook.md`).
 *
 * Each entry is a `no-restricted-syntax` selector. They are exported as arrays,
 * not as a config object, because ESLint replaces a rule's options wholesale
 * when a later config object sets the same rule: an app that already has its
 * own `no-restricted-syntax` entries (mobile's native-module guards) spreads
 * these into that one entry instead of losing one set to the other.
 *
 * The shared config's eslint-plugin-only-warn downgrades every hit to a
 * warning, and each app's lint runs `--max-warnings 0`, so a hit still fails
 * lint and CI.
 *
 * A site that predates a rule is grandfathered by file in the app's config
 * (`ignores`), with the issue that removes it. That list only shrinks.
 */

/**
 * Pictographic emoji: Frapp draws glyphs, never emoji, in anything it writes
 * (owner rule 2026-11-05, `spec/ui/design-system/principles.md` house rules).
 * Members' own emoji are content and never sit in source. The class is the
 * characters that draw as colour emoji by default, plus the variation
 * selector that turns a text symbol into one ("❤️"), so a plain check mark,
 * an arrow or the copyright sign stays legal.
 */
const EMOJI = "/[\\p{Emoji_Presentation}\\u{FE0F}]/u";
const NO_EMOJI_MESSAGE =
  "No emoji in anything Frapp draws or writes (owner rule 2026-11-05). Use a glyph from the icon set, or plain words.";

/** @type {Array<{selector: string, message: string}>} */
export const noEmojiSyntax = [
  { selector: `JSXText[value=${EMOJI}]`, message: NO_EMOJI_MESSAGE },
  {
    selector: `JSXAttribute > Literal[value=${EMOJI}]`,
    message: NO_EMOJI_MESSAGE,
  },
  {
    selector: `JSXExpressionContainer > Literal[value=${EMOJI}]`,
    message: NO_EMOJI_MESSAGE,
  },
  {
    selector: `JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=${EMOJI}]`,
    message: NO_EMOJI_MESSAGE,
  },
];

/**
 * Web-only rulings, by name, so an app config can grandfather one file from
 * one rule without dropping the others (`webUiSyntaxExcept`).
 *
 * @type {Record<string, {selector: string, message: string}>}
 */
export const webUiRules = {
  nativeDateTime: {
    // Owner, 2026-11-16 and 2026-11-19: "time picker is horrid", no native
    // time input anywhere. The year-less DateField is the 2026-11-12 ruling.
    // `Input` too: the ShadCN wrapper passes `type` straight to the browser.
    selector:
      "JSXOpeningElement[name.name=/^[Ii]nput$/] > JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local|month|week)$/]",
    message:
      "No native date or time input on web (owner rulings 2026-11-12, 11-16, 11-19). Use DateField or TimeField from @/components/ui.",
  },
  nativeSelect: {
    // Owner, 2026-11-06: a bare native dropdown is an exposed internal and
    // doesn't feel like part of the UI.
    selector: "JSXOpeningElement[name.name='select']",
    message:
      "No native <select> (owner ruling 2026-11-06). Use Select from @/components/ui/select, or a DropdownMenu for actions.",
  },
  browserDialog: {
    // Kept drafts, never an "are you sure" (owner rulings 2026-11-13, #4857).
    // A destructive confirmation is ConfirmDialog's job, never the browser's.
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name=/^(confirm|alert|prompt)$/]",
    message:
      "No browser confirm/alert/prompt. Use useConfirmDialog from @/components/shared/confirm-dialog for a destructive step, and keep a form's draft instead of asking (owner rulings 2026-11-06, 2026-11-13).",
  },
  handRolledNewButton: {
    // Owner, 2026-11-19: every "New ..." button looks identical across the
    // app ("New minutes" was a filled pill, "+ New event" an outlined button).
    // A Button whose own text starts with "New" is a hand-rolled copy.
    selector:
      "JSXElement[openingElement.name.name='Button'] > JSXText[value=/^\\s*(\\+\\s*)?New\\s/]",
    message:
      'Every create action is the shared NewButton (<NewButton thing="event" />, @/components/ui/new-button), same look and words on every page (owner ruling 2026-11-19).',
  },
};

/**
 * Every web UI rule except the named ones, for a grandfathered file.
 *
 * @param {Array<keyof typeof webUiRules>} except
 * @returns {Array<{selector: string, message: string}>}
 */
export function webUiSyntaxExcept(except) {
  return [
    ...noEmojiSyntax,
    ...Object.entries(webUiRules)
      .filter(([name]) => !except.includes(name))
      .map(([, entry]) => entry),
  ];
}

/** @type {Array<{selector: string, message: string}>} */
export const webUiSyntax = webUiSyntaxExcept([]);

/** @type {Array<{selector: string, message: string}>} */
export const mobileUiSyntax = [...noEmojiSyntax];
