# Drift found

Every place in the code that breaks the system, counted per rule, so each count can become a check that only lets it go down. Measured on `main@bb0805b`, 2026-11-20, by reproducible `rg` commands run from the repo root; nothing in the repo was changed.

**How to read it.** A count is exact unless its note says "proxy": some rules can't be decided by a pattern, so the count is a mechanical stand-in, with the share that were true when read by hand. Ratchet a proxy on its mechanical count; fix by the hand-read list. The complete per-file lists and example lines are in three data files: `data/drift-web.json`, `data/drift-phone.json` and `data/drift-copy.json`.

## Summary

| Rule | Web | Phone | Shared code and API |
| --- | --- | --- | --- |
| No all-caps tracked labels | 115 in 77 files (W1) | 94 in 56 files (M1) | |
| Content sits in a raised group | 60 in 37 files; all 9 list pages float (W12) | 10 screens (M11) | |
| Page actions live in the header | 42 controls in 21 files; 11 of 18 pages (W7) | 13 in 6 screens (M19) | |
| One create button | 37 in 29 files, about 10 true page creates (W6) | 21 in 13 files (M6) | |
| No full-width buttons | 10 in 6 files, plus 27 in sign-in and setup (W5) | 47 in 38 files (M5) | |
| One meta line, not chips | 15 files, 6 true (W2) | 16 files, 2 true (M2) | |
| Sizes from the scale | 907 off-scale type classes in 266 files; two type scales side by side (W17) | two-line rows near 60; 37 row styles at 16 (M16) | |
| No hard-coded values | 580 in 176 files (W14) | 138 in 61 files; 21 distinct radii against 7 tokens (M13) | |
| One action menu | 16 files (W9) | 15 in 14 files (M8); 11 openers with no haptic (M17) | |
| One picker | 31 in 25 files (W10) | 30 in 24 files; 11 open full height (M9) | |
| Sheets and overlays | 1 real overlay; all 18 panels dock (W11) | 15 of 58 sheets hold several sections (M10) | |
| Settings in rows, saved on their own | 87 in 26 files, 20 Save buttons (W16) | 11 sheets, 6 with Save (M15) | |
| Loading in the loaded shape | 145 in 96 files, about 5 centred (W13) | 27 in 26 files (M12) | |
| One destructive confirm | 20 in 19 files (W18) | 21 alerts in 20 files; no shared component (M18) | |
| State facts, never narrate | 139 in 81 files, about 45% true (W8) | 47 in 35 files (M7) | 255 lines in all; 81 in shared packages (C2) |
| One notification shape | | | 41 of 50 templates break it (C1) |
| Empty states state one fact | | | 21 of 30 narrate; 12 differ between apps (C3) |
| One word per status | | | 12 states with more than one word (C4) |
| No abbreviations | 24 in 17 files (W3) | 46 in 31 files (M3) | 37 lines; the shared formatters abbreviate (C5) |
| One duration format | 26 sites, 11 shapes (W4) | 22 sites, 8 shapes (M4) | |
| One label per action | | | 9 action families with several labels (C6) |
| No emoji, Greek letters or "Signet" | 3, all Greek-letter placeholders (W15) | 1 (M14) | 8 visible hits; "Signet" on screen: 0 (C7) |
| Same words on both apps | | | 17 mismatches, such as Events and Calendar, Meetings and Minutes, Billing and Dues (C8) |

## What the counts say

- **The biggest lever is one line.** `denseListClassName` in `apps/web/components/shared/table-controls.ts` is the shared list recipe, and it has no fill and no edge. Changing it raises every web list page at once.
- **Shared components exist and aren't used.** Web's `SettingsRow` has 2 consumers, `FilterMenu` 2, `NewButton` 6, and `ActionMenuButton` none. The phone's `OptionSheet` has 7 call sites and the action bar 4. The system is mostly an adoption problem, not a design-from-nothing one.
- **Abbreviations are baked into shared helpers**, so a per-app literal check misses them: `formatPointsChip` ("+10 pts"), `eventLengthLabel` ("1.5 hrs"), `formatMinutesRounded` ("2h 30m"), `formatGraduationYear` ("'27"). Fix the helper and both apps follow.
- **Narrated copy is shared too.** The strings Paul quoted live in `packages/validation/src/meeting-copy.ts` and `meeting-recording.ts`.
- **Two type scales run side by side on web:** `text-sm` 655 against `text-label` 45; `text-xs` 114 against `text-caption` 699; `text-base` 100 against `text-body` 27.
- **The phone has two lint rules against web's six.** Nothing lints eyebrows, chips, abbreviations, button width, radii, Save buttons, pickers or haptics on either app.

## Lint rules today

From `packages/eslint-config/ui-rules.js`, with the grandfathered files in each app's config.

| Rule | App | Grandfathered files | Note |
| --- | --- | --- | --- |
| `emoji` | both | 0 | |
| `nativeDateTime` | web | 9 | 2 entries are stale: `chat/event-quick-form.tsx` and `events/event-editor-dialog.tsx` no longer have a native input |
| `nativeSelect` | web | 0 | |
| `browserDialog` | web | 0 | |
| `moreMenu` | web | 16 | all 16 still hit |
| `tailwindBareVar` | web | 0 | a build guard |
| `systemMenu` | phone | 12 | the system action sheet, `action-menu` imports, alerts with 3 or more buttons |

## Duplicates and dead code

- **Web:** `ActionMenuButton` (no call sites). `Button size="sm"` and `size="toolbar"` are the same class string. `FilterChip` (14 uses) beside `FilterMenu` (2). `Tabs` beside `SegmentedChoice` for the same job. 31 hand-written card strings outside `Card`. 28 bespoke chip and tag components. Six tracking values for one eyebrow.
- **Phone:** two `TextAction` components. Five ways to open a menu. Four chip families and about 25 files with local chip styles. Three delete-confirm mechanisms. Three sheet commit styles and three close styles. `MoreOptionsRow` has one consumer and the rulebook bans "More options". Reordering by up and down arrows in `arrange-channels.tsx` and two form sheets (the rulebook asks for drag).
- **Missing on one side:** the phone has no shared Button, Input, Label or Toast; web has no shared list row; neither has an empty-state component.

## Docs that disagree with the tokens

- `spec/ui/design-system/components.md` line 233 gives the hairline as 12%; the token is 18%. A comment in `packages/theme/src/glass.ts` calls it 8%.
- `spec/ui/design-system/writing.md` lines 3 and 9 say "Signet copy MUST"; its § 4 and § 7 approve strings the 2026-11-20 rulings reject (see Decisions, Changed).
- `spec/ui/mobile/patterns.md` § Long-press says the glass menu has no title; the code draws a caption naming the item.
- The emblem's SVG `<title>` reads "Signet" (`packages/brand-assets/assets/signet-emblem-B.svg`). It never shows as an image, but it is read aloud wherever the file is inlined.

## Seen while capturing the screens

Behaviour a script hit while driving the running apps on the seeded chapter. Each is one observation, not a count, and was not re-checked by hand: confirm before fixing.

- **Web rows with no right-click menu.** Right-clicking a task row, a Directory row and a Documents row opened nothing. Only an Activity row and a chat channel row opened a menu. The rule is that every row with actions has one.
- **Phone rows with no long-press menu.** An event row and a Directory row opened nothing (the Directory press opened the profile). A channel row, a chat message, a task row and a document row did open one.
- **Phone has no Points screen**, and `/dues` lands on You. Web has both pages.
- **The phone's Events screen is a month calendar** with the chosen day's rows under it and is titled Calendar; web's is an agenda beside a calendar and is titled Events.

## Web, rule by rule

Scope: 738 product files under `apps/web` (specs, tests and build output excluded; comment-only lines dropped).

### W1 · No all-caps tracked eyebrow labels

**115** in **77** files.

Exact for A/B/C. B also holds 3 `uppercase` without tracking (events-time-grid weekday, activity-row-lead, pro-chip has tracking). Six different tracking values are in use for the same job: 0.12em (EYEBROW), 0.06em, 0.08em, 0.04em, tracking-wide, tracking-wider.

How it was counted:

```
A) EYEBROW recipe uses: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\bEYEBROW\b' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' | rg -v 'import |export const'  B) raw class: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '(^|[\s"`:])uppercase($|[\s"`])' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' (minus ui/typography.ts)  C) rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o '<SectionLabel\b' apps/web (each renders an EYEBROW h2).
```

| File | Count |
| --- | --- |
| `apps/web/components/alumni/alumni-directory.tsx` | 5 |
| `apps/web/components/chat/channel-list.tsx` | 5 |
| `apps/web/components/onboarding/chapter-wizard.tsx` | 4 |
| `apps/web/components/activity/activity-page.tsx` | 3 |
| `apps/web/components/auth/chapter-showcase.tsx` | 3 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 3 |
| `apps/web/components/discord-import/import-states.tsx` | 3 |
| `apps/web/components/meetings/meetings-page.tsx` | 3 |
| `apps/web/components/service/service-page.tsx` | 3 |
| `apps/web/app/(dashboard)/points/page.tsx` | 2 |

…and 67 more files, all listed under `W1` in `data/drift-web.json`.

### W2 · Row metadata is one muted meta line, not 2+ chips

**43** in **15** files.

Not regex-countable. Hand-verified all 15 proxy files: 6 true row-metadata chip soup, 3 borderline (chat cards, a record header), 6 false. Misses rows that use bespoke chip components instead of Badge (PointsTag, TypeChip, DueChip, ProofBadge, TypeTag, LabelTag...; 28 distinct *Chip/*Tag/*Pill/*Badge components exist).

How it was counted:

```
Proxy: files rendering 2+ <Badge. rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o '<Badge\b' apps/web | cut -d: -f1 | sort | uniq -c | awk '$1>=2'. count = Badge elements in those files; file_count = the proxy.
```

| File | Count |
| --- | --- |
| `apps/web/components/tasks/tasks-board.tsx` | 7 |
| `apps/web/components/study/study-page.tsx` | 6 |
| `apps/web/components/tasks/task-row.tsx` | 5 |
| `apps/web/components/auth/chapter-showcase.tsx` | 3 |
| `apps/web/components/billing/invoice-list.tsx` | 2 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 2 |
| `apps/web/components/chat/channel-list.tsx` | 2 |
| `apps/web/components/chat/renderers/event-card.tsx` | 2 |
| `apps/web/components/chat/renderers/task-card.tsx` | 2 |
| `apps/web/components/discord-import/channel-mapping-step.tsx` | 2 |

…and 5 more files, all listed under `W2` in `data/drift-web.json`.

### W3 · No abbreviations in user-visible strings; dates through @repo/formatting

**24** in **17** files.

A is exact for the listed tokens and finds only 6 literal sites (2 '+N pts' in the sign-in showcase, 'min', ' h', '${secondsLeft}s', weekday:'short'); most abbreviations are produced by SHARED formatters, so a web-only ratchet on literals misses them: formatPointsChip -> '+10 pts' (packages/formatting/src/display.ts:201), formatMinutesExact/Rounded -> '2h 30m' (minutes.ts), eventLengthLabel -> '30 min' / '1.5 hrs' (packages/validation/src/event-form-rows.ts:118), formatGraduationYear -> "'27" (packages/hooks/src/profile-stats.ts:70; no direct web call, reaches web via the profile subline), formatConversationTime uses month:'short'. No date-fns/dayjs in apps/web, so no 'EEE'/'MMM' tokens. Of 

How it was counted:

```
A) literals: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -e '[0-9}] ?(pts|hrs?|mins?|secs?)\b[^-:=(\[\w]' -e '\$\{\w*([Ss]econds|[Mm]inutes|[Hh]ours)\w*\}[hms]\b' -e '\btmrw\b' -e '(weekday|month): *"(short|narrow)"' -e '\} h`' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' | rg -v className  B) calls to shared formatters whose output is abbreviated: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\b(formatPointsChip|formatMinutesExact|formatMinutesRounded|eventLengthLabel|durationLabel|hoursLabel|formatConversationTime|formatGraduationYear)\(' apps/web | rg -v 'function '  C) (listed apart, not in count) formatters bypassing @repo/formatting: rg -g '*.{ts,ts …
```

| File | Count |
| --- | --- |
| `apps/web/components/service/service-yours.tsx` | 3 |
| `apps/web/components/auth/chapter-showcase.tsx` | 2 |
| `apps/web/components/service/service-points-preview.ts` | 2 |
| `apps/web/components/study/study-page.tsx` | 2 |
| `apps/web/components/tasks/tasks-board.tsx` | 2 |
| `apps/web/components/ui/time-field.tsx` | 2 |
| `apps/web/components/auth/check-email.tsx` | 1 |
| `apps/web/components/chat/chat-shell.tsx` | 1 |
| `apps/web/components/chat/renderers/event-card.tsx` | 1 |
| `apps/web/components/chat/renderers/hours-card.tsx` | 1 |

…and 7 more files, all listed under `W3` in `data/drift-web.json`.

### W4 · Durations: one format

**26** in **13** files.

Call-site list is exact for the named helpers; the helper list itself was found by hand (grep for hour/minute/duration words), so a new hand-rolled formatter would not be caught. 10 distinct output shapes for a duration.

How it was counted:

```
rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\b(formatMinutesExact|formatMinutesRounded|eventLengthLabel|durationLabel|hoursLabel|formatServiceHours|hoursForPoints|meetingRecordingLengthLabel|lengthInWords|formatDuration|formatPaddedStopwatch|formatTimer)\(' apps/web | rg -v 'function '  plus the hand-found literals: -e 'foreground minute\$' -e '\} min or' -e '\$\{secondsLeft\}s' -e 'new Intl\.RelativeTimeFormat\('
```

| File | Count |
| --- | --- |
| `apps/web/components/meetings/recording-upload.tsx` | 7 |
| `apps/web/components/study/study-page.tsx` | 4 |
| `apps/web/components/service/service-yours.tsx` | 3 |
| `apps/web/components/service/service-points-preview.ts` | 2 |
| `apps/web/components/ui/time-field.tsx` | 2 |
| `apps/web/components/auth/check-email.tsx` | 1 |
| `apps/web/components/chat-admin/chat-report-copy.ts` | 1 |
| `apps/web/components/chat/renderers/hours-card.tsx` | 1 |
| `apps/web/components/events/event-editor-dialog.tsx` | 1 |
| `apps/web/components/service/service-leaderboard.tsx` | 1 |

…and 3 more files, all listed under `W4` in `data/drift-web.json`.

### W5 · No full-width buttons outside sign-in/setup

**10** in **6** files.

Exact for <Button> with a literal stretch class in its own tag. Misses a stretch applied through a variable/cn() helper or a parent grid. All 10 non-auth hits opened: 3 pay-invoice-dialog (dialog commits), 2 task-review (flex-1 pair), 2 bulk-upload-page, 1 activity-page are true; poll-card and signup-card are option rows drawn with Button (true stretch, arguably a row not a button). Raw <button w-full> (37) is listed apart: mostly list rows/menu items, not buttons in the rule's sense.

How it was counted:

```
rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o -e '<(Button|NewButton|[A-Z][A-Za-z]*Button)\b(?:[^>]|=>)*?[\" `](w-full|flex-1|grow|basis-full|col-span-full)[\" `]' apps/web | rg -c '^apps[^:]+:\d+:<'  (each match start = one button; the (?:[^>]|=>) class lets the tag span arrow-function props). Auth/setup = paths matching app/\(auth\)/ or components/(auth|join|onboarding)/.
```

| File | Count |
| --- | --- |
| `apps/web/components/billing/pay-invoice-dialog.tsx` | 3 |
| `apps/web/components/backwork/bulk/bulk-upload-page.tsx` | 2 |
| `apps/web/components/tasks/task-review.tsx` | 2 |
| `apps/web/components/activity/activity-page.tsx` | 1 |
| `apps/web/components/chat/renderers/poll-card.tsx` | 1 |
| `apps/web/components/chat/renderers/signup-card.tsx` | 1 |

### W6 · Create actions use NewButton; a page's main action is variant=action

**37** in **29** files.

Mechanical and over-inclusive: every hit read. ~10 are page- or section-level create actions that should be NewButton (roles-overview 'Add role', settings-fields-tab 'Add field', shared/type-list-editor 'Add type', chat-admin-page category create, members-directory 'Invite member' (filled default Button, not action), study-page 'Add a study zone' link, invoice-list 'Create the first invoice', groups-section, settings-classes-tab, event-agenda 'Add an agenda item'); ~12 are in-form row adders with a literal '+' in the label (form-builder '+ Add a question', poll-form '+ Add option', signup-form '+ Add a slot', subtask/due-time adders); the rest are form commits ('Create channel', 'Create draf

How it was counted:

```
rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o -e '<(Button|button|InlineNoteAction|Link|DropdownMenuItem)\b(?:[^>]|=>)*>(?:\s|<[A-Z][A-Za-z0-9]*\b[^>]*/>|\{[^{}]*\})*\+?\s*(New|Add|Create|Invite|Start)\b[^<{]*' apps/web | rg -c '^apps[^:]+:\d+:<'  = button-like elements whose first text is New/Add/Create/Invite/Start and that are not <NewButton>. Context counts: '<NewButton\b' and 'variant="action"'.
```

| File | Count |
| --- | --- |
| `apps/web/components/roles/roles-overview.tsx` | 3 |
| `apps/web/components/billing/invoice-list.tsx` | 2 |
| `apps/web/components/chat/form-builder.tsx` | 2 |
| `apps/web/components/discord-import/role-mapping-step.tsx` | 2 |
| `apps/web/components/events/event-agenda.tsx` | 2 |
| `apps/web/components/settings/settings-fields-tab.tsx` | 2 |
| `apps/web/components/study/study-page.tsx` | 2 |
| `apps/web/app/(auth)/sign-up/page.tsx` | 1 |
| `apps/web/components/auth/sign-in-screen.tsx` | 1 |
| `apps/web/components/chat-admin/channel-access-field.tsx` | 1 |

…and 19 more files, all listed under `W6` in `data/drift-web.json`.

### W7 · Page actions live in the header (PageActions), not a body row

**42** in **21** files.

Proxy only. 7 of 18 routed dashboard pages use PageActions (tasks, service, meetings, events, documents, backwork, points); 11 do not (activity, backwork/upload, meetings/[id], /notes, /transcript, members, preferences, profile, settings, study, whats-new). Read the top 8 hit files: true body toolbars are members/members-directory.tsx (search + filter chips + list/grid + Invite member; directory-page.tsx:107-121 documents why), billing/invoice-list.tsx (search + status filter + NewButton), chat-admin/chat-admin-page.tsx (NewButton), geofences/study-zones-manager.tsx (NewButton), reports/reports-page.tsx (report Select + export) = 5 true; the others (personal-settings/*, profile/*, roles/*) a

How it was counted:

```
Proxy: toolbar-type controls in routed feature folders that never render <PageActions>. Controls: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o -e '<(FilterMenu|FilterChip|ActiveFilterChips|Segmented|SegmentedChoice|TabsList|NewButton|ExportMenu|ListLayoutToggle|MemberSearchField|SortChip|DateFilterChip)\b|type=\"search\"|placeholder=\{?\"Search|size=\"toolbar\"' apps/web ; PageActions users: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -l '<PageActions\b' apps/web. Feature folders without it: activity, members, alumni, study, settings, roles, billing, chat-admin, reports, personal-settings, profile, geofences, whats-new, discord-import, linked-apps, and meetings/[i …
```

| File | Count |
| --- | --- |
| `apps/web/components/members/members-directory.tsx` | 12 |
| `apps/web/components/billing/invoice-list.tsx` | 8 |
| `apps/web/components/members/directory-page.tsx` | 2 |
| `apps/web/components/personal-settings/account-section.tsx` | 2 |
| `apps/web/components/profile/blocked-members-card.tsx` | 2 |
| `apps/web/components/chat-admin/channel-access-field.tsx` | 1 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 1 |
| `apps/web/components/chat-admin/chat-reports-card.tsx` | 1 |
| `apps/web/components/geofences/study-zones-manager.tsx` | 1 |
| `apps/web/components/geofences/zone-picker.tsx` | 1 |

…and 11 more files, all listed under `W7` in `data/drift-web.json`.

### W8 · State facts; no narrated or directive copy, no helper sentence under a control

**139** in **81** files.

Not regex-countable; a phrase list. Read 70 of the 139 proxy-A lines: about 30 are narration/directions, about 25 are validation or error copy that legitimately says what to do ('Pick a date.', 'Enter a valid amount'), about 15 are other false positives (labels such as 'Choose file', pointer hints such as 'Drag to resize'). So precision is roughly 45%. Recall is poor for the biggest class: settings `hint=` sentences (48, nearly all explain the control or say 'Changes are written to the chapter audit log' - 6 copies of that sentence) mostly do not contain a listed phrase. 'Try again' error copy (about 70 strings) was deliberately excluded.

How it was counted:

```
Proxy A (count): strings containing a directive/explaining phrase: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -e '["`>][^"`<>]*PH' -e '^\s+[A-Z][^=;{}]*PH' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' | rg -v 'className=|aria-label|console\.|throw |placeholder='  with PH = \b(Tap|Click|Press|Use the|Head to|Go to|Open the|Tell (the|your|them)|Check back|Come back|You can\b[^'’]|You.ll (be able|see|find|need)|to get started|get started|send it back|not posted yet|Once (you|an?|the|they)|will (appear|show up|be listed|land)|show(s)? up (here|in)|appear(s)? here|so (you|they|everyone|members) can|This (lets|means|is where|will)|Here.s|Here you|Start by|Simply|Make sure|Remember to|Don.t forget|In order to|yet\. [A-Z]|Until you|lets you|allows you|you.ll|Pick (a|an|the|o …
```

| File | Count |
| --- | --- |
| `apps/web/components/discord-import/mapping-issues.ts` | 9 |
| `apps/web/components/documents/drive-folder-panel.tsx` | 6 |
| `apps/web/components/billing/invoice-list.tsx` | 5 |
| `apps/web/components/chat/chat-shell.tsx` | 5 |
| `apps/web/app/(auth)/join/page.tsx` | 4 |
| `apps/web/components/discord-import/import-wizard.tsx` | 4 |
| `apps/web/components/backwork/backwork-upload-sheet.tsx` | 3 |
| `apps/web/components/backwork/bulk/bulk-upload-page.tsx` | 3 |
| `apps/web/components/chat/message-reminder-menu.tsx` | 3 |
| `apps/web/components/geofences/zone-map.tsx` | 3 |

…and 71 more files, all listed under `W8` in `data/drift-web.json`.

### W9 · One action menu: RowMenu / ActionMenuButton

**16** in **16** files.

Exact, and equals the 16 grandfathered files in apps/web/eslint.config.js (15 hand-drawn ⋯ + channel-row-menu's context-menu import). 16 of the 27 <DropdownMenu> roots sit in those files (row/header action menus built directly); the other 11 are legitimate value/quick-list menus (filter-menu, filter-chip, export-menu, account-menu, chapter-nav-header, calendar-subscribe-menu, upload-menu, schedule-send, message-reminder-menu, row-menu itself). <ActionMenuButton> has ZERO call sites in product code (only its spec); <RowMenu> has 13 in 9 files.

How it was counted:

```
Same selectors as lint rule moreMenu: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o -e '<(MoreHorizontal|MoreVertical|Ellipsis|EllipsisVertical)\b' -e 'from "@/components/ui/context-menu"' apps/web, minus components/shared/row-menu.tsx. DropdownMenu-as-row-menu = '<DropdownMenu\b' roots in a file that also draws a ⋯ icon.
```

| File | Count |
| --- | --- |
| `apps/web/components/ai/suggested-tasks.tsx` | 1 |
| `apps/web/components/ask/ask-proposal.tsx` | 1 |
| `apps/web/components/backwork/backwork-page.tsx` | 1 |
| `apps/web/components/chat/channel-menu.tsx` | 1 |
| `apps/web/components/chat/channel-row-menu.tsx` | 1 |
| `apps/web/components/chat/message-item.tsx` | 1 |
| `apps/web/components/documents/document-row.tsx` | 1 |
| `apps/web/components/linked-apps/discord-row.tsx` | 1 |
| `apps/web/components/linked-apps/google-calendar-row.tsx` | 1 |
| `apps/web/components/meetings/coming-up-dates.tsx` | 1 |

…and 6 more files, all listed under `W9` in `data/drift-web.json`.

### W10 · One picker per job: no native select/date/time, no hand-drawn radio list, no Done/Save/Cancel in a picker

**31** in **25** files.

A and B exact (B = 0). A finds 10 inputs in 7 files; the lint grandfather list names 9 files, so 2 entries are stale and can be deleted now: components/chat/event-quick-form.tsx and components/events/event-editor-dialog.tsx no longer contain a native date/time input. C is a proxy (13 sites); read all: chat-background-picker is a look swatch (allowed), the rest are radio lists or radio-role chip rows standing in for Select/SegmentedChoice (report-ai, report-message-dialog, forward-message-dialog, chat-level-control, chat-density-control, document-filters 'Date added', chat-search-popover, event-editor-dialog length chips, discord-import review-step + channel-mapping-step, chapter-wizard). D: 

How it was counted:

```
A) native date/time: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o '<[Ii]nput\b(?:[^>]|=>)*?type=\{?"(date|time|datetime-local|month|week)"' apps/web | rg -c '^apps[^:]+:\d+:<' (minus ui/time-field.tsx, a comment)  B) rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '<select\b' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)'  C) hand-drawn radio lists: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -e 'type="radio"' -e 'role="radiogroup"' apps/web (minus ui/segmented.tsx)  D) picker commit buttons: rg -g '*.{ts,tsx}' -g '!*.spec …
```

| File | Count |
| --- | --- |
| `apps/web/components/chat/forward-message-dialog.tsx` | 2 |
| `apps/web/components/chat/report-message-dialog.tsx` | 2 |
| `apps/web/components/chat/schedule-send.tsx` | 2 |
| `apps/web/components/meetings/minutes-details-dialog.tsx` | 2 |
| `apps/web/components/personal-settings/quiet-hours-section.tsx` | 2 |
| `apps/web/components/tasks/who-picker.tsx` | 2 |
| `apps/web/components/activity/activity-editor.tsx` | 1 |
| `apps/web/components/ai/report-ai.tsx` | 1 |
| `apps/web/components/backwork/bulk/drafts-review.tsx` | 1 |
| `apps/web/components/billing/pay-invoice-dialog.tsx` | 1 |

…and 15 more files, all listed under `W10` in `data/drift-web.json`.

### W11 · No overlay side cards: every Sheet use, every Panel not docked

**6** in **6** files.

Exact. 18 Panel roots: 14 literal `docked`, 4 forward a `docked` prop that defaults to false, 0 with none. All 10 call sites of those 4 wrappers pass docked or docked="here", so no Panel opens as an overlay today; the default-false prop and Panel's own `docked = false` default are the remaining way one could. Real overlay side cards: 1 (the narrow-window nav drawer). File names still say sheet/drawer/dialog (event-detail-sheet, member-detail-sheet, create-channel-sheet, backwork-upload-sheet, backwork-taxonomy-drawer, event-editor-dialog, invite-member-dialog) though all are docked panels.

How it was counted:

```
A) rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n 'from "@/components/ui/sheet"' apps/web  B) Panel roots: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o '<Panel\b(?:[^>]|=>)*?>' apps/web, classified by whether the tag carries a bare `docked`, `docked={docked}`, or nothing. count = sheet importers + Panel roots without a literal docked.
```

| File | Count |
| --- | --- |
| `apps/web/components/chat-admin/create-channel-sheet.tsx` | 1 |
| `apps/web/components/events/event-detail-sheet.tsx` | 1 |
| `apps/web/components/events/event-editor-dialog.tsx` | 1 |
| `apps/web/components/layout/dashboard-shell.tsx` | 1 |
| `apps/web/components/members/member-detail-sheet.tsx` | 1 |
| `apps/web/components/shared/panel.tsx` | 1 |

### W12 · Content sits on a raised/bordered surface; rows are rows, not a card each

**60** in **37** files.

Proxy. A: the shared list recipe itself is the drift, so every list page inherits it; read 8 list pages (tasks, events, meetings, documents, members, service, backwork, activity, points): 7 use denseListClassName directly on the page background, meetings uses a bare 'divide-y divide-border', tasks uses its own TASK_ROWS_CLASS; none wraps the list in a bordered/raised group, so 8 of 8 true. B: about 20 of 227 <li>; read 8: tasks-board grid tile, events-page, schedule-send, marked-strip, event-agenda, suggested-events are true card-per-row; composer (staged file chips) and time-field are not rows, so about 6 of 8. Rows built from <div>/<button>/<tr> and Card-per-row via a child component are n

How it was counted:

```
A) lists on the bare page background: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\bdenseListClassName\b' apps/web | rg -v 'import|export const' (minus *skeleton* files). The recipe (components/shared/table-controls.ts:151) is 'divide-y divide-border border-t border-border': hairline rows with a top rule, no fill, no side or bottom edge, no radius.  B) a card around each row: <li> opening tags (multi-line, rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o '<li\b(?:[^>]|=>)*?>' apps/web) whose classes hold rounded-* and (border | bg-card | bg-surface* | bg-muted | bg-popover).
```

| File | Count |
| --- | --- |
| `apps/web/components/activity/activity-page.tsx` | 4 |
| `apps/web/components/events/events-page.tsx` | 4 |
| `apps/web/app/(dashboard)/points/page.tsx` | 3 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 3 |
| `apps/web/components/documents/document-list.tsx` | 3 |
| `apps/web/components/alumni/alumni-directory.tsx` | 2 |
| `apps/web/components/backwork/backwork-page.tsx` | 2 |
| `apps/web/components/billing/invoice-list.tsx` | 2 |
| `apps/web/components/chat/composer.tsx` | 2 |
| `apps/web/components/chat/form-responses-dialog.tsx` | 2 |

…and 27 more files, all listed under `W12` in `data/drift-web.json`.

### W13 · Loading draws the page's shape; no centered spinner, no 'Loading…' text; pending is not a spinner

**145** in **96** files.

A and B exact. Almost every Loader2 is a pending spinner inside a button (read 10: 10 of 10 were `isPending ? <Loader2 animate-spin/>` in a Button), which breaks the 'pending is gray text or a dim, no spinner' rule rather than the page-skeleton rule. Centered page/section spinners (C) are only 5: onboarding/chapter-wizard.tsx:529, backwork/bulk/bulk-upload-page.tsx:506, backwork/bulk/check-pages-dialog.tsx:224, layout/notifications-popover.tsx:399 (+1 false positive in chapter-nav-header). B includes sr-only labels (4 auth fallbacks) and lib/state-microcopy.ts strings; visible 'Loading…' lines are about 20. 126 *Skeleton component uses in 86 files show skeletons are the norm.

How it was counted:

```
A) rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o '<Loader2\b' apps/web (every spinner; '\banimate-spin\b' gives 111)  B) 'Loading…' text: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '[>"`]\s*Loading[^"`<]{0,60}(…|\.\.\.)' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)'  C) centered-spinner proxy: a <Loader2 whose previous 4 lines hold justify-center/place-items-center and no <Button (script, not a one-line rg).
```

| File | Count |
| --- | --- |
| `apps/web/components/chat/message-attachments.tsx` | 5 |
| `apps/web/components/settings/settings-classes-tab.tsx` | 4 |
| `apps/web/components/settings/settings-org-tab.tsx` | 4 |
| `apps/web/lib/state-microcopy.ts` | 4 |
| `apps/web/app/(auth)/join/page.tsx` | 3 |
| `apps/web/components/auth/sign-in-screen.tsx` | 3 |
| `apps/web/components/backwork/bulk/bulk-upload-page.tsx` | 3 |
| `apps/web/components/events/event-agenda.tsx` | 3 |
| `apps/web/components/roles/groups-section.tsx` | 3 |
| `apps/web/app/(auth)/sign-up/page.tsx` | 2 |

…and 86 more files, all listed under `W13` in `data/drift-web.json`.

### W14 · No hard-coded values in component/app files

**580** in **176** files.

Exact per regex after dropping comment lines. Hex is small and mostly legitimate data: lib/maps/readable-dark-style.ts (map style), auth/oauth-brand-icons + linked-apps/brand-marks (third-party brand colours), settings-accent-tab (swatch values), zone-map. bg-[#..]-style classes: 0; duration-[..]: 0. The 'any-[arbitrary]' total (see table) includes legitimate var()/calc()/min() values and variant selectors, so ratchet on 'literal px/rem' instead. Inline style literal check is a 4-line window heuristic (read 6: 4 were computed positions/sizes such as top/height in the time grid, 2 literal colours).

How it was counted:

```
Per category, each: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -e '<regex>' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)', counting occurrences. Regexes: hex (PCRE, -P) (?<=[\"'`\[\s:(])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=[0-9]{0,3}[a-fA-F])[0-9a-fA-F]{3,4})\b(?![\w-]) (pure-digit 3-4 char matches are issue numbers such as #4593 and are excluded by the lookahead); colour fn '\b(rgba?|hsla?|oklch|oklab)\('; text '\btext-\[[0-9.]+(px|rem|em)\]'; rounded '\brounded(-[a-z]+)?-\[[^\]]+\]'; h '\b(min-|max-)?h-\[[^\]]+\]'; w likewise; any '[a-z]-\[[^\]]+\]'; literal px '-\[[0-9.]+(px|rem|em)\]'; motion '\bduration-[0-9]+\b'; inline 'style=\{\{'. Headline count = hex + colour fn + literal px/rem arbitrary values + duration-N + inline styles with a literal.
```

| File | Count |
| --- | --- |
| `apps/web/components/chat/message-item.tsx` | 18 |
| `apps/web/lib/maps/readable-dark-style.ts` | 16 |
| `apps/web/components/settings/settings-accent-tab.tsx` | 14 |
| `apps/web/components/layout/top-bar.tsx` | 12 |
| `apps/web/components/settings/settings-skeleton.tsx` | 12 |
| `apps/web/components/events/event-editor-dialog.tsx` | 11 |
| `apps/web/components/chat-admin/chat-admin-skeleton.tsx` | 10 |
| `apps/web/components/members/directory-skeleton.tsx` | 10 |
| `apps/web/components/points/points-skeleton.tsx` | 10 |
| `apps/web/components/shared/page-skeletons.tsx` | 10 |

…and 166 more files, all listed under `W14` in `data/drift-web.json`.

### W15 · No emoji, no Greek letters, never 'Signet' in user-visible strings

**3** in **2** files.

Exact for line-level; every hit read. Emoji in strings: see emoji_code_lines (lint already blocks string literals; remaining lines are inside block comments that do not start with * or regex/data). Greek: 3 user-visible placeholders ('[Greek letters]' x3: onboarding/chapter-wizard.tsx:518,757 and settings/settings-org-tab.tsx:382), shown to every chapter including FIJI. 'Signet' in user-visible strings: 0 (all 44 mentions are comments; SignetMark is an identifier).

How it was counted:

```
Emoji: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -P '[\p{Emoji_Presentation}\x{FE0F}]' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' (same class as lint rule emoji; lib/chat/drawable-emoji.ts is the picker's data). Greek: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -P '[\x{0370}-\x{03FF}\x{1F00}-\x{1FFF}]' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)'. Signet: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\bSignet\b' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' | rg -v 'import |from "'.
```

| File | Count |
| --- | --- |
| `apps/web/components/onboarding/chapter-wizard.tsx` | 2 |
| `apps/web/components/settings/settings-org-tab.tsx` | 1 |

### W16 · Settings are SettingsGroup/SettingsRow and save on their own (no Save button)

**87** in **26** files.

apps/web/app/**/settings/** is one page.tsx that renders components/settings/settings-page.tsx, so the audit follows the component folders. SettingsGroup/SettingsRow are used in exactly 2 files (personal-settings/ai-section.tsx, read-receipts-section.tsx: 4 elements). Every other settings surface is built from <ProfileSection> (41 uses app-wide, 38 of them in settings/personal-settings/roles/profile) plus SettingsCard, SettingsListCard, SaveRow (4), FieldRow, ClassRow, GroupRow, LinkedAppRow. B: 20 Save buttons in 13 files, all read and all real (Save profile, Save identity, Save vocabulary, Save dues, Save accent color, Save mark, Save rate, Save limits, Save grace period, Save points/servi

How it was counted:

```
A) settings controls outside SettingsRow: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o '<(Switch|Select|Input|Textarea|SegmentedChoice)\b' apps/web/components/{settings,personal-settings,roles,linked-apps,geofences} in files with no '<Settings(Group|Row)\b'.  B) Save buttons: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -e '^\s*Save( changes| [a-z ]+)?\s*$' -e '>\s*Save( changes| [a-z]+)?\s*<' -e '"Save( changes| [a-z ]+)?"' same folders + profile.
```

| File | Count |
| --- | --- |
| `apps/web/components/settings/settings-org-tab.tsx` | 15 |
| `apps/web/components/settings/settings-fields-tab.tsx` | 10 |
| `apps/web/components/roles/role-page.tsx` | 6 |
| `apps/web/components/settings/settings-dues-tab.tsx` | 6 |
| `apps/web/components/roles/roles-overview.tsx` | 5 |
| `apps/web/components/settings/module-rules.tsx` | 5 |
| `apps/web/components/personal-settings/quiet-hours-section.tsx` | 4 |
| `apps/web/components/roles/groups-section.tsx` | 4 |
| `apps/web/components/settings/settings-classes-tab.tsx` | 4 |
| `apps/web/components/geofences/study-zone-editor.tsx` | 3 |

…and 16 more files, all listed under `W16` in `data/drift-web.json`.

### W17 · Type and control sizes come from the scale

**907** in **266** files.

Exact counts (comment lines included in the tables, about 2%). Two type scales run side by side: the system's roles (caption 12.5px 699, label 14px 45, body 16px 27, title 18px 18, headline 24px 17, display 32px 4 = 810) and Tailwind defaults (text-sm 655, text-xs 114, text-base 100, text-lg 12, text-xl 5, text-2xl 8, text-3xl 1 = 895) plus 19 arbitrary sizes (7.5px to 22px). The height table mixes icons and controls (h-4/h-3.5/h-3/h-5 are glyph sizes); control steps in use are h-6 (66), h-7 (25, off scale), h-8 (73), h-9/min-h-9 (90), h-10/min-h-10 (31), h-11/min-h-11 (51), h-12 (24, off scale), h-14 (22, off scale), plus h-[34px] (10 + 4 min-h), h-[26px], h-[22px], h-[18px].

How it was counted:

```
Tables: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -o --no-filename -P '(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl|caption|label|body|title|headline|display|\[[0-9.]+(?:px|rem|em)\])(?![\w-])' apps/web | sort | uniq -c ; heights likewise with '(?<![\w:-])(?:min-)?h-(\d+(?:\.\d+)?|\[[0-9.]+(?:px|rem)\]|touch)(?![\w.-])'; Button sizes 'size="[a-z-]+"'. count = type classes off the Signet role scale (Tailwind default steps + text-[..]).
```

| File | Count |
| --- | --- |
| `apps/web/components/discord-import/channel-mapping-step.tsx` | 29 |
| `apps/web/components/ask/ask-proposal.tsx` | 24 |
| `apps/web/components/onboarding/chapter-wizard.tsx` | 23 |
| `apps/web/components/discord-import/import-states.tsx` | 18 |
| `apps/web/components/discord-import/role-mapping-step.tsx` | 16 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 15 |
| `apps/web/components/chat-admin/chat-reports-card.tsx` | 14 |
| `apps/web/components/discord-import/connect-step.tsx` | 14 |
| `apps/web/components/meetings/notes-draft-panel.tsx` | 14 |
| `apps/web/components/meetings/minutes-read.tsx` | 13 |

…and 256 more files, all listed under `W17` in `data/drift-web.json`.

### W18 · Destructive actions go through useConfirmDialog and never sit in a record body/footer

**20** in **19** files.

A exact: 0 browser dialogs, 0 'are you sure' (lint holds it). B exact for a red class on the tag itself: 13 buttons in 13 files, all read: true red buttons in a record body/footer are roles/role-page.tsx:509 'Delete role', roles/presidency.tsx:202 transfer, personal-settings/account-section.tsx:86 'Delete account…', discord-import/import-states.tsx:520 'Delete import', study/study-page.tsx:700 stop session, settings/settings-chapter-mark-card.tsx:179 remove mark, shared/type-list-editor.tsx:215 delete type, backwork/backwork-taxonomy-actions.tsx:278 Merge, auth/terms-prompt.tsx:146 delete account, chat-admin-page, event-form-rows, who-picker; chat/report-message-dialog.tsx:115 is a dialog's 

How it was counted:

```
A) rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n '\b(window|globalThis|self)\.(confirm|alert|prompt)\(' apps/web | rg -v '^[^:]+:\d+:\s*(//|\*|/\*|\{/\*)' and -i 'are you sure'  B) red buttons in a body/footer: rg -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' -g '!**/tests/**' -g '!**/__fixtures__/**' -g '!**/__mocks__/**' -g '!**/node_modules/**' -g '!**/.next/**' -n -U --multiline-dotall -o '<(Button|button)\b(?:[^>]|=>)*?(variant="destructive"|text-destructive)' apps/web | rg -c '^apps[^:]+:\d+:<'  C) files calling a delete-type mutation hook '\buse(Delete|Remove|Revoke|Archive|Purge|Kick|Deactivate)[A-Z]\w*\(' with no 'useConfirmDialog|use…Flow(|useConfirm…(|confirm(' anywhere in the file (script).
```

| File | Count |
| --- | --- |
| `apps/web/components/shared/type-list-editor.tsx` | 2 |
| `apps/web/components/activity/activity-link-row.tsx` | 1 |
| `apps/web/components/auth/terms-prompt.tsx` | 1 |
| `apps/web/components/backwork/backwork-taxonomy-actions.tsx` | 1 |
| `apps/web/components/backwork/bulk/drafts-review.tsx` | 1 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 1 |
| `apps/web/components/chat/report-message-dialog.tsx` | 1 |
| `apps/web/components/chat/schedule-send.tsx` | 1 |
| `apps/web/components/discord-import/import-states.tsx` | 1 |
| `apps/web/components/events/event-form-rows.tsx` | 1 |

…and 9 more files, all listed under `W18` in `data/drift-web.json`.

## Phone, rule by rule

Scope: 633 product files under `apps/mobile/app`, `components` and `lib` (specs and tests excluded).

### M1 · No all-caps tracked eyebrow labels

**94** in **56** files.

Sum of five greps: eyebrowStyle() spreads 19 (incl. list-section.tsx's SectionHeader style), <SectionHeader> JSX call sites 56, own textTransform uppercase 4, JS .toUpperCase() on a rendered label 4, positive letterSpacing 11. All hand-checked: positive letterSpacing includes 2 code-entry fields (email-code-sign-in 8, manual-code-sheet 1) and host-check-in's code (1) plus 2 SVG wordmark attrs in chat-background.tsx, which are not labels (5 false positives). A file can be counted under two greps (e.g. eyebrowStyle + own letterSpacing).

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'eyebrowStyle\(' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<SectionHeader\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'textTransform:\s*["\x27]uppercase' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '^\s*\{?[A-Za-z_.\[\]]+\.toUpperCase\(\)\}?$|label=\{[^}]*\.toUpperCase\(\)' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'letterSpacing[:=]\s*\{?(0?\.[1-9]|[1-9])' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/components/directory/actives-filter-sheet.tsx` | 6 |
| `apps/mobile/app/(app)/(tabs)/activity.tsx` | 5 |
| `apps/mobile/app/(app)/preferences.tsx` | 5 |
| `apps/mobile/app/(app)/tasks.tsx` | 4 |
| `apps/mobile/app/(app)/chapter-settings.tsx` | 3 |
| `apps/mobile/app/(app)/minutes.tsx` | 3 |
| `apps/mobile/app/(app)/chapter-roles.tsx` | 2 |
| `apps/mobile/app/(app)/dues.tsx` | 2 |
| `apps/mobile/app/(app)/event-details.tsx` | 2 |
| `apps/mobile/app/(app)/minutes-series.tsx` | 2 |

…and 46 more files, all listed under `M1` in `data/drift-phone.json`.

### M2 · Row metadata is one muted meta line, not 2+ chips

**16** in **16** files.

Proxy = files with >=2 StatusChip/HairlineChip/AccentChip JSX elements, or a plural chip-container style. Hand-verified 10 of the proxy files: TRUE chip soup in 2 (components/minutes/minutes-row.tsx: type chip + draft/recorded StatusChip + other tags in one row; app/(app)/suggested-tasks.tsx: Who and When chips under each suggestion row) and arguably components/directory/member-profile-screen.tsx (role and group chips, content not metadata). FALSE in 7: event-excuses, balance-card, service-hours, activity-row (the 2 chips are either/or branches), task-details + open-task-screen (a single chip in a chipRow), ask-proposal (fact rows named chipRow). when-times/repeat-options/coming-up-dates/min

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<(StatusChip|HairlineChip|AccentChip)\b' apps/mobile/app apps/mobile/components apps/mobile/lib  (keep files with count>=2)  UNION  rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'styles\.(chips|tags|pills|badges|chipRow|chipsRow|metaChips|tagRow)\b' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/components/repeat-options.tsx` | 4 |
| `apps/mobile/app/(app)/event-details.tsx` | 2 |
| `apps/mobile/app/(app)/service-hours.tsx` | 2 |
| `apps/mobile/components/activity/activity-row.tsx` | 2 |
| `apps/mobile/components/ask/ask-proposal.tsx` | 2 |
| `apps/mobile/components/directory/member-profile-screen.tsx` | 2 |
| `apps/mobile/components/dues/balance-card.tsx` | 2 |
| `apps/mobile/components/events/event-excuses.tsx` | 2 |
| `apps/mobile/app/(app)/suggested-tasks.tsx` | 1 |
| `apps/mobile/app/(app)/task-details.tsx` | 1 |

…and 6 more files, all listed under `M2` in `data/drift-phone.json`.

### M3 · No abbreviations; dates/durations through @repo/formatting

**46** in **31** files.

Four greps. (a) literal abbreviations in mobile strings: 7 (hrs/hr x4 lines in study/week-summary + lib/study/format, 'pts' placeholder, pt/pts on You, '-min grace', 'hrs' unit in log-hours-sheet); (b) Intl short weekday/month: 4 lines (lib/minutes/minutes-list.ts 'Sun 5:00 PM' and 'Oct 27', events-time-grid weekday column); (c) date/time formatters NOT via @repo/formatting (toLocaleDateString/TimeString/Intl.DateTimeFormat): 19 in 14 files; all long-form except (b); (d) call sites of shared helpers that EMIT abbreviations: formatPointsChip '+10 pts', eventLengthLabel '45 min'/'1.5 hrs', formatGraduationYear "'27", formatHoursLabel '2.1 hrs', formatMinutesExact/Rounded '2h 30m': 16. No date-

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '["\x27`>][^"\x27`<]*\b(pts?|hrs?|mins?|tmrw)\b[^"\x27`]*["\x27`<]|^\s*(hrs?|pts?|mins?)\s*$|-min\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '(weekday|month):\s*["\x27](short|narrow)' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'toLocale(Date|Time)String\(|\.toLocaleString\(["\x27]en-US["\x27],\s*\{|Intl\.DateTimeFormat' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '\b(formatGraduationYear|formatPointsChip|pointsChipLabel|eventLengthLabel|formatHoursLabel|formatMinutesExact|formatMinutesRounded)\(' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/lib/minutes/minutes-list.ts` | 5 |
| `apps/mobile/app/(app)/(tabs)/you.tsx` | 3 |
| `apps/mobile/components/events/events-time-grid.tsx` | 3 |
| `apps/mobile/lib/more/service-hours.ts` | 3 |
| `apps/mobile/app/(app)/event-details.tsx` | 2 |
| `apps/mobile/components/events/events-calendar.tsx` | 2 |
| `apps/mobile/components/study/week-summary.tsx` | 2 |
| `apps/mobile/lib/directory/member-detail.ts` | 2 |
| `apps/mobile/lib/events/format.ts` | 2 |
| `apps/mobile/app/(app)/calendar-day.tsx` | 1 |

…and 21 more files, all listed under `M3` in `data/drift-phone.json`.

### M4 · One duration format

**22** in **14** files.

Every duration formatter call site, hand-read. Eight output shapes: (1) formatHoursLabel (apps/mobile/lib/study/format.ts) -> '2.1 hrs' / '1.0 hr' (You tab study + service rows); (2) formatHoursValue -> bare '2.1', followed by literal ' hrs' / ' of 5.0 hrs' in study/week-summary.tsx; (3) formatMinutesRounded (@repo/formatting) -> '2h 30m' / '45m' (study session-row, service-hours rows); (4) formatMinutesExact -> '2h 30m' (chat hours-card); (5) formatServiceHours (@repo/hooks) -> bare '2' or '2.5' then 'approved hours' / 'hrs' unit; (6) eventLengthLabel (@repo/validation) -> '45 min', '1 hr', '1.5 hrs'; (7) formatTimer -> '4:12' / '1:24:36' (study session-card, ask-dictation); local clock() i

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '\b(formatHoursValue|formatHoursLabel|formatTimer|formatPaddedStopwatch|formatServiceHours|formatMinutesRounded|formatMinutesExact|formatCountdown|eventLengthLabel|focusLine)\(|\bclock\(reading|Resend email in' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/(tabs)/you.tsx` | 5 |
| `apps/mobile/components/study/session-card.tsx` | 2 |
| `apps/mobile/components/study/week-summary.tsx` | 2 |
| `apps/mobile/lib/more/service-hours.ts` | 2 |
| `apps/mobile/lib/study/format.ts` | 2 |
| `apps/mobile/app/(app)/host-check-in.tsx` | 1 |
| `apps/mobile/app/(auth)/sign-in.tsx` | 1 |
| `apps/mobile/components/ask/ask-dictation.tsx` | 1 |
| `apps/mobile/components/chat/hours-card.tsx` | 1 |
| `apps/mobile/components/events/when-times.tsx` | 1 |

…and 4 more files, all listed under `M4` in `data/drift-phone.json`.

### M5 · No full-width buttons outside sign-in/setup

**47** in **38** files.

A column child stretches by default in React Native, so `width: '100%'` / `alignSelf: 'stretch'` greps miss almost all of it (39 hits, mostly images and gutters). Counted instead: SheetPrimaryButton call sites (43; the component is a 48pt full-width bar, components/sheet-scaffold.tsx:734) plus 4 hand-verified full-width hand-rolled primaries (check-in primaryButton, study start-card startButton, dues balance-card payButton, study session-card endButton with explicit stretch). Of the 19 block-scan candidates, 11 opened: 4 true (those), 7 false (36pt buttons inside rows: suggested-tasks, ask-in-channel, event-excuses, chat-card, catch-up x2, member-profile messageButton). Auth/onboarding liste

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<SheetPrimaryButton\b' apps/mobile/app apps/mobile/components apps/mobile/lib  PLUS hand-verified hand-rolled 48pt buttons (python block scan: style keys matching /button|cta|submit/ with height/minHeight and no width, alignSelf start/center/end or flex: 19 blocks in 16 files, saved in the method of this audit)
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/event-details.tsx` | 3 |
| `apps/mobile/app/(app)/minutes-details.tsx` | 3 |
| `apps/mobile/components/ai/report-ai-sheet.tsx` | 2 |
| `apps/mobile/components/chat/form-fill-page.tsx` | 2 |
| `apps/mobile/components/chat/message-actions-sheet.tsx` | 2 |
| `apps/mobile/components/quick-actions/meeting-actions.tsx` | 2 |
| `apps/mobile/components/study/location-primer-sheet.tsx` | 2 |
| `apps/mobile/app/(app)/check-in.tsx` | 1 |
| `apps/mobile/components/account/status-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-form-sheet.tsx` | 1 |

…and 28 more files, all listed under `M5` in `data/drift-phone.json`.

### M6 · Create actions use ScreenShell createAction / FloatingCreateButton / tab-bar +

**21** in **13** files.

Proxy: inline PlusGlyph outside the shared create button, and New/Add/Create/Invite labels on a control. Compliant baseline: createAction on 5 screens (documents, events, minutes, service-hours, tasks). Hand-read every proxy hit. Real inline/header create controls: Chat home per-section '+' New channel IconButton ((tabs)/index.tsx:1092) and its empty-state InlineNote action (:978); Messages header pencil 'New message' ((tabs)/messages.tsx:377); chapter-roles.tsx:288 inline + row; directory.tsx:583 mounts FloatingCreateButton directly (not through ScreenShell; label 'Invite members') and :385 'Add roles'; You tab ListRows 'Create a chapter' / 'Invite members' (you.tsx:440,454); chapter-link-s

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<PlusGlyph\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'label=\{?["\x27](New|Add|Create|Invite) [a-z]|label: ["\x27](New|Add|Create) [a-z]|NEW_LINK\}|MEETING_START_COPY\.start\}|MINUTES_FLOW_COPY\.start\.byHand' apps/mobile/app apps/mobile/components apps/mobile/lib  (then drop the label lines that sit inside a createAction prop: tasks.tsx, events.tsx)
```

| File | Count |
| --- | --- |
| `apps/mobile/components/events/event-agenda.tsx` | 3 |
| `apps/mobile/components/minutes/minutes-editor.tsx` | 3 |
| `apps/mobile/app/(app)/(tabs)/index.tsx` | 2 |
| `apps/mobile/app/(app)/(tabs)/you.tsx` | 2 |
| `apps/mobile/app/(app)/directory.tsx` | 2 |
| `apps/mobile/components/directory/member-profile-screen.tsx` | 2 |
| `apps/mobile/app/(app)/(tabs)/messages.tsx` | 1 |
| `apps/mobile/app/(app)/chapter-roles.tsx` | 1 |
| `apps/mobile/app/(app)/minutes-details.tsx` | 1 |
| `apps/mobile/components/activity/activity-editor.tsx` | 1 |

…and 3 more files, all listed under `M6` in `data/drift-phone.json`.

### M7 · State facts; no narrated or directive copy

**47** in **35** files.

count = directive strings matched by the phrase regex after dropping screen-reader hints and 2 code lines (47 in 35 files); roughly 44 are real user-visible directions, the rest are error recoveries where a direction is arguably the fact ('In Settings, tap Location…'). Separately, state-surface usage (the places such copy lives): ErrorState 47 call sites (title + body props), InlineNote 56, NoChapterState 7 (always directive: 'Tap the chapter menu…'), CardMessages 5; there is no component named StateBlock, state-block.tsx exports ErrorState, NoChapterState and the skeletons. Undercount: most empty-state and status copy is imported from @repo/validation constants (EVENTS_COPY, TASK_AUDIENCE_C

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '["\x27`>][^"\x27`<]*(\bTap\b|\btap (it|them|one|\+)|to get started|\bYou can\b|\byou can\b|Tell (the|your|an)|Ask (an?|your) (admin|officer|treasurer)|send it back|not posted yet|appear here|Pull down to|Press and hold|Long-press|In Settings, tap|Pick another)' apps/mobile/app apps/mobile/components apps/mobile/lib  (drop lines containing accessibilityHint; that is the directive-string count)  ALSO state-surface usage: rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<ErrorState\b' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<InlineNote\b' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<NoChapterState\b' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g  …
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/(tabs)/activity.tsx` | 3 |
| `apps/mobile/lib/auth-providers.ts` | 3 |
| `apps/mobile/lib/chat/use-chat-channel.ts` | 3 |
| `apps/mobile/app/(app)/documents.tsx` | 2 |
| `apps/mobile/app/(app)/dues.tsx` | 2 |
| `apps/mobile/app/(app)/tasks.tsx` | 2 |
| `apps/mobile/app/(auth)/chapter-picker.tsx` | 2 |
| `apps/mobile/components/chat/message-thread-screen.tsx` | 2 |
| `apps/mobile/lib/events/check-in-location.ts` | 2 |
| `apps/mobile/app/(app)/(tabs)/index.tsx` | 1 |

…and 25 more files, all listed under `M7` in `data/drift-phone.json`.

### M8 · One action menu (glass menu); no system action sheet, 3+ button Alert or sheet of actions

**15** in **14** files.

count = menu-like violations: Alert.alert with 3+ buttons or a mapped option list (5: linked-apps-section x2, series-scope, nudge-card, ask-proposal) + showActionMenu() call sites (7; lib/action-menu.ts is ActionSheetIOS on iOS and an Alert on Android) + its definition + 2 bottom sheets of actions (document-actions-sheet, composer-plus-sheet). message-actions-sheet is the rulebook's named exception. All Alert.alert: 82 calls in 48 files = 51 notices (title/message only), 26 two-button confirms or prompts, 5 menus. ActionSheetIOS appears in 2 files (lib/action-menu.ts, ask-proposal.tsx). No zeego/context-menu/@react-native-menu dependency. One RN <Modal> (task-photos.tsx lightbox, not a menu)

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'ActionSheetIOS' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'showActionMenu\(' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'Alert\.alert\(' apps/mobile/app apps/mobile/components apps/mobile/lib  (button count per Alert.alert by a balanced-paren parse of its third argument: /tmp/claude-0/-home-user-Frapp/41631046-a6cd-590e-a2ed-d83b352f1980/scratchpad/audit/alerts.py)  ; native menu libs: rg -n 'zeego|react-native-context-menu-view|@react-native-menu|action-sheet' apps/mobile/package.json (0 hits)
```

| File | Count |
| --- | --- |
| `apps/mobile/components/settings/linked-apps-section.tsx` | 2 |
| `apps/mobile/app/(app)/task-details.tsx` | 1 |
| `apps/mobile/components/activity/activity-snooze.tsx` | 1 |
| `apps/mobile/components/activity/nudge-card.tsx` | 1 |
| `apps/mobile/components/ask/ask-proposal.tsx` | 1 |
| `apps/mobile/components/chat/composer-plus-sheet.tsx` | 1 |
| `apps/mobile/components/documents/document-actions-sheet.tsx` | 1 |
| `apps/mobile/components/more/chapter-link-section.tsx` | 1 |
| `apps/mobile/components/more/invited-list.tsx` | 1 |
| `apps/mobile/components/profile/profile-photo.tsx` | 1 |

…and 4 more files, all listed under `M8` in `data/drift-phone.json`.

### M9 · Picking a value is OptionSheet; no Save/Cancel; no hand-drawn radios; no chips as form picker

**30** in **24** files.

count = hand-rolled picker sites: hand-drawn radio lists (13 sites in 12 files, excluding OptionSheet, Segmented and the two swatch pickers) + FilterChips used as a form field (8: repeat-options x3, new-task-sheet, log-hours-sheet, upload-document-sheet, new-poll-sheet, channel-form-sheet; plus when-times length chips counted under radios) + pickers/sheets with a Done or Save (9: TallSheetHeader doneAccent in who-picker, attendance, event Type, channel-access; Save in accent-sheet, status-sheet, edit-profile, member-class, member-correction, channel-form, scheduled-messages). OptionSheet itself is used at only 7 sites in 4 files (documents x4, task-follower, zone-picker-sheet, chapter-link-s

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '^\s*<OptionSheet\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'accessibilityRole="radio"' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '^\s*<FilterChips\b' apps/mobile/app apps/mobile/components apps/mobile/lib  (minus actives-filter-sheet, which is a filter)  ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'doneAccent=|label=\{[^}]*"Save"\}' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/components/repeat-options.tsx` | 3 |
| `apps/mobile/components/account/status-sheet.tsx` | 2 |
| `apps/mobile/components/chat/message-actions-sheet.tsx` | 2 |
| `apps/mobile/components/directory/member-class-sheet.tsx` | 2 |
| `apps/mobile/components/events/event-form-rows.tsx` | 2 |
| `apps/mobile/app/(auth)/create-chapter.tsx` | 1 |
| `apps/mobile/components/ai/report-ai-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-access-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-form-sheet.tsx` | 1 |
| `apps/mobile/components/chat/forward-sheet.tsx` | 1 |

…and 14 more files, all listed under `M9` in `data/drift-phone.json`.

### M10 · A sheet is one short pick or action; several sections is a pushed screen

**15** in **15** files.

Inventory, not only violations: 58 BottomSheetModal JSX sites in 57 files, 7 OptionSheet call sites, 1 RN Modal (photo lightbox), 0 expo-router modal/formSheet routes. Heights: 18 tall (100%), fixed 88% (edit-profile, member-class), 85% (forward, report-ai, message report), 65% (blocked-members), 60% (member-correction), computed (message menu), rest content-sized. count = sheets flagged as holding several sections (15): mechanical where SectionHeader+ListSection >= 2, plus forms judged by reading titles/structure (new-event, new-task, edit-profile, channel-form, new-form, new-signup, log-hours, upload-document, minutes-details, activity-sheet, actives-filter, channel-member). The judged one

How it was counted:

```
rg -l -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '^\s*<(BottomSheetModal|OptionSheet|Modal)(\s|$)' apps/mobile/app apps/mobile/components apps/mobile/lib  ; routes: rg -n 'presentation|formSheet|sheetAllowedDetents' apps/mobile/app (0 hits) ; per-file facts: python scan in the audit (snapPoints, useTallSheetProps, enableDynamicSizing, SectionHeader/ListSection counts)
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/documents.tsx` | 1 |
| `apps/mobile/components/activity/activity-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-form-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-member-sheet.tsx` | 1 |
| `apps/mobile/components/chat/message-actions-sheet.tsx` | 1 |
| `apps/mobile/components/chat/new-form-sheet.tsx` | 1 |
| `apps/mobile/components/chat/new-signup-sheet.tsx` | 1 |
| `apps/mobile/components/directory/actives-filter-sheet.tsx` | 1 |
| `apps/mobile/components/documents/upload-document-sheet.tsx` | 1 |
| `apps/mobile/components/events/new-event-sheet.tsx` | 1 |

…and 5 more files, all listed under `M10` in `data/drift-phone.json`.

### M11 · A list/section sits in a ListSection or an edged card, not on the page background; no card per row

**10** in **10** files.

Proxy flags 10 (app) screens whose rows sit straight on the page: tasks, dues (rows under the balance card), notifications, study (history under the cards), events, directory, messages, chat home, arrange-channels, calendar-day. Opened 8 (tasks, dues, notifications, study, directory, messages, index, arrange-channels): 8/8 true, rows are hairline-divided HistoryRow/TaskRow/ChannelRow on the page background with a SectionHeader eyebrow and no edged group. Screens that do use ListSection: you, preferences, chapter-settings, chapter-roles, role, role-tier, minutes, minutes-series, minutes-details, documents (10). activity, service-hours and suggested-tasks draw their own edged cards. Card aroun

How it was counted:

```
python: for each apps/mobile/app/**/*.tsx screen (no _layout, no spec) count <ListSection, <SectionHeader, *Row components, and surface refs /surfaces\.(card|raised)|pageSurfaces|useRaisedSurfaces|borderWidth/. Flag screens that render rows but have 0 ListSection and 0 surface refs. Card-per-row: scan components/**/*row*.tsx style key `row` for borderRadius+borderWidth+backgroundColor.
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/(tabs)/index.tsx` | 1 |
| `apps/mobile/app/(app)/(tabs)/messages.tsx` | 1 |
| `apps/mobile/app/(app)/arrange-channels.tsx` | 1 |
| `apps/mobile/app/(app)/calendar-day.tsx` | 1 |
| `apps/mobile/app/(app)/directory.tsx` | 1 |
| `apps/mobile/app/(app)/dues.tsx` | 1 |
| `apps/mobile/app/(app)/events.tsx` | 1 |
| `apps/mobile/app/(app)/notifications.tsx` | 1 |
| `apps/mobile/app/(app)/study.tsx` | 1 |
| `apps/mobile/app/(app)/tasks.tsx` | 1 |

### M12 · Loading draws the loaded shape; no centred spinner, no Loading… text

**27** in **26** files.

count = ActivityIndicator JSX (25 in 24 files) + visible 'Loading…' text (2: message-thread-screen 'Loading…' older replies, scheduled-messages-sheet). Skeleton usage for contrast: 194 JSX sites in 56 files. Most spinners are inline busy marks inside a button or row (ListRow busy, SheetPrimaryButton, onboarding buttons, task-action-bar), not centred page spinners; opened 8: 2 centred/region spinners (image-viewer, thread-history-edge), 6 inline-in-control. Pending-verb labels that swap a button's text ('Saving…', 'Posting…'): 22 in 21 files, which the Pending rule ('gray text or a dim in place') may also cover. 50-odd 'Loading x' strings are SkeletonRegion accessibility labels and are exclud

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<ActivityIndicator\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '["\x27`>]Loading(…|\.\.\.)' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '<Skeleton\w*|<\w+Skeleton\b' apps/mobile/app apps/mobile/components apps/mobile/lib; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '["\x27`>](Saving|Sending|Posting|Uploading|Starting|Deleting|Joining|Creating)…' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/components/events/event-agenda.tsx` | 2 |
| `apps/mobile/app/(app)/minutes-details.tsx` | 1 |
| `apps/mobile/app/(app)/notifications.tsx` | 1 |
| `apps/mobile/app/(auth)/chapter-picker.tsx` | 1 |
| `apps/mobile/app/(auth)/create-chapter.tsx` | 1 |
| `apps/mobile/app/(auth)/sign-in.tsx` | 1 |
| `apps/mobile/components/chat/block-list-notice.tsx` | 1 |
| `apps/mobile/components/chat/blocked-message-tombstone.tsx` | 1 |
| `apps/mobile/components/chat/chat-composer.tsx` | 1 |
| `apps/mobile/components/chat/image-viewer.tsx` | 1 |

…and 16 more files, all listed under `M12` in `data/drift-phone.json`.

### M13 · No hard-coded colours, sizes, radii, durations or weights outside the theme

**138** in **61** files.

Sum over seven categories (see `categories`): hex 15 in 9 files, rgba 17 in 9 files, fontSize 3 in 3 files, borderRadius 73 in 44 files, duration 10 in 8 files, fontWeight 15 in 12 files, lineHeight 5 in 4 files. The app is nearly clean on colour and type; borderRadius literals are the real drift (73 in 44 files, 21 distinct values against 7 radius tokens). Not caught by these greps: typeRole({size: N}) overrides (3: 11, 11, 9.5 badge sizes), named duration constants (FOLD_MS, SLIDE_MS… about 8; tokens.motion is referenced in only 3 files), and token arithmetic like tokens.spacing.xs + 2 (35 in 14 files). Legit literals inside the counts: OAuth brand colours (oauth-brand-icons.tsx), #FFFFFF/

How it was counted:

```
[hex] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "[\"'\`]#[0-9a-fA-F]{3,8}[\"'\`]" apps/mobile/app apps/mobile/components apps/mobile/lib ; [rgba] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "rgba?\(\s*\d" apps/mobile/app apps/mobile/components apps/mobile/lib ; [fontSize] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "fontSize:\s*\d+(\.\d+)?" apps/mobile/app apps/mobile/components apps/mobile/lib ; [borderRadius] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "border(Top|Bottom)?(Left|Right|Start|End)?Radius:\s*\d+(\.\d+)?" apps/mobile/app apps/mobile/components apps/mobile/lib ; [duration] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "duration:\s*\d+" apps/mobile/app apps/mobile/components apps/mobile/lib ; [fontWeight] rg -n -o -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' "fontWeight:\s*[\"'\d]" apps/mobile/app apps/mobile/components  …
```

| File | Count |
| --- | --- |
| `apps/mobile/components/quick-actions/quick-actions-panel.tsx` | 12 |
| `apps/mobile/components/glass-tab-bar.tsx` | 7 |
| `apps/mobile/components/ask/ask-proposal.tsx` | 6 |
| `apps/mobile/components/ask/ask-steps.tsx` | 6 |
| `apps/mobile/components/minutes/minutes-body.tsx` | 5 |
| `apps/mobile/components/minutes/recorder.tsx` | 5 |
| `apps/mobile/components/ask/ask-dictation.tsx` | 4 |
| `apps/mobile/components/auth/oauth-brand-icons.tsx` | 4 |
| `apps/mobile/components/events/events-time-grid.tsx` | 4 |
| `apps/mobile/app/(app)/host-check-in.tsx` | 3 |

…and 51 more files, all listed under `M13` in `data/drift-phone.json`.

### M14 · No emoji, Greek letters or "Signet" in user-visible strings

**1** in **1** files.

1 hit total: the placeholder a Greek-letter placeholder on the Greek-letters field of create-chapter.tsx:1182 (a field that asks for letters, so arguably content; FIJI chapters still must never see it). 0 emoji in product strings (lint-enforced; the only 2 raw matches are in comments). 0 user-visible 'Signet' (only imports and comments). Strings from shared packages are not scanned here.

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '[\x{0370}-\x{03FF}]' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '["\x27`>][^"\x27`<]*\bSignet\b[^"\x27`]*["\x27`<]' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '[\p{Emoji_Presentation}\x{FE0F}]' apps/mobile/app apps/mobile/components apps/mobile/lib  (all with comment lines dropped)
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(auth)/create-chapter.tsx` | 1 |

### M15 · Settings are ListSection + ListRow and save on their own (no Save button)

**11** in **11** files.

Settings screens themselves comply: preferences (6 ListSection/17 ListRow), chapter-settings (3/5), chapter-roles (3/7), role (3/5), role-tier (2/2), linked-apps-section, quiet-hours-section, chapter-link-section, invited-list; none has a Save. count = 11 settings surfaces that break the rule: 6 with a Save button (accent-sheet, status-sheet, edit-profile-sheet, member-class-sheet, member-correction-sheet, channel-form-sheet when editing) and 5 not built from ListSection/ListRow (chat-background-sheet, chat-density-sheet, chat-level-sheet as hand-drawn radio/swatch sheets; arrange-channels with up/down arrow IconButtons, which the reorder rule also rejects; finish-profile, a form). All Save-

How it was counted:

```
python per-file count of <ListSection / <ListRow / Save labels over app/(app)/{preferences,chapter-settings,chapter-roles,role,role-tier,arrange-channels,finish-profile}.tsx, components/settings/*, components/profile/*, components/account/*, components/more/* ; Save buttons: rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'label=\{[^}]*"Save"\}|"Save changes"' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/arrange-channels.tsx` | 1 |
| `apps/mobile/app/(app)/finish-profile.tsx` | 1 |
| `apps/mobile/components/account/status-sheet.tsx` | 1 |
| `apps/mobile/components/chat/channel-form-sheet.tsx` | 1 |
| `apps/mobile/components/directory/member-class-sheet.tsx` | 1 |
| `apps/mobile/components/directory/member-correction-sheet.tsx` | 1 |
| `apps/mobile/components/profile/edit-profile-sheet.tsx` | 1 |
| `apps/mobile/components/settings/accent-sheet.tsx` | 1 |
| `apps/mobile/components/settings/chat-background-sheet.tsx` | 1 |
| `apps/mobile/components/settings/chat-density-sheet.tsx` | 1 |

…and 1 more files, all listed under `M15` in `data/drift-phone.json`.

### M16 · Rows no taller than 56; body text no larger than 16

**2** in **2** files.

94 row styles listed in `rows` (title/meta roles are matched by style-key name within the same file, so a file with several rows shares one list; read as 'roles this file uses'). Declared minHeight > 56: 2 (activity-editor row 60, auth choice-row 64). Declared minHeights cluster at 44 (70) and 48 (10). The declared floor hides the real issue: every two-line row with paddingVertical 12 (ListRow with description, HistoryRow, TaskRow, DirectoryRow, NotificationRow, ChannelRow) lays out at about 58-60pt, estimated, not measured on a device. Type scale (packages/theme/src/signet.ts): display 32/700, headline 24/700, title 18/600, body 16/400 lineHeight 25, label 14/600, caption 12.5/400; the only

How it was counted:

```
python /tmp/claude-0/-home-user-Frapp/41631046-a6cd-590e-a2ed-d83b352f1980/scratchpad/audit/rows.py: for every style key named row/*Row with minHeight/height or paddingVertical in app/ and components/, resolve tokens (touch.minimum 44, buttonLarge 48, spacing xs4 sm8 md12 lg16 xl24) and list the typeRole of title-like and meta-like style keys in the same file
```

| File | Count |
| --- | --- |
| `apps/mobile/components/activity/activity-editor.tsx` | 1 |
| `apps/mobile/components/auth/choice-row.tsx` | 1 |

### M17 · Long-press and menus open with a haptic

**11** in **10** files.

expo-haptics is imported in exactly one file, lib/haptics.ts, which exports successHaptic (notification success), selectionHaptic (selection tick) and pressHaptic (medium impact); 60 call sites in 40 files (selection 34, success 24, press 5 including the definitions). Menus opened through useItemMenu get pressHaptic inside handle.open (item-actions-menu.tsx), chat home long-press calls pressHaptic itself, and the message long-press calls selectionHaptic in chat-thread.tsx. count = menu or long-press openers with no haptic, hand-traced (11): the 7 showActionMenu() callers (lib/action-menu.ts never fires one), Documents long-press on a folder and a document (opens document-actions-sheet), Noti

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '\b(successHaptic|selectionHaptic|pressHaptic)\(' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'onLongPress[=:]' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n 'Haptic' apps/mobile/lib/action-menu.ts apps/mobile/components/documents/document-actions-sheet.tsx (0 hits)
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/documents.tsx` | 2 |
| `apps/mobile/app/(app)/notifications.tsx` | 1 |
| `apps/mobile/app/(app)/task-details.tsx` | 1 |
| `apps/mobile/components/activity/activity-snooze.tsx` | 1 |
| `apps/mobile/components/chat/chat-composer.tsx` | 1 |
| `apps/mobile/components/more/chapter-link-section.tsx` | 1 |
| `apps/mobile/components/more/invited-list.tsx` | 1 |
| `apps/mobile/components/profile/profile-photo.tsx` | 1 |
| `apps/mobile/lib/directory/member-menu.ts` | 1 |
| `apps/mobile/lib/directory/phone-actions.ts` | 1 |

### M18 · Destructive actions confirm one way

**21** in **20** files.

Every destructive confirm is the native Alert; there is no shared confirm component (web has useConfirmDialog; the phone has nothing equivalent). count = Alert.alert calls carrying a destructive button: 21 in 20 files, of which 1 is the shared helper lib/chat/confirm-destructive.ts (confirmDestructive, used only by 3 chat wrappers: confirmDeleteMessage, confirmClosePoll, confirmCloseCard; 7 wrapper call sites) and 20 are hand-written inline Alerts with their own copy shape. Other per-feature helper modules wrap their own Alert (block-actions, hide-conversation-prompt, delete-account-prompt, member-menu, task-screen confirmTaskDelete, google-calendar-connect). One destructive flow is a bottom

How it was counted:

```
Alert.alert calls whose button array contains style: 'destructive' (parse in /tmp/claude-0/-home-user-Frapp/41631046-a6cd-590e-a2ed-d83b352f1980/scratchpad/audit/alerts.py) ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '\bconfirmDestructive\(' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '\b(confirmDeleteMessage|confirmClosePoll|confirmCloseCard)\(' apps/mobile/app apps/mobile/components apps/mobile/lib ; rg -n -l -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'delete-channel-sheet|DeleteChannelSheet' apps/mobile/app apps/mobile/components apps/mobile/lib
```

| File | Count |
| --- | --- |
| `apps/mobile/components/settings/linked-apps-section.tsx` | 2 |
| `apps/mobile/app/(app)/documents.tsx` | 1 |
| `apps/mobile/app/(app)/notifications.tsx` | 1 |
| `apps/mobile/app/(app)/study.tsx` | 1 |
| `apps/mobile/app/(app)/task-details.tsx` | 1 |
| `apps/mobile/components/activity/activity-sheet.tsx` | 1 |
| `apps/mobile/components/activity/nudge-card.tsx` | 1 |
| `apps/mobile/components/directory/member-roles-sheet.tsx` | 1 |
| `apps/mobile/components/events/calendar-subscribe-sheet.tsx` | 1 |
| `apps/mobile/components/events/new-event-sheet.tsx` | 1 |

…and 10 more files, all listed under `M18` in `data/drift-phone.json`.

### M19 · Page actions live in the header or the floating button, not on a body row

**13** in **6** files.

Proxy = search/filter/view-switch controls rendered in a screen's body: 13 sites in 6 screens (directory: SearchField x4 + FilterChips + 4 Chips; documents: SearchField + FilterChips + ChipRow; minutes: SearchField + FilterChips; chapter-roles: SearchField; messages: SearchField in a StickyHeader; notifications: Segmented). Opened all 6: all are control rows directly under the header. Caveat: rulebook § 9 currently allows the phone 'search field, one Filters chip' under the header, so SearchField alone may be compliant; the FilterChips rows (3 screens) and the Notifications Segmented are the clear hits. Baseline: ScreenShell headerAction is used by 8 screens. Not caught by the proxy, seen wh

How it was counted:

```
rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' '^\s*<(SearchField|FilterChips|Segmented|ChipRow|ListLayoutToggle)\b' apps/mobile/app ; baseline rg -n  -g '*.{ts,tsx}' -g '!*.spec.*' -g '!*.test.*' 'headerAction=' apps/mobile/app
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/directory.tsx` | 5 |
| `apps/mobile/app/(app)/documents.tsx` | 3 |
| `apps/mobile/app/(app)/minutes.tsx` | 2 |
| `apps/mobile/app/(app)/(tabs)/messages.tsx` | 1 |
| `apps/mobile/app/(app)/chapter-roles.tsx` | 1 |
| `apps/mobile/app/(app)/notifications.tsx` | 1 |

## Copy, rule by rule

Scope: `apps/web`, `apps/mobile`, `apps/api/src` and the shared packages.

### C1 · Notification: the title says what happened, the body says which item; no restating, no instructions, no abbreviations

**41** in **27** files.

How it was counted:

```
50 title/body templates read at every notifyUser/notifyMembers/notifyChapter call site in apps/api/src plus one mobile local notification; classified by hand; count = templates not OK
```

| File | Count |
| --- | --- |
| `apps/api/src/application/workers/scheduled-jobs.service.ts` | 7 |
| `apps/api/src/application/services/invite.service.ts` | 4 |
| `apps/api/src/application/services/financial-invoice.service.ts` | 3 |
| `apps/api/src/application/services/event-excuse.service.ts` | 3 |
| `apps/api/src/application/services/event-announcement.service.ts` | 3 |
| `apps/api/src/application/services/task.service.ts` | 3 |
| `apps/api/src/application/services/service-entry.service.ts` | 2 |
| `apps/api/src/application/services/meeting-draft.service.ts` | 2 |
| `apps/api/src/application/services/event-series.service.ts` | 2 |
| `apps/api/src/application/workers/discord-import-worker.service.ts` | 2 |

…and 17 more files, all listed under `C1` in `data/drift-copy.json`.

### C2 · Indicate, don't narrate: no directive or explaining sentences

**255** in **138** files.

How it was counted:

```
copy-work/c2.sh: 18 rg patterns over apps/web, apps/mobile, packages; non-comment lines holding a quote, backtick or JSX text; specs and release-notes.ts excluded; a line matching two patterns counts twice; Choose/Pick are 136 of the lines and are mostly form prompts
```

| File | Count |
| --- | --- |
| `packages/validation/src/error-copy.ts` | 23 |
| `apps/web/components/discord-import/mapping-issues.ts` | 9 |
| `packages/validation/src/meeting-recording.ts` | 7 |
| `packages/validation/src/meeting-copy.ts` | 7 |
| `apps/mobile/components/documents/upload-document-sheet.tsx` | 6 |
| `apps/web/components/discord-import/import-wizard.tsx` | 5 |
| `packages/validation/src/repeat-draft.ts` | 5 |
| `packages/hooks/src/auth-error-copy.ts` | 5 |
| `apps/web/components/meetings/recording-upload.tsx` | 4 |
| `apps/mobile/lib/notifications/push.ts` | 4 |

…and 128 more files, all listed under `C2` in `data/drift-copy.json`.

### C3 · Empty states: one factual line, the same words on web and phone

**21** in **65** files.

How it was counted:

```
python regex over every <InlineNote>…</InlineNote> in apps/web and apps/mobile (147), plus rg for literals starting No/Nothing/Nobody/None (239 lines incl. packages); 30 states compared by hand; count = states with a narrating or directing sentence on at least one app (12 differ between web and phone)
```

| File | Count |
| --- | --- |
| `apps/mobile/app/(app)/suggested-tasks.tsx` | 6 |
| `apps/web/components/chat-admin/chat-admin-page.tsx` | 6 |
| `apps/web/components/chat/chat-shell.tsx` | 6 |
| `apps/mobile/app/(app)/(tabs)/activity.tsx` | 5 |
| `apps/web/app/(dashboard)/points/page.tsx` | 5 |
| `apps/web/components/tasks/tasks-board.tsx` | 5 |
| `apps/mobile/app/(app)/directory.tsx` | 4 |
| `apps/web/components/activity/activity-page.tsx` | 4 |
| `apps/web/components/events/events-page.tsx` | 4 |
| `apps/web/components/roles/groups-section.tsx` | 4 |

…and 55 more files, all listed under `C3` in `data/drift-copy.json`.

### C4 · One status word per state, on both apps

**12** in **10** files.

How it was counted:

```
read STATUS_LABELS and every per-feature label map found by rg for exact status-word literals; count = states with more than one word in use
```

| File | Count |
| --- | --- |
| `packages/validation/src/status-labels.ts` | 6 |
| `apps/web/components/events/my-check-in.tsx` | 4 |
| `packages/hooks/src/task-card.ts` | 3 |
| `packages/validation/src/meeting-copy.ts` | 3 |
| `apps/mobile/app/(app)/event-details.tsx` | 3 |
| `apps/mobile/lib/dues/invoices.ts` | 2 |
| `apps/web/components/billing/invoice-status.ts` | 2 |
| `packages/hooks/src/service-entry-card.ts` | 1 |
| `apps/mobile/lib/tasks/task-screen.ts` | 1 |
| `packages/hooks/src/use-invites.ts` | 1 |

### C5 · No abbreviations; dates written out; one duration shape

**37** in **27** files.

How it was counted:

```
copy-work/c5.sh patterns (hrs, compact h/m, weekday/month short, dateStyle medium, class-year apostrophe; emoji-data.ts dropped) plus the tight pts search (8 lines); includes about 6 non-display lines (log messages, a Drive query, a CSV guard)
```

| File | Count |
| --- | --- |
| `packages/formatting/src/minutes.ts` | 4 |
| `apps/mobile/lib/minutes/minutes-list.ts` | 3 |
| `apps/mobile/components/study/week-summary.tsx` | 2 |
| `packages/chat-core/src/threads.ts` | 2 |
| `apps/api/src/application/services/push-copy.ts` | 2 |
| `apps/mobile/components/you/profile-sections.tsx` | 2 |
| `apps/web/components/auth/chapter-showcase.tsx` | 2 |
| `apps/mobile/lib/study/format.ts` | 1 |
| `apps/mobile/components/service-hours/log-hours-sheet.tsx` | 1 |
| `apps/api/src/application/services/chapter-points-config.service.ts` | 1 |

…and 17 more files, all listed under `C5` in `data/drift-copy.json`.

### C6 · One label per action

**9** in **0** files.

How it was counted:

```
copy-work/c6.sh: exact literal or JSX-text occurrences of 46 labels per app; count = action families with more than one label in use
```

### C7 · No emoji, no Greek letters, no 'Signet' on screen

**8** in **7** files.

How it was counted:

```
rg with Unicode ranges for emoji and dingbats and for the Greek blocks, and for 'Signet' inside string literals, over apps/web, apps/mobile, apps/api/src, packages (emoji-data.ts excluded); count = user-visible hits; Signet on screen = 0
```

| File | Count |
| --- | --- |
| `apps/web/components/onboarding/chapter-wizard.tsx` | 2 |
| `apps/api/src/application/workers/birthday-post-sweep.service.ts` | 1 |
| `apps/mobile/lib/tasks/format.ts` | 1 |
| `apps/mobile/app/(app)/check-in.tsx` | 1 |
| `apps/web/components/settings/settings-org-tab.tsx` | 1 |
| `apps/mobile/app/(auth)/create-chapter.tsx` | 1 |
| `packages/chat-core/src/emoji-recent.ts` | 1 |

### C8 · Web and phone use the same words for the same screen

**17** in **0** files.

How it was counted:

```
rg -o of label/title/placeholder/aria-label/accessibilityLabel literals from each screen's files on both apps, compared by hand; count = mismatches listed
```

