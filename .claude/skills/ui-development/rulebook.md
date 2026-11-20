# The owner's UI rulebook

Every UI ruling Paul has given, from 2026-11-04 to 2026-11-19, as rules you follow without being told
again. He has said most of these more than once, and the reason this file exists is his message of
2026-11-19: "I'M SO SO TIRED OF TELLING YOU THE SAME STUFF EVERY FUCKING TIME AND ITERATING ON EVERY
FUCKING UI CHANGE … it's like a never ending loop of fix one problem and find 4 more that you fix to a
mediocre level."

How to read it:

- The eight checks every screen passes are [`spec/ui/design-system/principles.md`](../../../spec/ui/design-system/principles.md)
  (P1 to P8). This file doesn't restate them. It holds the concrete rulings behind them, cited by check
  id where one exists, so a rule here is never weaker than the check it refines.
- This is an index of rulings, one line each. Where a spec under `spec/ui/` owns the detail (sizes,
  row anatomy, motion, copy), the spec is canonical and the line here points at it. When Paul gives a
  new ruling, the PR that acts on it changes the owning spec and adds or edits its line here; if the two
  ever disagree, the spec wins and the disagreement is fixed in that PR (`AGENTS.md` § Spec vs code).
- A rule here beats a pattern already on screen. The repo is mid-rebuild, so code that breaks a rule is
  debt, not precedent (`AGENTS.md` § Tech debt protocol).
- Dates are 2026. A ruling marked **changed** replaced an earlier one; the earlier one is gone, don't
  bring it back.
- Rules marked **lint** are enforced by `packages/eslint-config/ui-rules.js`. The rest are on you and the
  [review checklist](review-checklist.md).
- When Shawn, Winston or Evan reverse a ruling in a PR (allowed since 11-10 for look and layout), the PR
  edits the line here with "Changed in #N by <login>, <date>", as `AGENTS.md` § ADR discipline says.

## 1. How to work (the process rules)

These cause most of the iterations, so they come first.

1. **Fix the class, not the instance.** When Paul names one problem on one screen, find every screen
   with the same problem, on web and on the phone, and fix them together or file the rest
   ([review checklist § Sibling sweep](review-checklist.md#2-sibling-sweep)). Never fix only the one he
   named. (11-19)
2. **Real use, not the literal ask.** "Looks and sounds good from a high level, but once you actually use
   features as intended, they suck." Frame each feature around who uses it, how often, at real scale,
   and what Discord, iMessage or Google Calendar taught them to expect. Take the inspired intent of what
   Paul says, not the minimum. Walk the flow yourself as a member and as an officer. He can't run
   end-to-end tests on every PR. (11-06)
3. **Three people, every screen:** the average member (about 3 events and 1 or 2 tasks a week), a
   committee chair (plus their committee's meetings, tasks and reviews), and an exec (every committee,
   8 or more tasks, a queue to sign off), plus the member with nothing at all. Capture all of them before
   the PR. (11-13, P5.7 to P5.9)
4. **Research comparables first** and name them in the PR: Slack, Discord, Linear, Notion, Google
   Calendar, Apple's own apps, Vercel; GreekTrack, OmegaFi, GroupSpot for chapter features. (11-12)
5. **High effort, evolve from the baseline.** Start from the existing components and push past them
   where they fall short. Never ship a minimal reskin. (11-19)
6. **Web and phone are one product.** Every UI change lands on both in the same PR, with the same
   structure, options, wording and order: "it must not feel like two systems". Shared words and orders
   live in `@repo/validation` (for example `event-form-rows.ts`). A platform that can't follow yet gets a
   filed issue named in the PR. (11-19, P6)
7. **Be bold.** The old design system was flawed; an existing pattern is not a reason. (11-05)
8. **Stop handing Paul options.** Recommend one and build it. A real decision goes on its own decision
   card with a recommended option, never only in prose. (11-17, 11-19)
9. **Show it.** A visual change gets a before/after page of the real screens (`SKILL.md` § Proposing a
   UI change). A changed documented pattern updates its spec in the same PR. (11-05)
10. **Don't re-propose what Paul already rejected:** the gray surface ladder (11-11), removing pages
    beside chat (11-12), overlay side cards (11-19), message previews on chat home's channel rows (11-07).

## 2. Page layout

- **Page actions live in the page's header, never on a row of their own.** Search, filters, view
  switches, export and the create button sit in the header beside the title, the way Linear, Notion and
  Slack put them. A row of controls under the header is the defect Paul called out on Events, Meetings,
  Service hours, Documents, Points and Directory. On web a page renders its actions inside `PageActions`
  (`components/layout/page-actions.tsx`); with #5686 it portals them into the page header between the
  title and the close at every width. Until #5686 merges, `PageActions` still draws its own row, so a
  page built before then is checked again after. Only a control that needs the page's width (Points'
  window switch) stays in the body. (11-19, P8.1)
- **One create button, one look, everywhere.** Every "New …" action is the same shared component with
  the same icon, style and wording pattern ("New event", "New minutes", "New task"), on web and phone.
  A filled pill on one page and an outlined button on the next is a defect. On web it is
  `<NewButton thing="event" />` (`components/ui/new-button.tsx`, outlined accent, Paul's pick 11-19), and
  a page's main action that isn't "New" (Log service, Upload, Adjust points) is
  `<Button variant="action">`; both land with #5686, which also adds the lint rule against a
  hand-rolled `<Button>New …</Button>`. On the phone's pushed
  screens it is the floating glass "+" (`ScreenShell`'s `createAction`); on the four tabs that spot is the
  tab bar's quick-actions "+". Whether the phone moves it into the header is open with Paul (11-19).
  (11-05, 11-19, P8.2)
- **Every page beside chat can close** (`ToolPageHeader`'s close; Escape too), and its title sits in its
  own 48px header at 1056px and wider, paired with chat's channel header. Top-level pages show the title
  alone, no chapter-name prefix; only Settings pages read "Settings › X". (11-05, 11-11)
- **Keep pages beside chat (the split).** Only Settings, which needs the room, is full width and opens
  its tools inside itself, not in drawers. (11-11, 11-12)
- **No overlay side cards, ever.** "I NEVER WANT TO SEE ANOTHER ONE OF THESE SIDE CARDS." A record or a
  form docks in place (`Panel docked`); a short question is a centred dialog; a quick list is a dropdown
  under its button; a name opens a profile popout; the bell is a popover; Catch me up is inline in the
  channel. (11-12, 11-19)
- **Rare controls a couple of taps away behind `⋯`**, never on the header or the row: settings, mute
  state, rename, move, report. Don't expose everything at once. (11-06, P3.4, P3.5)
- **Destructive actions never sit in a record's body or footer.** An action aimed at a person lives in
  the header's `⋯`, comes last, and is never offered against yourself. A big red "Remove member" card
  on a profile is the anti-pattern. (11-11)
- **Edit a thing where you're looking at it.** Roles from the member card; who-can chips on the module's
  page; no "go back to Roles" detours, and never the same setting in two places. Roles and groups share
  one Settings page; Directory only reads. (11-07, 11-11, 11-19, P3.7)
- **Scope a panel to what opened it.** Chat admin opened on a channel is about that channel, with no
  list of every channel, and reports at the bottom. (11-11)
- **Create forms are a borderless title plus property rows** (Type, When, Repeat, Location, Who's coming,
  Points, Description, Notes, Check-in for an event), each opening its menu in place, identical on web
  and phone. Create is small in the header. No "More options", no big Cancel/Create footer. (11-19)
- **Record pages read top-down in the order people use them.** An event is details, then agenda, then
  attendance; a series is one Repeat row and a "Next Friday" link, never a list. (11-19)
- **Long content is scannable:** one meta line, a short summary (3 bullets or fewer), collapsible topic
  rows, a pinned jump bar, sticky title and primary action. "Nothing stands out" is the failure.
  (11-16 to 11-19, minutes)
- **Big things are big.** A surface that scrolls, holds a growing list or shows a whole record is a
  `Panel`, not a cramped dialog. The image viewer is bare and full size, with no card, filename title or
  worded Download. (11-05)

## 3. Lists and rows

- **Rows, not cards.** Compact, Slack-style one-line rows, "simple and FAST". A card around every row is
  P3.6. Excuses, suggested tasks and channel rows are one clean row each. (11-07, 11-15, 11-19)
- **A row carries the details people decide by, the same on both apps** (Paul, 11-19: "did a better job
  of showing details"): an event its start to end and "Check-in is open", a task how it repeats, its
  checklist and photos, a study session its zone, a document its effective day. Still one row: the
  facts sit in its muted meta line, in the same words and order on both apps, read through one shared
  helper (`taskRowFacts`, `formatTimeRange`, `CHECK_IN_OPEN_LABEL`). A pane too narrow to draw a fact
  still speaks it to a screen reader. (11-19)
- **Chat home's channel rows show no date and no message preview.** Read rows are muted gray, unread
  rows bold white with a pip (11-07, 11-11). The Messages screen's conversation rows are the exception:
  they show the last line and when it was sent, WhatsApp-style (changed in #5519, 2026-11-18;
  `spec/ui/mobile/screens.md`).
- **Every row with actions has a menu:** right-click on web, long-press with a haptic on the phone, in
  Frapp's own glass menu (`ItemActionsMenu`, `GlassMenu`, web `RowMenu`). No hover-only pins. Delete is
  red and last. (11-06, 11-18, P7.4)
- **Reorder by dragging with feel** (the held row lifts and tilts, rows slide apart, a slot shows where it
  lands), on both platforms. Up and down arrows read as cheap: "arrows" were called bad on 11-19. (11-11,
  11-19)
- **Real scale:** 150 members, 109 roles with 28-character names, 38 channels, 4,000 messages in one
  channel. Long names truncate as designed, chips cap at one or two plus a count, lists over about 15 get
  search or grouping, counts stop at 99+. (P5)
- **Search results are dated**, and Find is a centred dialog on web. (11-05)

## 4. Controls and forms

- **lint** **No native date or time input on web.** Use `DateField` and `TimeField`. No field asks for the
  year unless it differs. The phone uses the platform's own picker, never a hand-drawn calendar or time
  chips. Times are not locked to 5-minute steps; an event's end keeps its length when the start moves.
  (11-06, 11-12, 11-16, 11-19)
- **lint** **No native `<select>` on web.** Use `Select` or a `DropdownMenu` that shows its state and
  sticks. (11-06)
- **lint** **No browser `confirm`, `alert` or `prompt`** (`window.`, `globalThis.`, or bare `alert` and
  `prompt`; a bare `confirm` is the usual local name for `useConfirmDialog`'s function, so check that one
  yourself). A destructive step uses `useConfirmDialog`.
- **Never "are you sure" on leaving a form. Keep the draft** (Gmail, Linear): Back, Escape, click-away or
  leaving the page keeps it; Cancel and Save drop it (`useKeptFormDraft`, `useKeptSheetDraft`). (11-13)
- **Validate on blur or submit, never per keystroke.** Placeholders never contradict other fields; don't
  ask for the same thing twice. (11-06, P4.5)
- **Text is centred in its box**, inputs and points included: off-centre text was "a common issue ALL
  OVER THE PLACE". (11-06)
- **Words for primary verbs only.** An icon says Download, Copy or Close; pickers and menus carry no
  Cancel and no title. (11-05, P3.6)
- **No helper sentence under a control** whose label already says it: "you don't need to explain how
  each button works." (11-07, P1.2)
- **Show nothing for an option that's off** (quiet hours off shows no times). (11-06)
- **One shared picker per job:** the "Who" picker (people with checkboxes, then groups or roles) and
  "Who's coming" (Everyone else first, then a row per role). Don't build another. (11-12, 11-18)
- **Never give a person a raw token, UUID or link to paste.** Offer email entry or the share sheet with a
  copy button. (11-06)

## 5. States

- **Loading draws the loaded layout's shape and colour** (web `page-skeletons.tsx`, phone
  `StateBlock`); no centred spinner, no generic card. (11-05, P4.3)
- **Pending is gray text or a dim in place.** No spinner row, no "sending" line, nothing that moves the
  layout; the typing line is reserved so the chat doesn't jump. (11-06, 11-11, P4.2)
- **Empty states keep the real layout at zero** and put the first action where the first item would go.
  A done state or a search miss is one inline line; a card survives only for errors. Don't "customise the
  shit that was already bad" with nicer copy on the same card. Hide features a member can't use or set
  up. (11-05, P1.3, P1.4)
- **One connection indicator**, the pill in the top bar. Never draw your own offline notice. (11-06)
- **Plain-words errors:** what happened and what to do, never a permission key, status code or raw
  provider error. "Your role can't …". (11-05, 11-06, P2.3)
- **No fake or placeholder identity:** real names and real avatars, never "Member 000000" or an account
  handle. A photo shows as the photo, not a filename and size. (11-06, 11-07, P2.4)

## 6. Words and dates

- **No abbreviations.** "Today", "Tomorrow", the weekday within the week, else "November 14", with the
  year only when it differs. Never "tmrw", "Sun" or "Oct 27" on an event, task or channel row. Format
  through `@repo/formatting`. (11-07) The Messages screen's last-sent time is its own format
  (`formatConversationTime`, #5519).
- **No wall of text.** One line and a Copy button beats a paragraph nobody reads. (11-06, P1)
- **"Frapp", never "Signet",** anywhere a member can see. FIJI chapters never show Greek letters, system
  posts included. (11-04)
- **Push copy works from the lock screen:** who did what, and when, like a calendar invite; never just
  "New event". (11-06)
- **State facts, never narrate directions.** A push, Activity row or status line says what happened and
  what came with it ("Moiz finished: Book the venue", "1 photo · 10 points"), never what to do about it
  ("send it back if something's off", "Confirm to award 10 points"). The screen's own controls are the
  next step. Paul: "Please stop narrating like directions." (11-20, #5732)
- **A record says its state first.** A task, request or submission that someone acted on shows who did it
  and when right under its title ("Moiz Steenhuis marked it done today at 12:05 AM"), with what they sent
  under that, before its fields. History names the actor too. (11-20, #5732)
- **The same moment has the same words on both apps.** Shared strings live in a shared package. (P6.5)
- **Don't invent labels Paul won't use** ("Needs you" was rejected). Use the chapter's words. (11-13)

## 7. Look

- **lint** **No emoji** in anything Frapp draws or writes, mockups and proposal pages included: lint checks
  every string in product source, specs aside. Members' own emoji are their content. (11-05)
- **Compact controls** from the control size scale (Chip 24, Row 32, Small 36, Field 40; 44 for touch).
  "All the bubbles just feel way too big." (11-05, foundations §9)
- **No giant full-width buttons.** A button is sized to its label, from the control size scale, never
  stretched across a profile, card, panel or page body. A person's profile puts Message beside the other
  actions as a compact button (iMessage, Slack and Linear profiles), not a bar under the name. Web and phone
  alike. Full width stays only on single-column sign-in and setup forms (Linear, Notion, Slack sign-in);
  sheet commit buttons wait on Paul's call. "Not a big huge button guy." (11-20, #5708)
- **Near-black neutral surfaces**, no warm yellow. On the phone every card sits one surface step down;
  tinted tiles only on You. (11-05, 11-11, 11-13)
- **The accent goes only where `foundations.md` § Where the accent goes allows it.** Scrollbars, mention
  chips, hover fills and icons blend in. (11-05, 11-06)
- **Mobile chrome is floating glass** (the Bevel direction): glass tab pill, round glass "+", glass back
  capsule; nothing glass inside content; no glows or shadows. (11-05, 11-06)
- **Status colours and shapes match across apps.** (P6.2)
- **Motion comes from the four shared classes** (micro-feedback, standard transition, context shift,
  signature) in `foundations.md` § 11, never a one-off duration or curve. Signature is only for the few
  deliberate fun moments its catalog lists. (11-05, 11-06)
- **Icons are drawn glyphs** from the duotone set, consistent per meaning across the app ("just be
  consistent"). (11-05)

## 8. Navigation and gestures

- **Swipe back on every pushed screen**; Android back closes the top sheet; Escape closes the top layer on
  web. (11-06, P7)
- **Opening a notification doesn't stack the screen on itself.** (11-07)
- **Several sections to fill in is a pushed screen on the phone, not a sheet.** A sheet is for one short
  pick or action over what's under it; a profile or settings page with sections opens as its own screen with
  a back row, on the page background ("not sure a sheet is the move here", on Finish your profile). (11-20)
- **Standard affordances everywhere:** right-click, long-press, share sheet, pull to refresh, drag a file
  onto chat. As obvious as Discord or iMessage on day one. (11-06, P7)
