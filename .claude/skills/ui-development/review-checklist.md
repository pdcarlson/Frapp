# UI self-review, before the PR opens

Paul reviews every UI PR on his phone and on staging, and every problem he finds that this checklist
would have caught costs a round trip. A UI PR doesn't open until each step below is done, and its body
carries the evidence under a **UI self-review** heading. A step that can't be done (no phone build in a
sandbox) says so in the body with what was done instead; it never silently drops.

Run it on every screen the PR touches, and on every sibling the sweep finds.

## 1. Capture the real screens

Capture before and after, from the running app on the seeded demo chapter
([`demo-data.md` § Capture screenshots](../../../docs/guides/demo-data.md#capture-screenshots)). The
seed signs in one login, the demo president, which is the exec. On web, the member and chair captures
use **View as a role** (`spec/ui/web-dashboard/README.md`, any role's page) with the chapter's member
role and a committee chair's role; the empty capture is a fresh chapter from the onboarding wizard. On
the phone, where View as doesn't exist yet, read the member and chair layout from the screen's code and
the role gates it uses, and say so in the PR (seeded per-role logins are #5687):

| | Web (1440 wide, and beside chat at 1056+) | Phone (iPhone size) |
| --- | --- | --- |
| Average member | required | required |
| Committee chair | required | required |
| Exec | required | required |
| Nothing at all (new member, empty chapter) | required | required |

Look at every capture yourself before going on. Most of Paul's critiques are visible in a screenshot:
off-centre text, a control row under the header, two different "New" buttons, a wall of text, an empty
box. If the phone can't run in the sandbox (Expo Go needs a device), render the phone component at
phone width on web or read its layout code, and say which in the PR.

Publish the before/after as a page ([`SKILL.md` § Proposing a UI change](SKILL.md#proposing-a-ui-change)
for the rules of a mock) and link it in the PR. A capture can't go into the PR body through the GitHub
MCP, so the body also states in words what changed on each screen.

## 2. Sibling sweep

The rule Paul wrote this for: never fix only the screen he named.

1. Name the defect as a pattern, not a place: "page actions on a row under the header", not "Events
   has a toolbar".
2. Find every instance on both apps. Grep for the component or class that draws it, list the routes in
   `apps/web/app/` and `apps/mobile/app/`, and look at the screens that do the same job (every list
   page, every create form, every record page).
3. Fix every instance this PR's screens own. For one held by another open PR (one open PR per screen,
   `AGENTS.md`), message that thread or note it on its PR. For the rest, file one issue per pattern
   ([`file-follow-up`](../file-follow-up/SKILL.md)) listing every file.
4. Put the table in the PR body: pattern, every place found, and fixed here / held by #N / filed as #N.

A pattern that a syntax tree can see goes into `packages/eslint-config/ui-rules.js` with the remaining
sites grandfathered by file, so it can't come back.

## 3. Walk the rulebook

Go through [`rulebook.md`](rulebook.md) section by section against the captures, and the checks in
[`principles.md`](../../../spec/ui/design-system/principles.md) P1 to P8 by id. In the PR, list only
what failed and how it was fixed or filed, by id or rulebook section. The questions that catch the most:

- **Header:** are all page actions in the header (`PageActions`), and is the create action the shared
  `NewButton` / the floating "+"? (P8)
- **Parity:** does the phone have the same structure, options, wording and order as web, in this PR?
  (P6)
- **Three people:** does the member's screen look intentional and not empty, and is the exec's first
  screenful ordered? (P5.7 to P5.9)
- **States:** loading in the loaded shape, pending in place, empty with the first action, an error in
  plain words, the failed part not reading as zero? (P1.3, P4, P5.9)
- **Rows:** compact rows not cards, long names at real scale, a long-press and right-click menu? (P3.6,
  P5, P7.4)
- **Words:** no explaining line, no abbreviation, no internal, no emoji, the same words on both apps?
  (P1, P2, P6.5)
- **Buttons:** every button sized to its label, none stretched full width across a profile, card or
  page body? (rulebook § 7)
- **Controls:** shared pickers, no native date/time/select on web, validation on blur, kept drafts, text
  centred in its box?

## 4. Use it as a member would

Do the task the screen exists for, end to end, as a member and as an officer, the way Paul will on
staging: create the thing, find it again, edit it, delete it, at real-scale data. Note anything that
took more taps than the comparable app (named in the PR) would.

## 5. Mechanical gates

- `npm run lint -w apps/web` and `npm run lint -w apps/mobile` pass, which runs the UI rules.
- The touched specs pass, including a new route's `loading.tsx` (`page-skeletons.spec.tsx`).
- A What's new line if members see the change (`packages/validation/release-notes/`).

## 6. What goes in the PR body

```
## UI self-review
- Screens: <list>, before/after page: <link>
- Captured as member / chair / exec / empty, web and phone: yes (or what was done instead)
- Comparable apps: <names and what each does>
- Sibling sweep: <table>
- Rulebook or check failures found and fixed: <ids>, or none
- Filed: #N, #N
```
