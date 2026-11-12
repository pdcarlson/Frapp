# Iconography

> Icon style, sizing, color, accessibility rules, and the semantic intent → icon map for every Signet surface.

---

## 1. Canonical Style — Signet Duotone

All Signet-reskinned surfaces draw icons with the duotone recipe locked in the
[design-system reference](reference/signet-design-system.dc.html) and rendered
throughout the [Canvas screens](reference/canvas-screens.dc.html). On web the
recipe is one module — [`apps/web/components/ui/duotone.tsx`](../../../apps/web/components/ui/duotone.tsx)
— which every stroke-recipe glyph composes, so a surface cannot drift off it
while looking like it complies. The navigation glyphs, and the in-screen
glyphs that sit beside them, draw the two-tone nav set instead (§1.1):

| Layer | Spec |
|-------|------|
| Stroke | 1.6px on a 24px grid, rounded caps and joins |
| Fill | The icon's primary silhouette carries a low-opacity fill of the same hue as the stroke |
| Details | Secondary strokes (clock hands, checkmarks, calendar rules, bell clappers) stay stroke-only, no fill |

Color per state (roles defined in [foundations](foundations.md)):

| State | Stroke | Fill |
|-------|--------|------|
| Neutral / inactive | Muted text role | White at 6% opacity |
| Active / emphasis | Accent text (step 11) | Stroke hue at 16–18% opacity |
| Status | Semantic role color (see §3) | Stroke hue at low opacity, same recipe |

### 1.1 Nav glyphs (two-tone, shared by web and mobile)

The navigation glyphs (the web sidebar, the mobile tab bar and the More hub's
rows), the web in-screen families' re-exports of them, and the few in-screen
glyphs drawn beside those (folder, schedule, invite, profile, and Activity's
`link` and `confirm`, §6.2.5a) draw one shared
set instead of the stroke recipe above: [`packages/theme/src/nav-glyphs.ts`](../../../packages/theme/src/nav-glyphs.ts)
(`@repo/theme/nav-glyphs`), path data from Phosphor's duotone weight (MIT),
rendered by `apps/web/components/layout/nav-glyphs.tsx` and
`apps/mobile/components/nav-glyph.tsx`. Changed 2026-11-05 at Paul's request:
the stroke recipe's 6% white fill vanished on the charcoal surfaces, so the nav
read as plain outlines, and its hand-built gear looked off.

| Layer | Spec |
|-------|------|
| Silhouette (`back`) | The glyph's own hue at 20% at rest, 30% when active |
| Outline and details (`front`) | The glyph's own hue at full strength |

The hue follows the same state table as above (muted at rest, accent text when
active). Rule 1 below holds: selection recolors and lifts the silhouette, and
never swaps to a solid variant. A new nav intent takes its shape from the same
Phosphor duotone folder so the set stays one family.

Rules:

1. A state change **recolors** the glyph (stroke + fill together). It MUST NOT
   swap to a solid-filled variant — solid fills are not part of the duotone
   family.
   Changed in #4289 by pdcarlson for Shawn, 2026-11-11: one exception,
   **Documents' Star and Pin** (§6.2.5). While on, the silhouette is solid in
   its hue; while off, it is the outline. Chat's channel pin and bookmark
   (§6.2.2) are the same kind of toggle and still take the tinted fill until
   [#4292](https://github.com/pdcarlson/Frapp/issues/4292). At 16–18% an on star read as the off outline in another
   colour, so the state rode on colour alone (Shawn: "it should fill in the
   star. It shouldn't just turn purple"). Same path data, filled, as Google
   Drive, Gmail and Dropbox draw a star. Web: `markFillProps` in
   `apps/web/components/ui/duotone.tsx`; mobile: `markPaint` in
   `apps/mobile/components/documents/document-glyphs.tsx`. Nav glyphs,
   selection and every other state still recolor only.
2. Tab bar active state = accent duotone glyph + 700-weight label, on a soft
   capsule (white at 8%) the full height of the pill's row, as iOS 26's own
   bars draw it. Corrected 2026-11-06 with the glass tab pill (owner pick, the
   quick-actions mockup): this rule used to read "No pill or container shape
   behind the glyph", which held for the flat bar.
3. Locked emblem B is a brand asset, not an icon — it never takes
   the duotone treatment or the chapter accent (see
   [brand identity](../brand-identity.md)).
4. Third-party OAuth marks (Apple silhouette, Google four-color G) are
   trademarks, not Signet icons. They MUST use the official artwork and MUST NOT
   take the duotone recipe, the chapter accent, or a recolor of Google's four
   colors. Size is 20px (§2 action-button size). They sit beside the
   "Continue with …" label and are decorative (`aria-hidden` /
   `accessible={false}`).

---

## 2. Size Scale

Use only these icon sizes in product UI:

| Size | Context |
|------|---------|
| 16px | Dense table controls, inline metadata rows |
| 20px | Default action/icon buttons, list-row leading icons |
| 24px | Mobile tab bar glyphs, high-emphasis hero/feature spots |

- Badge/status companion icons: 14–16px max.
- Avoid custom in-between values unless there is a documented accessibility
  reason.
- Mobile tab glyphs are 24px (`TAB_GLYPH_SIZE` in
  `apps/mobile/components/tab-glyphs.tsx`), matching the Canvas lock. The
  pre-reskin bar drew them at 20px.
- Web sidebar nav glyphs are 18px ([components.md](components.md) §7's
  item-level spec), a documented exception to this scale; top-bar glyphs are
  18px too (see §6.2). Both were 17px / 20px before the greenfield shell
  ([#2141](https://github.com/pdcarlson/Frapp/issues/2141)) took the board's
  geometry.

---

## 3. Color Usage

- Default icon color MUST inherit the text role it accompanies (secondary or
  muted text — see [foundations](foundations.md)).
- Status icons MUST use the semantic feedback roles (success, warning, danger,
  info). Semantic colors are status-only, never decorative.
- Never encode status with icon color alone — always pair with a text label.

---

## 4. Accessibility

- Icon-only controls MUST include accessible labels (`aria-label` on web,
  `accessibilityLabel` on mobile).
- Decorative icons MUST be hidden from assistive technology and MUST NOT
  receive focus or be announced redundantly.
- Icon strokes MUST have sufficient contrast against their background surface.
- Icon-only controls follow the 44px minimum touch target
  ([foundations](foundations.md)).
- Which buttons draw their icon alone, and where the word goes instead, is
  [components.md § Icon-only actions](components.md#icon-only-actions). Build
  them with `IconButton` (`apps/web/components/ui/icon-button.tsx`,
  `apps/mobile/components/icon-button.tsx`), which requires the label.

---

## 5. Interim Packs (Until Reskin)

The shipping apps use off-the-shelf packs until each surface is reskinned to
duotone. Interim rules:

- **Web (Lucide)** — keep the default stroke weight; do not restyle individual
  icons. **The dashboard shell and the chat family have left this interim
  path**: the shell's sidebar and top-bar glyphs are SVG components in
  `apps/web/components/layout/nav-glyphs.tsx` (the sidebar's from the shared
  nav set, §1.1; the top bar's in the §1 stroke recipe), and chat's are in
  `apps/web/components/chat/chat-glyphs.tsx`; the Directory & Finance, Chapter Ops and Resources &
  Reporting families have since followed (§6.2.3, §6.2.4, §6.2.5). Lucide
  remains the interim pack for the screen families
  whose #920 slice has not landed, and — on every surface, reskinned or not —
  for control furniture (§6.2).
- **Mobile (Ionicons)** — outline variants for navigation and neutral states;
  fill variants only for explicit active/high-emphasis affordances. **The tab
  bar has left this interim path**: its four glyphs are `react-native-svg`
  components in `apps/mobile/components/tab-glyphs.tsx` drawing the shared nav
  set (§1.1). Ionicons remains the interim pack for
  in-screen icons until each screen is reskinned.
- Do not mix icon packs within a single surface. The §1 stroke recipe and the
  §1.1 nav set count as one Signet family for this rule, and the target is a
  single family: a glyph drawn in the same list as a nav glyph takes the nav
  set (the folder rail, the event schedule rows, invite and profile,
  §6.2.3–§6.2.7). The rest of the stroke-recipe glyphs, `SearchGlyph` in the
  toolbars among them, move over under
  [#3491](https://github.com/pdcarlson/Frapp/issues/3491).
- Surfaces built or rebuilt under the Signet reskin use the duotone recipe
  (§1); legacy surfaces keep their pack until reskinned.
- Note the interim outline/fill pairs below are a *deliberate* violation of §1
  rule 1, which forbids swapping to a filled variant. They are tolerated only
  while a surface still rides an off-the-shelf pack; a reskinned surface
  recolors one glyph instead.

---

## 6. Semantic Intent Map

This map is the source of truth for intent → icon selection. No ad hoc
substitutions.

### 6.1 Mobile tab bar (duotone, shipped)

The tab bar is reskinned. Its four glyphs live in
`apps/mobile/components/tab-glyphs.tsx` at 24px and draw the shared nav set
(§1.1), so each tab has the same shape as its web sidebar row. There is one
component per tab and it recolors between states per §1 rule 1; there is no
second, filled variant to swap to.

| Semantic intent | Glyph (nav set key, Phosphor name) | Notes |
|---|---|---|
| Chat tab (home) | `chat`, `chat-circle-dots` | |
| Events tab | `events`, `calendar-dots` | |
| Tasks tab | `tasks`, `seal-check` | |
| More tab | `more`, `squares-four` | Not an ellipsis: Canvas draws a 2×2 grid, and Canvas wins for visuals. |

Retired with the 4-tab collapse: the Home, Points, and Profile tabs. Home and
Points no longer exist as screens; Profile moved into the More hub.

Chat home's UP NEXT rows (s04, `apps/mobile/components/chat/up-next-strip.tsx`)
draw the same file's `EventsGlyph` and `TasksGlyph` at 20px (§2's list-row
size), both unfocused in `text.muted`, since a row's label icon is neutral
([foundations.md](foundations.md) §6, 2026-11-05). Until then the event row's
was focused and in the chapter accent. The s05 chat cards reuse
them too (§6.1.3).

### 6.1.1 Mobile in-screen icons (Ionicons, interim)

Screens that have not been reskinned yet still draw Ionicons per §5. Each
cluster replaces its own as it rebuilds; there is no separate icon migration.

### 6.1.2 Mobile More hub (Signet duotone, shipped)

The tab bar's quick-actions panel (`apps/mobile/components/quick-actions/quick-actions-panel.tsx`,
[`navigation.md` § Quick actions](../mobile/navigation.md#quick-actions)) draws
each action at 26px on a 58pt glass disc, in `text.foreground`, with the nav
shape of the place it leads: New event `events`, New task `tasks`, Invite
`invite` (Phosphor `user-plus`), Message `chat`, Check in `checkIn` (Phosphor `map-pin`, added for it), Host check-in
`hostCheckIn`, Log hours `service`, Study `study`, Upload `documents`. The
active tab in the pill sits on a soft capsule (white at 8%) under its accent
glyph and bold label, as iOS 26's own bars draw it, since 2026-11-06.

The More hub's leading row glyphs (s09, #1048) live in
`apps/mobile/components/more/more-glyphs.tsx` at 20px (§2's list-row size)
and draw the shared nav set (§1.1), so one intent draws one shape on both
surfaces. Every row, Member and Admin alike, is painted in `text.muted`
([foundations.md](foundations.md) §6; the Member rows took the chapter accent
until 2026-11-05).

| Semantic intent | Glyph (nav set key, Phosphor name) | Web counterpart |
|---|---|---|
| Activity (#3897) | `activity`, `tray` | `ActivityGlyph` |
| Study hours | `study`, `graduation-cap` | `StudyGlyph` |
| Service hours | `service`, `hand-heart` | `ServiceGlyph` |
| Dues | `billing`, `credit-card` | `BillingGlyph` |
| Documents | `documents`, `file-text` | `DocumentsGlyph` |
| Directory | `directory`, `users-three` | `DirectoryGlyph` |
| Settings | `settings`, `gear-six` | `SettingsGlyph` |
| Switch chapter, Create a chapter | `chapter`, `bank` (the columned chapter house) | none |
| Invite members (Admin) | `invite`, `user-plus` (`InviteGlyph`) | `InviteGlyph` |
| Host check-in (Admin) | `hostCheckIn`, `qr-code` | none |

The same file's `NotificationsGlyph` (bell, clapper stroke-only, still in the
§1 stroke recipe; s09 and web `NotificationsGlyph`) is drawn by Chat home's inbox bell
(`components/chat/notifications-bell.tsx`), in `text.foreground` with the
neutral fill, since the More row it was drawn for moved there (#3362).
The More screens' empty states drew these glyphs in a tile until 2026-11-07, when every empty state became one line with no glyph ([components.md](components.md) §10). s15's avatar badge draws s20's camera (`CameraGlyph`, `components/service-hours/camera-glyph.tsx`) in the accent's on-colour, its body at §1's emphasis fill.

### 6.1.3 Mobile chat cards (Signet duotone, shipped)

The eyebrow glyph over each s05 chat card, drawn at 16px by `CardEyebrow`
(`apps/mobile/components/chat/chat-card.tsx`) in the tab bar's props, so a
card and the tab it belongs to share a silhouette. The event, task, points and
hours glyphs are nav-set shapes (§1.1, through `TabGlyph`); the rest keep the
§1 stroke recipe. Each is the web glyph for the same intent (§6.2.2). Painted
neutral, with the eyebrow's muted label, on every card and on both surfaces
([foundations.md](foundations.md) §6; they took the accent until 2026-11-05,
except the audit card's).

| Semantic intent | Glyph | Lives in |
|---|---|---|
| Event card | `EventsGlyph` (the Events tab's) | `components/tab-glyphs.tsx` |
| Task card | `TasksGlyph` (the Tasks tab's) | `components/tab-glyphs.tsx` |
| Points card | `PointsGlyph` (the nav set's trophy, §1.1) | `components/chat/card-glyphs.tsx` |
| Hours card | `ServiceHoursGlyph` (the nav set's hand-heart, the More hub's shape) | `components/chat/card-glyphs.tsx` |
| Recruitment candidate card | `RushGlyph` (funnel, inner line stroke-only; the module catalog's `funnel`) | `components/chat/card-glyphs.tsx` |
| Announcement card | `AnnouncementGlyph` (megaphone, sound arc stroke-only) | `components/chat/card-glyphs.tsx` |
| `#chapter-audit` audit line, at 14 in `--muted` in the avatar gutter (a card's eyebrow until 2026-11-06) | `AuditGlyph` (shield, record lines stroke-only) | `components/chat/card-glyphs.tsx` |

The poll card has no glyph: its eyebrow is muted text on both surfaces.

### 6.1.4 Mobile image viewer controls (stroke recipe, shipped)

The chat image viewer's controls (`apps/mobile/components/chat/image-viewer.tsx`)
are icons with no words, drawn at 24px in white at 80% on the viewer's black
backdrop, never the accent (2026-11-05). They are control furniture, so they
draw the §1 recipe's detail strokes only, with no silhouette fill. Web's
viewer draws the same intents in Lucide (`Download`, `X`, `ChevronLeft`,
`ChevronRight`), as §6.2.2's furniture rule says.

| Semantic intent | Glyph | Lives in |
|---|---|---|
| Close the viewer | `CloseGlyph` (an ×), at 24 | `components/control-glyphs.tsx` (§6.1.5) |
| Share the image | `ShareGlyph`, at 24 | `components/control-glyphs.tsx` (§6.1.5) |
| Previous / next image | `ChevronGlyph` | `components/chat/viewer-glyphs.tsx` |

### 6.1.5 Mobile control glyphs (stroke recipe, shipped)

The verbs an icon-only control draws ([components.md § Icon-only
actions](components.md#icon-only-actions)), plus share's companion mark for an
invite link and the alert mark on an Important chat message (#3921), live in one file,
`apps/mobile/components/control-glyphs.tsx`, so every dismiss on mobile is the
same ×. Detail strokes only, no silhouette fill, at 20px (§2's icon-button
size) unless a caller passes another size. Color comes from the surface: the
banner's semantic hue on the network banner, `text.muted` on a row or chip,
the chapter accent in a back-row slot (2026-11-05).

| Semantic intent | Glyph | Drawn by | Web counterpart |
|---|---|---|---|
| Dismiss, close, remove | `CloseGlyph` (an ×) | the network banner, the thread's error banner, the composer's reply strip (16px) and photo thumbnails (12px on a dark disc), the image viewer (24px), the service-hours proof row, Chat home's setup-checklist hide (16px), the glass close on the check-in scanner (s18) and host QR (s22) (18px, `glass-close-button.tsx`) | Lucide `X` |
| Try again | `RetryGlyph` (a circling arrow) | a chat photo that didn't upload, in the composer tray (22px, destructive ink) | Lucide `RotateCw` |
| Edit | `PencilGlyph` | Messages' new-message button and Event details' Edit (Profile's back row until #3711) | Lucide `Pencil` |
| Mark all read | `CheckAllGlyph` (two checks) | the Notifications screen header | None: the drawer words it, "Mark all read", since 2026-11-09 (#3929); it drew Lucide `CheckCheck` before |
| Share | `ShareGlyph`: iOS's box with an arrow out of it, Android's three joined nodes, each platform's own mark (moved here from the image viewer's own file, 2026-11-06) | the image viewer (24px), chapter setup's `Share invite` gold button and Invite members' secondary one (`text.foreground`, 2026-11-09, #3828), in the button's ink | Lucide `Share` |
| Invite link | `LinkGlyph` (two joined links) | chapter setup's invite step: its link card, in `gold.askText` on the ask tile, and each shared row (16px); Invite members (`(app)/invite.tsx`) draws the same card in the chapter accent on its subtle tile | Lucide `Link` |
| Back | `BackGlyph` (a left chevron, stroke 2.2, heavier than the recipe), in the chapter accent or the house gold | the chat thread header at 20 (2026-11-06; it was a typed `‹`), every back-row capsule at 18 | Lucide `ChevronLeft` |
| Important (a status mark, not a control) | `AlertGlyph` (a circled !) | an Important message's flag caption in chat, at 14 in `destructiveText` ([components.md § A flagged row](components.md#a-flagged-row)) | Lucide `CircleAlert` |

### 6.2 Web Dashboard shell (Signet duotone)

Since the #920 shell slice the dashboard's shell chrome draws Signet glyphs,
not Lucide. The glyphs live in `apps/web/components/layout/nav-glyphs.tsx`
and `apps/web/components/layout/nav-config.ts` consumes them. The sidebar
rows and the in-screen `RolesGlyph`, `StudyZonesGlyph` and
`ReportsGlyph` draw the shared nav set (§1.1); the top-bar controls keep the
§1 stroke recipe.
Sidebar items render them at 18px ([components.md](components.md) §7);
top-bar controls at 18px (`apps/web/components/layout/top-bar.tsx` — the top
bar moved out of `dashboard-shell.tsx` in #2141).
This table is the intent → glyph map; it MUST change in the same PR as
`nav-glyphs.tsx`.

| Semantic intent | Glyph | Shape (nav set key, Phosphor name) |
|---|---|---|
| Chat | `ChatGlyph` | `chat`, `chat-circle-dots` |
| Direct messages ([#3774](https://github.com/pdcarlson/Frapp/issues/3774)) | `DirectMessagesGlyph` | `direct`, `paper-plane-tilt`: Instagram's sign for messages, so the row under Chat reads apart from Chat's bubble. Mobile's Messages door keeps its own speech bubble for now. |
| Activity (what needs you, what you made) | `ActivityGlyph` | `activity`, `tray` |
| Events | `EventsGlyph` | `events`, `calendar-dots` |
| Tasks | `TasksGlyph` | `tasks`, `seal-check` |
| Points | `PointsGlyph` | `points`, `trophy` |
| Study hours | `StudyGlyph` | `study`, `graduation-cap` |
| Service hours | `ServiceGlyph` | `service`, `hand-heart` |
| Polls (no nav row since #3871; kept for the chat composer's + menu, #3865) | `PollsGlyph` | `polls`, `chart-bar` |
| Meetings (minutes) | `MeetingsGlyph` | `meetings`, `notebook` |
| Documents | `DocumentsGlyph` | `documents`, `file-text` |
| Backwork | `BackworkGlyph` | `backwork`, `books` |
| Directory | `DirectoryGlyph` | `directory`, `users-three` |
| Billing | `BillingGlyph` | `billing`, `credit-card` |
| Settings | `SettingsGlyph` | `settings`, `gear-six` |
| Roles (in-screen) | `RolesGlyph` | `roles`, `shield-check` |
| Study zones (in-screen) | `StudyZonesGlyph` | `studyZones`, `map-pin-area` |
| Reports (in-screen) | `ReportsGlyph` | `reports`, `chart-line-up` |
| Search (top bar) | `SearchGlyph` | §1 stroke recipe |
| Notifications (top bar) | `NotificationsGlyph` | §1 stroke recipe |
| Mobile nav trigger (top bar) | `MenuGlyph` | §1 stroke recipe |

Service hours and Reports are distinct glyphs (hand-heart vs. rising chart),
so the legacy nav's `FileText` double-duty stays resolved. The nav's Admin group
(Roles, Study Zones, Discord Import, Chat Admin, Reports) folded into the
Settings row in #2946, so those intents left this table. `RolesGlyph`,
`StudyZonesGlyph` and `ReportsGlyph` survive in `nav-glyphs.tsx` because
in-screen surfaces import them. `ImportGlyph` and `ChannelsGlyph` had no other
consumer and were deleted. Utility glyphs inside the
shell chrome (`ChevronRight` breadcrumb separator, `ChevronsUpDown`, `Check`,
`Loader2`, `LogOut`, `User`, the notification drawer's internals) remain
Lucide: control furniture, not nav intents.

The theme rows left with the toggle: the surface is dark-only and ships no
theme control.

### 6.2.1 Web in-screen icons — the interim pack, now retired

**Every family has now departed**, so this section records a finished
migration rather than a live one: chat (§6.2.2), Directory & Finance —
members, alumni, billing and points (§6.2.3) — Chapter Ops — events, study
hours and study zones (§6.2.4) — Resources & Reporting —
documents, backwork, polls and reports (§6.2.5) — Settings & Roles, which
ships no family file and says why (§6.2.6) — and Profile & pre-auth (§6.2.7).

What still draws Lucide on the web dashboard is **control furniture** and the
shared §10 state family, both by the standing rule in §6.2.2 rather than as an
interim: a verb on a button or a spinner is furniture, and
`components/shared/**`'s glyphs move with that module, not with a screen.
One pick worth pinning meanwhile:

- **Reserved:** `LayoutDashboard` is held for the **Overview** intent and is
  deliberately unused today — the dashboard home screen was removed in the
  chat-first redesign and the index route redirects to `/chat`. If an Overview
  surface is ever built it MUST take this glyph rather than pick a new one.

### 6.2.2 Chat (Signet duotone)

Since the #920 chat slice the chat family draws the duotone recipe (§1). The
glyphs live in
[`apps/web/components/chat/chat-glyphs.tsx`](../../../apps/web/components/chat/chat-glyphs.tsx),
which composes the shared recipe module and re-exports the seven silhouettes the
shell already draws rather than redrawing them. Rendered at 20px in headers and
composer controls, 16px in card eyebrows and inline metadata (§2).

| Semantic intent | Glyph |
|---|---|
| Pinned message | `PinGlyph` |
| Pin a channel to the top of your own list (#2877), filled while pinned | `PinGlyph` |
| Bookmarked message (personal) | `BookmarkGlyph` |
| Attach a file | `AttachGlyph` |
| Add a reaction | `ReactionGlyph` |
| The composer's **+**, which opens Attach a file and every command's form (#3865): stroke only at 2, a plus has no area to fill | `PlusGlyph` |
| Poll, in the composer's **+** menu | `PollsGlyph` (shared with the nav intent) |
| Sign-up sheet, in the composer's **+** menu (#3926): a clipboard, the board filled, the clip and a ticked line stroke-only | `SignupGlyph` |
| Send a message: an up arrow, stroke only at 2.4 on the accent-filled round button, the web face of mobile's `↑` (2026-11-06) | `SendArrowGlyph` |
| Announcement | `AnnouncementGlyph` |
| `#chapter-audit` / audit row | `AuditGlyph` |
| Private / role-gated channel | `LockGlyph` |
| Show or hide the channel member list (#3536), filled while shown | `MembersGlyph` (the nav set's `DirectoryGlyph`, re-exported); mobile's thread header draws the same shape, `NAV_GLYPHS.directory`, through `NavGlyph` |
| Direct or group message | `DirectMessageGlyph` |
| Reply to a message | `ThreadGlyph` |
| Start a thread off a message (#3785): one speech bubble with a reply branching from under it, not `DirectMessageGlyph`'s overlapping pair. Follow on a thread stays a text button, since the bell is the inbox's (#3362) | `StartThreadGlyph` |
| Per-channel notification level / mute: a speaker (box and cone, split by a detail stroke) with two waves, an × for the waves when muted. Not a bell, since #3362: the bell is the notification inbox's. The box, split and second wave keep it apart from `AnnouncementGlyph`'s single horn and wave | `MuteGlyph` |
| Event location | `LocationGlyph` |
| Event card | `EventsGlyph` (shared with the nav intent) |
| Task card | `TasksGlyph` (shared) |
| Points card | `PointsGlyph` (shared) |
| Hours card | `ServiceGlyph` (shared with the nav intent) |
| Rush / recruitment card | `RushGlyph` |
| Channel search | `SearchGlyph` (shared) |

Three things this table deliberately does not contain:

- **The channel sigil and the DM avatar.** `canvas-screens.dc.html` s04 draws a
  channel as a text `#` and a direct message as an initials avatar. Those are
  type and an avatar, not icons, and the reference wins over a tidier
  all-icons row.
- **The ✦ Ask mark.** It is a text glyph claimed by the Ask/AI affordance
  ([components.md](components.md) §11) and MUST NOT mark anything else — which
  is why chat's slash-command trigger, which used to draw Lucide's `Sparkles`,
  took a command silhouette instead, and why the **+** that replaced that
  trigger (#3865) is a plain plus.
- **Control furniture**, which stays Lucide on this surface exactly as it does
  in the shell: `Loader2` and `RefreshCw` (spinners), `X` (close), `Trash2`
  (discard), and the three glyphs that sit *inside* an action button and name
  the button's own verb rather than a domain object — `Check` (check in),
  `CheckCircle2` (confirm), `Undo2` (reject). A verb on a button is furniture;
  the thing the card is *about* is an intent and belongs in the table above,
  which is why the event card's location pin does and its check-in tick does
  not.

### 6.2.3 Directory & Finance (Signet duotone)

Since the #920 Directory & Finance slice these four families draw Signet
glyphs: the nav set (§1.1) for the re-exports and `InviteGlyph`, the §1 stroke
recipe for the points glyphs and search. The glyphs live in
[`apps/web/components/members/directory-glyphs.tsx`](../../../apps/web/components/members/directory-glyphs.tsx)
and [`apps/web/components/points/points-glyphs.tsx`](../../../apps/web/components/points/points-glyphs.tsx),
both re-exporting the shell's silhouettes rather than redrawing them. Rendered at 20px in card titles,
16px in table cells, and 14–16px as a badge companion (§2). Never before the title of a dialog, panel
or sheet as decoration that repeats the button just pressed ([`components.md`](components.md#chrome-weight)
§ Chrome weight and § Surface size, 2026-11-05). A mark that names the surface is not that: the
onboarding tutorial's per-slide glyphs (§6.2.7) and the ✦ on s17's "Ask Frapp" (components.md §11) stay.
Inside a `Button` they render at 16 whatever the call site asks for, because
`buttonVariants` pins `[&_svg]:size-4` — which is also what keeps the required
375px floor gate unaffected by a glyph swap.

Alumni draws from the Directory file rather than one of its own: `/members`
hosts both tabs, so they are one screen with one set of intents. It no longer
contributes an intent of its own — see the note below the table. Billing has no
file at all — its single in-screen intent is already the shell's Billing nav
intent, so [`plan-panel.tsx`](../../../apps/web/components/billing/plan-panel.tsx)
imports `BillingGlyph` directly. §1 rule 1 is about not redrawing, not about
where an import points.

| Semantic intent | Glyph | Home |
| --- | --- | --- |
| Invite a member | `InviteGlyph` (the nav set's `invite`, Phosphor `user-plus`, §1.1) | `directory-glyphs.tsx` |
| Member record | none: the member panel's title is the member's name ([`components.md` § Surface size](components.md#surface-size)) | |
| Role access | `RolesGlyph` | re-export, shell |
| Directory / ledger search | `SearchGlyph` | re-export, shell |
| Adjust points | `AdjustGlyph` | `points-glyphs.tsx` |
| Flagged transaction | `FlaggedGlyph` | `points-glyphs.tsx` |
| Payment method / checkout | `BillingGlyph` | re-export, shell |

Five things this table deliberately does not contain (the count was wrong at
four and is corrected here rather than left drifting):

- **A second invite icon.** One intent had shipped as two glyphs — `UserPlus`
  on the directory's trigger and `ShieldPlus` inside the dialog that trigger
  opens. The shield was also the wrong story: that dialog issues an invite
  token, it does not grant a role.
- **The ✦ Ask mark, again.** `points-adjustment-dialog.tsx` drew Lucide's
  `WandSparkles` on its submit button. `components.md` §11 claims ✦ for the
  Ask/AI affordance alone, and the chat slice deleted `Sparkles` for the same
  reason. The button now carries no glyph: its label already names its verb.
- **The §10 state family's own glyphs.** `AlertTriangle` (error), `FolderOpen`
  (empty) and `WifiOff` (offline) are drawn from Lucide by
  [`async-states.tsx`](../../../apps/web/components/shared/async-states.tsx) and
  its nested counterpart on *every* surface, reskinned or not, and
  `AlertCircle` names the same "needs attention" state on the billing overdue
  card. They are listed here rather than left implicit because §6.3 requires
  every interim pick to be in this map and these had never been written down —
  a family slice that read the map literally would have concluded they were
  unmigrated domain intents. They are not this family's to move: the state
  family is shared, so its glyphs migrate with a pass over
  `components/shared/**`, not with a screen family.
- **Control furniture**, unchanged from §6.2.2's rule: `Copy` and `Plus` are
  verbs on buttons. `RefreshCcw` in the audit card was a stray second spelling
  of §6.2.2's `RefreshCw` and is now the sanctioned one. This entry used to name
  four and now names two — `ArrowUp`/`ArrowDown` and `List`/`LayoutGrid` were
  the Directory table's sort-direction arrows and its table/card view toggle,
  and the greenfield Directory lane ([#2146](https://github.com/pdcarlson/Frapp/issues/2146))
  deleted both controls, so neither pair has a call site left in this family.
  The rule they illustrated is unchanged; only the examples went.
- **An Alumni glyph.** `AlumniGlyph`, a mortarboard, had one consumer: the
  "ALUMNI" Hairline badge on every card of the alumni grid. The greenfield
  Directory lane deleted that badge — a per-row tag reading ALUMNI on every row
  of the list the Alumni tab opens states one fact three times, which is the
  reasoning board `1t` applies to badge rows — and §6.3 requires the map to move
  with the code, so the intent leaves this table rather than pointing at a
  function with no call site. The alumni list is still reached through a text
  tab under the route's `DirectoryGlyph` nav intent.

### 6.2.4 Chapter Ops (Signet duotone)

Since the #920 Chapter Ops slice these families draw Signet glyphs, all from
the nav set (§1.1) except the stroke-recipe search glyph. The glyphs live in
[`apps/web/components/events/chapter-ops-glyphs.tsx`](../../../apps/web/components/events/chapter-ops-glyphs.tsx),
one file for the events, study hours and study zones screens rather than one
each, because they share their intents rather than partitioning them — the map
pin marks an event's location, a running session's zone and a zone row alike.
Tasks and service hours were in the family too; their only glyphs were the ones
before their dialog titles, which went in 2026-11-05 (§ Chrome weight in
[`components.md`](components.md#chrome-weight)), so they draw none from it now.

| Semantic intent | Glyph |
|---|---|
| An event (its panel titles carry none, [`components.md` § Surface size](components.md#surface-size)) | `EventsGlyph` (re-export) |
| An event's schedule row | `ScheduleGlyph` |
| A location, a study zone, a session's zone | `StudyZonesGlyph` (re-export) |
| Role targeting on an event | `RolesGlyph` (re-export) |
| The attendance roster | `DirectoryGlyph` (re-export) |
| An event's point value | `PointsGlyph` (re-export) |
| Search, in the events toolbar | `SearchGlyph` (re-export) |

Six of the seven are re-exports from
[`apps/web/components/layout/nav-glyphs.tsx`](../../../apps/web/components/layout/nav-glyphs.tsx),
which is the rule §1 rule 1 already sets and the Directory family already
follows: a second copy of the same path data is the drift the rule exists to
stop. Only `ScheduleGlyph` is not a re-export, because no nav intent covers
it; it draws the nav set's `schedule` entry (Phosphor `clock`, §1.1) so the
detail sheet's schedule, location and points rows stay one family.

Two of the swaps were corrections rather than a pack change. The event detail
sheet marked its **point value** row with `CalendarDays` — a calendar labelling
points — and the events table drew its role-targeting and recurrence markers at
12px, under §2's 14–16 badge-companion floor.

- **Control furniture**, unchanged from §6.2.2's rule: `Loader2`,
  `AlertCircle`, `AlertTriangle`, `Trash2`, `Pencil`, `Plus` and `Save`. This family has
  more of the second kind than any other — every pair naming a *control's own
  action* rather than a domain object stays Lucide: `Play`/`Pause`/`Square` on
  the study timer, `Eye`/`EyeOff` on its tracking state, `Power`/`PowerOff` on
  a zone's enable toggle, and `CheckCircle2`/`XCircle`/`Undo2` on approve,
  reject and withdraw.

### 6.2.5 Resources & Reporting (Signet duotone)

Since the #920 Resources & Reporting slice these families draw Signet
glyphs (`/polls` was one until #3871 retired it), from the nav set (§1.1) except the stroke-recipe search glyph and the drawn `PinGlyph` and `StarGlyph` (both #3934, solid while on since #4289). The
glyphs live in
[`apps/web/components/documents/resources-glyphs.tsx`](../../../apps/web/components/documents/resources-glyphs.tsx),
one file for three screens rather than three files, for the reason §6.2.4 gives:
the three share their intents rather than partitioning them. The document
silhouette marks a file row on `/documents`, an unfiled document's folder
button, and the PDF a report exports to.

| Semantic intent | Glyph |
|---|---|
| A document row on `/documents`, the "No folder" filter, and the PDF a report exports to | `DocumentsGlyph` (re-export) |
| A folder, and the folder filter that names one | `FolderGlyph` |
| A report, and the control that generates one | `ReportsGlyph` (re-export) |
| Search, in the `/documents` and `/backwork` toolbars | `SearchGlyph` (re-export) |
| A folder or file pinned for the whole chapter, and the Pin control (#3934), solid while pinned (#4289, §1 rule 1's exception) | `PinGlyph` (chat's pin shape, §6.2.2) |
| A folder or file the member starred for themselves, and the Star control (#3934), solid while starred (#4289) | `StarGlyph` |

**Backwork's copy markers are Lucide, on purpose (2026-11-05).** A backwork row marks which copy a file is with one icon per copy type, from one set and in the row's muted text tone (Paul: "with the copy, keep the icons consistent"): `FileCheck` a student copy, `File` a blank copy, `KeyRound` an answer key, and `Lock` beside any of them for a redacted file (`apps/web/components/backwork/backwork-row-parts.tsx`). They are small inline markers beside a text label, not domain glyphs that stand for a screen, so they stay in the control-furniture set rather than the duotone family; a later pass that draws them in the Signet set changes this paragraph and that file together.

Three of the six are re-exports from
[`apps/web/components/layout/nav-glyphs.tsx`](../../../apps/web/components/layout/nav-glyphs.tsx),
which is §1 rule 1's rule and the two preceding families' practice.
`FolderGlyph` is not a re-export, because no nav intent covers a folder (the
sidebar links to Documents as a whole); it draws the nav set's `folder` entry
(Phosphor `folder`, §1.1) so the folder rail's rows stay one family.
`PinGlyph` takes chat's pin shape (§6.2.2), since pinning a message, a
channel and a document is one idea; until #4289 (2026-11-11) it was a
re-export, and it is drawn here now because a document's pin fills solid
while chat's keeps the tinted recipe. `StarGlyph` is drawn here, because no
set entry covers a personal star (#3934). Both
draw their path data from `MARK_GLYPH_PATHS` (`@repo/theme/nav-glyphs`), which
mobile's s12 draws too (`apps/mobile/components/documents/document-glyphs.tsx`,
in the More family's strokes, solid while on since #4289), so the two apps keep one pin and one star.

[`canvas-screens.dc.html`](reference/canvas-screens.dc.html) marks every
document row on **s12** (the Documents screen) and **s21** (the upload sheet)
with a file glyph, which `/documents` did not (the rows carried no glyph at
all), so the leading marker was added with the pack change rather than left
for a later pass. Since 2026-11-05 that marker is the nav set's `file-text`
(§1.1), not the board's file geometry. s12 also draws a two-tone split on its
folder rail: the *pinned* rows take the accent and the ordinary rows the
neutral paint. Since #3934 (2026-11-11) web has the pin field: the Pinned cards
above All files take the accent duotone and the Starred ones the neutral
paint, a pinned or starred row lights its Pin or Star, and document rows
otherwise keep the neutral paint. (Before #3934 this paragraph said web had no
pin field, which was true then.)

Two of the swaps were corrections rather than a pack change, in §6.2.4's sense:

- `/polls` drew `RefreshCcw`, which §6.2.3 already recorded as "a stray second
  spelling of §6.2.2's `RefreshCw`". It was the last one in the tree. (The
  page itself was retired in #3871.)
- `/reports` marked **Generate report** with `FileSpreadsheet` and **Download
  PDF** with `FileText` — a spreadsheet labelling a report, and a generic page
  labelling the PDF. Both now name what the control produces.

- **Control furniture**, unchanged from §6.2.2's rule: `Loader2`, `Trash2`,
  `Upload`, `Download` and `RefreshCw`. This family has fewer of the second
  kind than Chapter Ops — every one of these is a verb on a button or a
  spinner, not the thing a row is *about*. Note `FolderOpen` survives in
  [`apps/web/components/shared/nested-states.tsx`](../../../apps/web/components/shared/nested-states.tsx)
  and is deliberately **not** this family's to move: §6.2.3 already records
  that the state family's glyphs migrate with a pass over
  `components/shared/**`, not with a screen family.

### 6.2.5a Activity rows (Signet duotone)

Since #4173 (2026-11-11) every `/activity` row leads with a 40px neutral tile
holding its kind's glyph at 20px in `--muted-foreground`
([`apps/web/components/activity/activity-row-lead.tsx`](../../../apps/web/components/activity/activity-row-lead.tsx)),
or, for an event, its month and day in place of a glyph. The phone's Activity
rows draw the same lead at the same sizes in `text.mutedForeground`
([`apps/mobile/components/activity/activity-row.tsx`](../../../apps/mobile/components/activity/activity-row.tsx),
#4173 step 2), and both read which shape a kind takes from one map,
`ACTIVITY_GLYPH_NAV` in `@repo/hooks`. The glyphs are
the nav set's (§1.1), so a row draws the shape of the place its record lives;
`link` and `confirm` were added for the two kinds that have no place of their own.
They stay neutral: the page's colour is for asks and status.

A row from another member leads with that member's face instead
([#4463](https://github.com/pdcarlson/Frapp/issues/4463), 2026-11-12): their
photo or initials on their tint in a 40px circle, with the same kind glyph at
12px in a 20px `--surface-1` disc with a 1px `--border` on the face's lower
corner (on the phone, 12pt in a 20pt `surface1` disc with a hairline border).
The glyph keeps its neutral colour there; only the member's own tint is
coloured. Which rows take a face:
[`spec/ui/web-dashboard/README.md` § Activity](../web-dashboard/README.md#activity).

| Row kind | Shape (nav set key, Phosphor name) |
|---|---|
| Your task, a task you assigned | `tasks`, `seal-check` |
| A task waiting on your confirm | `confirm`, `check-circle` (added for it) |
| Hours to approve | `service`, `hand-heart` |
| Poll | `polls`, `chart-bar` |
| Event whose start can't be read (no date to draw) | `events`, `calendar-dots` |
| Sign-up link | `link`, `link` (added for it) |

### 6.2.6 Settings & Roles (Signet duotone) — no family file, deliberately

The #920 Settings & Roles slice is the one family that ships **no
`*-glyphs.tsx` of its own**, and the reason is worth recording so the next
reader does not file it as an omission.

| Semantic intent | Glyph |
|---|---|
| The presidency transfer, and any card that is *about* a role rather than about editing one | `RolesGlyph`, imported from [`nav-glyphs.tsx`](../../../apps/web/components/layout/nav-glyphs.tsx) |
| The Stripe portal the danger-zone card opens | `BillingGlyph`, same source |

Two intents, and both were already drawn. A module holding nothing but two
re-exports is a second path to the same glyphs — the thing §1 rule 1 bans and
the cutover skill calls out by name ("do not add a parallel token set next to
the one in use"; "a definition or `index.ts` re-export is not evidence anything
still calls it"). The four preceding family files each earn their place by
drawing at least one glyph no nav intent covers; this family has none to draw.
(Since 2026-11-05 the geometry of those glyphs, folder, schedule, invite and
profile, lives in the shared set in `packages/theme` with the nav glyphs; the
family files still own the intent and the component.)

**The tab rail stays text-only.** Its triggers (`SETTINGS_TABS`) carry no icons, and adding them would
be new design rather than a repaint — the Canvas reference draws Settings
(**s16**) as titled sections with no per-row glyph either.

Everything else in the family is control furniture and stays Lucide per
§6.2.2: `Loader2`, `Trash2`, `Plus`, `X`, `ChevronDown`, `ChevronRight`,
`Lock`. So is `AlertTriangle` on the danger-zone card — it is the danger marker
[`async-states.tsx`](../../../apps/web/components/shared/async-states.tsx)
draws for the same tone, not a domain intent.

### 6.2.7 Profile & pre-auth (Signet duotone)

The #920 Profile & pre-auth slice — `/profile`, the onboarding wizard and
tutorial, and the routes outside `(dashboard)`. Family file:
[`apps/web/components/profile/profile-glyphs.tsx`](../../../apps/web/components/profile/profile-glyphs.tsx),
homed in `profile/` because `ProfileGlyph` is a profile intent, though its one
consumer today is the onboarding tutorial; §6.2.3's rule applies, so importing
across a directory is fine and redrawing is not.

| Semantic intent | Glyph |
|---|---|
| You — the viewer's own account (tutorial slide 7) | `ProfileGlyph`, defined here; its shape is the nav set's `profile` entry (Phosphor `user`, §1.1) |
| An invite link (s02's hint card on `/join`) | `LinkGlyph`, **drawn here** |
| Chat, Events, Backwork, Study hours, Points (tutorial slides 2–6) | `ChatGlyph`, `EventsGlyph`, `BackworkGlyph`, `StudyGlyph`, `PointsGlyph`, re-exported from [`nav-glyphs.tsx`](../../../apps/web/components/layout/nav-glyphs.tsx) |
| Directory search (the wizard's no-results state) | `SearchGlyph`, same source |
| Locked out of the chapter (`/no-access`) | `LockGlyph`, re-exported from [`chat-glyphs.tsx`](../../../apps/web/components/chat/chat-glyphs.tsx) |

**Two defined here, and both were genuinely undrawn.** `ProfileGlyph` has no nav
intent to re-export because Profile left the sidebar for the account menu in
the Wave 0 restructure, and neither neighbour is it: `DirectoryGlyph` is a
group and `InviteGlyph` is a person *plus a mark*, the officer issuing a
token. All three draw the nav set (§1.1), so the tutorial's slides 2–7 are one
family. `LinkGlyph` is transcribed from the s02 hint card, which draws a chain
link — reusing `InviteGlyph` there would contradict the drawing, and
[`../README.md`](../README.md)'s precedence rule puts the board first. It is
legitimately stroke-only, the `AttachGlyph` exception: an open curve fills into
a lens-shaped wedge across the break that makes the two halves read as links.

**Deliberately not in this table:**

- **The ✦.** `chapter-wizard.tsx` marked its header eyebrow with Lucide's
  `Sparkles` and the tutorial marked its welcome slide with it. §11 reserves ✦
  for the Ask entry point — it "MUST NOT mark anything that is not an Ask/AI
  entry point" — so this is the third time that correction has been made,
  after the slash-command trigger (§6.2.2) and `WandSparkles`. Neither site
  gained a replacement: the wizard's eyebrow now carries **no glyph**, because
  its label already names the intent, which is how the points adjustment
  dialog resolved the same question (§6.2.3); and the tutorial's welcome slide
  takes the **mark**, because the slide is literally a welcome to Frapp.
- **`SignetMark`.** Locked emblem B (gold crest on charcoal)
  ([`components/auth/signet-mark.tsx`](../../../apps/web/components/auth/signet-mark.tsx))
  is a brand composition governed by [`../brand-identity.md`](../brand-identity.md)
  §2, not an icon drawn to §1's duotone recipe — the same carve-out §6.2.2
  makes for the ✦ text glyph and s04's `#` channel sigil. It ships two sizes,
  s01's 52px and §7's 30px app-bar chip.
- **The §10 state family's `FolderOpen`, `AlertTriangle` and `WifiOff`**, which
  §6.2.3 already records belong to `components/shared/**` rather than to any
  screen family.
- **Control furniture**, per §6.2.2: `Loader2`, `ArrowLeft`, `ArrowRight`,
  `Check`, `CheckCircle2`, `Copy` and `PencilLine`. `CheckCircle2` on the
  tutorial's final slide is the borderline one and stays furniture: "confirm"
  is a state the shared family already draws, and inventing a "done" intent no
  other surface has would be new design rather than a repaint.

**The wizard's steps stay text-only**, as Settings' tabs do (§6.2.6):
adding per-step icons is new design, and the reference draws neither.

### 6.3 Maintenance Rule

Any new icon choice — duotone glyph or interim pack pick — MUST be added to
this map in the same PR that introduces it.
