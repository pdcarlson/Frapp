# Navigation and information architecture for Signet: what to keep from Discord/Slack muscle memory, and a concrete restructure

**Bottom line:** Signet's current 7-section, 16-item web sidebar is over-chunked and organized by internal feature-family rather than by how a chapter member actually thinks. Three of the seven sections carry only one or two items (Communications = Polls alone; Overview = Chat + Profile; Finance = Billing + Reports), which is exactly the pattern the design literature says wastes section headers. None of the four reference apps — Discord, Slack, Notion, or Linear — uses that many labeled sections; they anchor daily-use surfaces at the top, push identity and configuration to the edges, and lean on a **Cmd/Ctrl+K** search/command entry that all four share (a rare piece of cross-app muscle memory Signet should copy verbatim). The recommendation below collapses Signet to a chat anchor plus **3–4 task-based sections**, moves Roles/Study Zones/Reports into a role-gated admin area (following Linear's model where members literally cannot see admin pages), trims the mobile tab bar to a deliberate 5, and places both the global search and the future AI "Ask" pill in a persistent top bar rather than consuming a scarce tab slot.

## How the four reference apps handle the five dimensions

| Dimension | Discord | Slack | Notion | Linear |
|---|---|---|---|---|
| **Top-level grouping** | Server rail + per-server channel list grouped into collapsible **categories** [support.discord](https://support.discord.com/hc/en-us/articles/1500000056121-Keyboard-Navigation-FAQ) | Left nav tabs (Home, DMs, Activity, Files); channels split into **sections** incl. user-made custom sections [slack](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences) | Sidebar sections: Favorites, Teamspaces, Shared, Private + nestable page tree [notion](https://www.notion.com/help/navigate-with-the-sidebar) | Deliberately **short** sidebar: Inbox, My Issues, Pulse, Reviews, Favorites [linear](https://linear.app/docs/inbox) |
| **Settings location** | Gear at **bottom-left**; server config via right-click [support.discord](https://support.discord.com/hc/en-us/articles/1500010454681-Accessibility-Settings-Tab) | Profile menu → Preferences → Navigation [slack](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences) | **Bottom of sidebar** + workspace switcher [notion](https://www.notion.com/help/navigate-with-the-sidebar) | Settings pages, **role-gated** (members can't access admin) [linear](https://linear.app/docs/members-roles) |
| **Search / command palette** | Quick Switcher **Ctrl/⌘+K**, prefixes `*@#!` [support.discord](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher) | Jump-to **⌘/Ctrl+K**; search **⌘/Ctrl+G** [slack](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts) | Search **⌘/Ctrl+P** or **K**; type "settings" to jump [notion](https://www.notion.com/help/search) | Command menu **⌘/Ctrl+K**; global search `/` [linear](https://linear.app/docs/search) |
| **Grouping/collapse behavior** | Categories collapse/expand, **user-controlled, no numeric auto-threshold** [support.cci.drexel](https://support.cci.drexel.edu/getting-connected/discord/discord-server-navigation-bar/) | "More" tab hides Later/Tools; sections collapsible, **user-controlled** [slack](https://slack.com/help/articles/16764236868755-An-overview-of-Slacks-new-design) | Show "5 pages to all" with a **More** overflow; keep Favorites small [notion](https://www.notion.com/help/navigate-with-the-sidebar) | Keeps top nav short; pushes everything else to **Views + command menu** [linear](https://linear.app/docs/custom-views) |
| **Mobile vs desktop** | Bottom tabs: **Servers, Messages, Notifications, You** [discord](https://discord.com/blog/improving-our-mobile-experience) | Bottom tabs: **Home, DMs, Activity, Search, More** [slack](https://slack.com/help/articles/41214514885907-Use-simplified-layout-mode-in-Slack) | Bottom bar: **Home, Search, Inbox, Create** [notion](https://www.notion.com/help/workspaces-on-mobile) | **Customizable** bottom toolbar; pin items [linear](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile) |

Two findings from this table matter most for Signet. First, **none of these products relies on many labeled sections** — Linear keeps roughly five top-level items and pushes the rest into search and Views; Discord and Slack let users create their own groupings rather than shipping a fixed 7-section taxonomy. Second, **all four converge on Cmd/Ctrl+K** as the search/command accelerator. Signet's users arriving from Discord and Slack already have this reflex; adopting it is free findability.

## The transferable rules that constrain Signet's structure

**Sidebar sections should earn their place.** Short-term memory holds roughly seven chunks, but menus rely on *recognition* not *recall*, so "7±2" is not a literal cap on menu length [nngroup](https://www.nngroup.com/articles/chunking/). The real rule is that section headers exist to *chunk related items so users can scan* [nngroup](https://www.nngroup.com/articles/chunking/) — a section containing one item (Signet's "Communications: Polls") adds visual overhead with no grouping payoff. Material's navigation-drawer guidance is more concrete: use a drawer with grouping only at **five or more destinations**, and place the most frequent destinations at the top [sap](https://www.sap.com/design-system/fiori-design-android/v25-8/components/m3-standard-components/navigation-drawer/usage).

**Mobile tab bars max out at 3–5.** Apple's HIG says "use three to five tabs" and the minimum needed [apple](https://developers.apple.com/design/human-interface-guidelines/components/navigation-and-search/tab-bars); iOS's own tab controller **auto-inserts a "More" screen once you exceed five items** [apple](https://developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/ViewControllerCatalog/Chapters/TabBarControllers.html). Material likewise caps bottom navigation at 3–5 and says to avoid more than five [material](https://m1.material.io/components/bottom-navigation.html). Signet's current **Home, Chat, Events, Points, Profile + More = five visible + More is exactly at the ceiling** — there is no room to add, only to choose better.

**Whatever goes behind "More" pays a measurable discoverability tax.** NN/g's quantitative study found hidden navigation caused a **>20% drop in content discoverability** versus visible or combination navigation, was used far less (57% vs 86% on mobile), and increased task time [nngroup](https://www.nngroup.com/articles/hamburger-menus/). Their rule of thumb: **four or fewer top-level items should be visible; hide only what exceeds that** [nngroup](https://www.nngroup.com/articles/hamburger-menus/). Practically, the mobile "More" menu is where infrequent features go — so anything a member touches weekly must be a visible tab.

**Group by the user's mental model, not the org chart.** The relevant heuristic is "match between the system and the real world" — use the user's language and logical ordering [nngroup](https://www.nngroup.com/articles/match-system-real-world/) — and card sorting is the method for discovering how users actually cluster features [nngroup](https://www.nngroup.com/articles/card-sorting-definition/). Signet's "Operations / Communications / Resources / Finance" labels are officer/administrative framing, not how a sophomore thinks about "what do I owe, what's tonight, am I in good standing."

**Search supplements but cannot replace navigation.** Search should be global and available "on every page" as an escape hatch when users get lost [nngroup](https://www.nngroup.com/articles/search-visible-and-simple/), but it forces recall and carries higher interaction cost than browsing, so it can't be the primary path [nngroup](https://www.nngroup.com/articles/search-not-enough/). A command palette specifically should only be leaned on "after the plain path is already strong," to avoid pushing beginners into hidden expert behavior [uxpatterns](https://uxpatterns.dev/patterns/advanced/command-palette). This matters because Signet's users are students, not the keyboard-first engineers Linear optimizes for — the visible sidebar must stay strong, with Cmd+K as an accelerator layered on top, not a crutch.

## What's wrong with Signet's current 7-section IA

Evaluating each grouping against a chapter member's mental model:

- **"Communications: Polls" is a section of one** and should not exist. In Discord, polls happen inside channels; a member's mental model puts polls *next to chat*, not in a standalone administrative bucket. Fold Polls into Chat (channel polls) or, short-term, into the engagement section — and delete the Communications header.
- **Study Hours are miscategorized as a Resource.** "Study session" and "Study Zones" sit under Resources alongside Documents/Backwork, but a member does not think of required study hours as reference material — they think of them as *an accountability requirement*, the same bucket as Points, Tasks, and Service Hours. Study belongs with Operations-type items, not the document library. This is the clearest mental-model mismatch in the current IA.
- **Study Zones is configuration, not a daily surface.** Geofence definitions are set up once by an officer; they belong in admin/Settings, not in a member's everyday nav.
- **Roles is configuration, not "People."** It currently sits under People with Members/Alumni, but Roles = permissions administration. Discord places roles under *Server Settings*, and Linear gates admin pages away from members entirely [linear](https://linear.app/docs/members-roles). Move Roles to a role-gated Settings/Admin area.
- **Alumni does not need to be a top-level item.** For a member, Members and Alumni are both "the directory." Alumni is a low-frequency, distinct roster — better as a tab/filter *inside* a single Directory surface than as its own sidebar line.
- **Profile does not belong in top navigation.** Every reference app puts identity at an edge: Discord's "You" tab and gear, Slack's profile menu, Notion's account at the bottom. Move Profile to a bottom-left avatar/account menu, freeing top-nav (and a mobile tab) for something used daily.
- **The Finance section (Billing + Reports) mixes audiences.** Billing/dues is member-facing ("what do I owe"); Reports is officer analytics. Split them: dues stays member-visible, Reports moves to admin.

## Recommended web IA — concrete mapping for `nav-config.ts`

Restructure from **7 sections → a chat anchor + 3 member sections + a role-gated admin group**. Every item below is a direct destination for one of the 16 current items:

| Current item | New home | Notes for the agent |
|---|---|---|
| Chat | **Top anchor** (no section header, first item) | Primary daily driver; keep it immediate, Discord-style |
| Polls | Fold into **Chat** (channel polls) | Delete the "Communications" section |
| Events | **Chapter** section | member-facing |
| Tasks | **Chapter** section | |
| Points | **Chapter** section | member view = "my points/standing" |
| Study Hours (Study session) | **Chapter** section | rename to "Study Hours"; move OUT of Resources |
| Service Hours | **Chapter** section | |
| Documents | **Resources** section | true reference library |
| Backwork | **Resources** section | |
| Members | **Directory** section | Alumni becomes a tab/filter inside this |
| Alumni | tab inside **Directory** | not a top-level item |
| Billing | **Finance** (or rename "Dues") | member-facing "what I owe" |
| Profile | **Account menu** (bottom-left avatar) | out of top nav |
| Roles | **Settings / Admin** (role-gated) | permissions config |
| Study Zones | **Settings / Admin** (role-gated) | geofence config |
| Reports | **Settings / Admin** (role-gated) | officer analytics |
| Settings | **Bottom** (gear, role-gated) | |

Resulting member-visible sidebar: **Chat** (anchor) · **Chapter** {Events, Tasks, Points, Study Hours, Service Hours} · **Resources** {Documents, Backwork} · **Directory** {Members+Alumni} · **Finance** {Dues} — four labeled groups instead of seven, each carrying enough items to justify its header [nngroup](https://www.nngroup.com/articles/chunking/). Officers additionally see the **Admin** group. This mirrors Linear's "short curated sidebar + gated admin" pattern [linear](https://linear.app/docs/inbox) rather than exposing every configuration surface to every member.

One label to card-sort before locking: the engagement bucket is called "Chapter" here, but "Activity," "Chapter Life," or even leaving those five items ungrouped under the chat anchor are all defensible. Because it's the section doing the most work, a quick card sort with a handful of chapter members is the single highest-value validation step [nngroup](https://www.nngroup.com/articles/card-sorting-definition/).

## Recommended mobile tab bar

Current: Home, Chat, Events, Points, Profile, More (5 + More, at the iOS ceiling [apple](https://developer.apple.com/library/archive/documentation/WindowsViews/Conceptual/ViewControllerCatalog/Chapters/TabBarControllers.html)). Two of these slots are weak: **Profile** is identity (belongs in a top-bar avatar, as Notion's mobile bar omits a profile tab entirely [notion](https://www.notion.com/help/workspaces-on-mobile)), and a standalone **Points** tab is a static number that Home can surface.

Recommended 5 tabs, chosen by daily frequency so nothing weekly-use lands behind the 20%-discoverability-tax "More" menu [nngroup](https://www.nngroup.com/articles/hamburger-menus/):

**Home · Chat · Events · Tasks · More**

- **Home** = a standing dashboard (points, dues owed, open tasks, next event) — the "am I in good standing" glance, mirroring Slack/Notion Home-first mobile design [notion](https://www.notion.com/help/workspaces-on-mobile).
- **Chat** = the Discord-replacement anchor; consider making it the default landing tab given the "chat as immediate as Discord" requirement.
- **Events** = what's happening / RSVP.
- **Tasks** = the most *actionable* daily surface (Points is shown inside Home).
- **More** = Members/Directory, Documents, Backwork, Study Hours, Service Hours, Dues, Settings.

The **Points-vs-Tasks** choice for the fourth slot is a genuine judgment call — if your chapter checks their points ranking more than their assigned tasks, swap them. This is exactly the kind of item Linear made user-customizable on mobile [linear](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile); a customizable tab bar is a reasonable fast-follow but not required for beta.

## Where global search and the AI "Ask" pill sit

**Global search / command entry — top bar, persistent, opened by Cmd/Ctrl+K.** Put a visible search field/pill in the top bar on every screen (NN/g: search must be global and available from every page as an escape hatch [nngroup](https://www.nngroup.com/articles/search-and-you-may-find/)), and bind **Cmd/Ctrl+K** to a quick-switcher that jumps to any channel, page, or member. This is the one pattern all four reference apps share [support.discord](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher) [slack](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts) [notion](https://www.notion.com/help/search) [linear](https://linear.app/docs/search) — copying the shortcut gives migrating users instant familiarity. Keep it an *accelerator* over a strong visible sidebar, not a replacement, since Signet's students aren't keyboard-first power users [uxpatterns](https://uxpatterns.dev/patterns/advanced/command-palette).

**AI "Ask" pill — top bar, adjacent to search, persistent across all surfaces (as already spec'd).** Because "Ask your chapter anything" is the product's differentiator, the Ask pill should be visually distinct and prominent in the top bar, placed right next to the search entry so the whole "find/answer" mental model lives in one corner. Critically, **do not spend a mobile tab slot on it** — the tab bar is already at capacity, and burning a scarce slot on a not-yet-built RAG feature is premature. A persistent top-bar pill makes Ask reachable from every screen on both platforms without displacing a daily-use tab. Whether Search and Ask are two adjacent pills or one unified input is a smaller decision; given the differentiator positioning, a distinct, slightly-more-prominent Ask pill next to a plainer search icon reads more clearly than merging them.

## Where more research would change the recommendation

Two areas would sharpen this. First, **a lightweight card sort with 5–8 actual chapter members** on the 16 features would empirically settle the judgment calls flagged above — the "Chapter" section label, whether Polls reads as chat-adjacent or engagement, and the mobile Points-vs-Tasks slot — replacing my inference about student mental models with data [nngroup](https://www.nngroup.com/articles/card-sorting-definition/). Second, the exact contents and audience of **"Reports"** and **"Study Zones"** aren't fully specified in the canvas; if Reports turns out to include member-facing standing data (not just officer analytics), it may belong in Finance/Home rather than admin. Both are cheap to resolve internally and would only refine, not overturn, the core restructure.