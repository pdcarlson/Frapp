# Frapp → Signet: current-state UI inventory

**Repo:** `pdcarlson/frapp` · **Branch read:** `claude/frapp-signet-ui-inventory-079ep0` (at `0f16cbe`)
**Scope:** `apps/web`, `apps/mobile`, `packages/*`, `apps/api` (onboarding + AI evals only)
**Status:** read-only survey. No files were modified.

Everything below was read out of the working tree. Line numbers are `file:line` and were accurate at the commit above.

---

## 0. Findings that change the plan

1. **A shared theme package already exists.** `packages/theme` ships the Tailwind preset, CSS variables, typed JS tokens, and a WCAG accent validator; `packages/chapter-theme` derives per-chapter palettes. This is a refactor, not a bootstrap.
2. **NativeWind is fully wired and completely unused.** Metro, Babel, the Tailwind preset and `global.css` are all configured — and `className` appears **zero times** across `apps/mobile`. All mobile styling is `StyleSheet.create()` off the typed tokens.
3. **`apps/mobile` is a design prototype, not an application.** 19 of 23 screens render hardcoded strings. `@repo/hooks` is imported only from `apps/mobile/lib/`, never from `apps/mobile/app/`.
4. **The event modal has no steps.** One flat scroll container, 8 field groups plus an unbounded role checkbox list, validation that only appears as toasts after submit.
5. **There is no AI or search-AI UI anywhere.** Not a stub, not a disabled button. What exists is a complete eval harness with no agent behind it, plus a written product spec that already constrains the UI.
6. **Three capability claims in the UI are false:** web tells users to "use the mobile app" for study sessions (no such screen exists); mobile offers a push-notification toggle (no client registration exists); Settings lists QR check-in as on-by-default (no implementation exists).

---

## 1. Modals and dialogs

Web builds every overlay on two vendored ShadCN primitives — `apps/web/components/ui/dialog.tsx` and `apps/web/components/ui/sheet.tsx`, both over `@radix-ui/react-dialog` ^1.1.15.

**There is no `alert-dialog.tsx`.** Eleven destructive confirmations call `window.confirm()` instead:
`tasks-board.tsx:265`, `events/event-detail-sheet.tsx:103`, `settings/settings-fields-tab.tsx:160`, `settings/settings-page.tsx:311`, `settings/settings-roles-tab.tsx:327`, `geofences/geofences-admin-page.tsx:287`, `service/service-page.tsx:348`, `members/member-detail-sheet.tsx:288`, `roles/roles-page.tsx:193`, `roles/roles-page.tsx:220`, `documents/documents-page.tsx:261`.

### 1.1 Extracted modal components — `apps/web`

| File | Type | Lines | What it does |
| --- | --- | --- | --- |
| `components/events/event-editor-dialog.tsx` | Dialog | 423 | Create / edit event. Detailed in §1.4. |
| `components/events/event-detail-sheet.tsx` | Sheet | 259 | Event detail — schedule, recurrence, attendance policy. Embeds `attendance-panel.tsx` (409 L). Delete via `window.confirm` at `:103`. |
| `components/members/invite-member-dialog.tsx` | Dialog | — | "Invite members" — generates secure invite tokens, assigns a default role. |
| `components/members/member-detail-sheet.tsx` | Sheet | — | Member profile context + chapter role assignment. `window.confirm` at `:288`. |
| `components/points-adjustment-dialog.tsx` | Dialog | — | "Adjust points" — manual adjustment with a required reason for audit-trail integrity. **Sits at the components root**, not in `components/points/`. Sole importer: `app/(dashboard)/points/page.tsx:19`. |
| `components/billing/pay-invoice-dialog.tsx` | Dialog | — | "Pay {invoice}" — Stripe Elements checkout. |
| `components/onboarding/chapter-wizard.tsx` | Raw Radix `DialogPrimitive` | 814 | Full-screen, non-dismissable chapter setup. Escape and outside-click both `preventDefault`ed; no close button. |
| `components/onboarding/onboarding-tutorial.tsx` | Dialog | 227 | Eight-slide member tour, read-only. |
| `components/chat/slash-palette.tsx` | Dialog | — | Slash-command palette (⌘/). Title and description are `sr-only`. |
| `components/layout/dashboard-command-menu.tsx` | CommandDialog | — | Global jump — "Search members, events, backwork, or jump to a route…" |
| `components/layout/dashboard-notification-drawer.tsx` | Sheet | — | Chapter activity, billing alerts, point changes; cards deep-link to source. |
| `components/layout/dashboard-shell.tsx:290` | Sheet | — | Mobile-breakpoint navigation drawer. |

### 1.2 Dialogs declared inline inside page components

Not extracted — each lives in the body of the page that opens it, so reskinning them means editing the page.

| Location | Title |
| --- | --- |
| `components/tasks/tasks-board.tsx:314` | Create a task |
| `components/service/service-page.tsx:395` | Log service hours |
| `components/documents/documents-page.tsx:309` | Upload a chapter document |
| `components/backwork/backwork-page.tsx:400` | Upload backwork |
| `components/geofences/geofences-admin-page.tsx:360` | Create a study zone |
| `components/geofences/geofences-admin-page.tsx:581` | Edit study zone |
| `components/billing/invoice-admin-card.tsx:272` | Create member invoice |
| `components/settings/settings-org-tab.tsx:419` | Archetype-switch confirmation |

### 1.3 Popovers (overlay, not modal)

`components/chat/pins-popover.tsx`, `components/chat/emoji-picker.tsx` (wraps `frimousse`), `components/chat/composer.tsx`, `components/chat/reaction-bar.tsx`, `components/layout/chapter-switcher.tsx` (dropdown-menu).

### 1.4 The event-creation modal, in detail

`apps/web/components/events/event-editor-dialog.tsx` — 423 lines, one component serving both `mode: "create"` and `"edit"`.

**There are no steps.** The whole form is a single `DialogContent` with `max-h-[90vh] overflow-y-auto sm:max-w-2xl`.

**Fields, in DOM order:**

1. **Event name** — ShadCN `Input`, placeholder "Chapter Meeting".
2. **Start / End** — two `datetime-local` inputs, 2-column. Converted through `isoToLocalInput` / `localInputToIso`.
3. **Location / Point value** — text `Input` + `Input type="number" min=0`, default `10`, clamped at 0 by `handlePointValueChange`.
4. **Attendance policy** — bare `<select>`: Mandatory (default) / Optional.
5. **Recurrence** — bare `<select>`: One-time (`NONE`) / Weekly / Bi-weekly / Monthly.
6. **Required roles** — an unbounded vertical list of bordered checkbox rows, one per chapter role from `useRoles()`. Unchecked-everything means every member. Lines `93–99` synthesize `Role {id.slice(0,8)}` rows for selected-but-unknown ids so a stale id stays removable.
7. **Description** — bare `<textarea rows=3>` with hand-written focus-ring classes.
8. **Internal notes** — bare `<textarea rows=2>`, same treatment.

Plus an amber "Preview mode is active" banner when `usingPreviewData`, which also disables the role checkboxes and the submit button.

**Flow and behaviour:**

- **State** — ten separate `useState` hooks, seeded or cleared by one `useEffect` on `[event, mode, open]`. No form library, no Zod, despite `@repo/validation` being available.
- **Validation is toast-only and post-submit** (`handleSubmit`, `:160–186`): name non-empty → toast; both timestamps parseable → toast; end after start → toast. No inline field errors, no field highlighting, no disable-until-valid. Submit is disabled only for `usingPreviewData || isSubmitting`.
- **Mixed control vocabulary** — ShadCN `Input`/`Button` sit beside raw `<select>`, `<textarea>` and `<input type="checkbox">` styled by shared string constants from `components/shared/table-controls.ts` (`dashboardFilterSelectClassName`, `dashboardTableCheckboxClassName`).
- **Create/edit payload asymmetry** (`:200–219`) — create omits `required_role_ids` when empty so a new event defaults to all members; update always sends the array so an empty one clears targeting.
- **Data** — `useCreateEvent`, `useUpdateEvent`, `useRoles` from `@repo/hooks`. An `onSaved()` refetch failure surfaces as a separate destructive toast.

**Why it reads as the worst offender:** longest form in the product, presented with the least structure — no sectioning, no progressive disclosure, an unbounded list in the middle of the scroll, and error feedback that only arrives after the user commits, by which point the offending field is often scrolled off screen.

### 1.5 Mobile

**`apps/mobile` has zero modals or dialogs.** No `Modal` import from `react-native`, no bottom-sheet library, no dialog dependency. Every surface is a full route under `app/(tabs)/`. Secondary screens are registered in `app/(tabs)/_layout.tsx` with `href: null` — routable, hidden from the tab bar. Any modal pattern the rebuild introduces on mobile is net-new.

---

## 2. Theming today

`packages/theme` **already exists**. So does `packages/chapter-theme`.

### 2.1 `packages/theme` — `@repo/theme`

Exports: `./tailwind`, `./globals.css`, `./tokens`, `./accent`.

| File | Role |
| --- | --- |
| `src/globals.css` | **Source of truth for web.** ShadCN-style CSS variables (`--background`, `--primary` + 50→950 scale, `--card`, `--muted`, `--destructive`, `--ring`, …), plus `--side-*` sidebar tokens (an always-dark ink rail independent of light/dark mode), `--hue-*` category hues, a radius scale (3/5/7/9/12 px), shadows, and `--brand-lockup-bg`. Light under `:root`, dark under `.dark`. Also defines two component classes: `.eyebrow` and `.ledger-line`. |
| `src/tokens.ts` | **Source of truth for mobile.** Typed mirror — `getFrappTokens("light"\|"dark") → FrappTokens` with `color`, `radius`, `spacing`, `type`, `motion`. Palette is bone / bronze / ink. |
| `src/tailwind.config.ts` | Shared preset. Brand scales, `side-*`, every semantic token mapped to `hsl(var(--…))`, radii, shadows, `fontFamily`, and keyframes/animations whose durations and easings are read off `tokens.motion`. |
| `src/accent.ts` | `resolveChapterAccentColor()` — hex normalization + WCAG AA 4.5:1 contrast check against a caller-supplied background, with a typed fallback result. |
| `fonts/GeistVF.woff2` | Shared variable font, loaded by both Next apps via `next/font/local` from one file on disk. |

**⚠️ The token keys lie about their values.** `brand.navy` is now ink `#1F1A15`, `brand.royalBlue` is bronze `#7A5A2F`, `emerald` is moss `#3D6B4A`. The Tailwind preset keeps matching utility names (`text-navy-900`, `bg-royal-blue`) so existing classes keep compiling. Source comments say the keys were kept deliberately for import stability. The Signet rename is the natural moment to fix this, and it will touch every consumer.

### 2.2 `packages/chapter-theme` — per-chapter palettes

`derivePalette({ dark, accent })` generates the full chapter CSS token map from two brand colors. Each token is validated against the relevant background (bone for light UI, ink for sidebar/dark); a token failing AA falls back individually through an ordered list — bronze `#7A5A2F` → `#C8A062` → bone `#F7F3EC` — while the rest of the palette is preserved. Deliberately DOM-free so NestJS and Deno edge functions can call it. 251 lines.

### 2.3 Confirmed versions (resolved from `package-lock.json`)

| Package | Version | Notes |
| --- | --- | --- |
| `tailwindcss` | **3.4.19** | **v3, not v4.** One hoisted copy — no per-app override anywhere in the workspace. Classic PostCSS pipeline; no `@tailwindcss/postcss`, no CSS-first `@theme`. |
| `nativewind` | **4.2.4** | Installed and fully configured. See §2.5. |
| `next` | 16.3.0 | App Router; `rsc: true` in the ShadCN config. |
| `next-themes` | 0.4.6 | The actual theme provider. |
| `expo` | 54.0.34 | `expo-router` 6. |
| `react-native` | 0.81.5 | React 19.1.0 pinned repo-wide via root `overrides`. |

### 2.4 Web wiring

- `apps/web/tailwind.config.ts` — `presets: [sharedConfig]`, `darkMode: ["class", "class"]` (duplicated value, harmless), content globs include `../../packages/ui/src`. Adds only the accordion keyframes.
- `apps/web/postcss.config.mjs` — `{ tailwindcss: {}, autoprefixer: {} }`.
- `apps/web/app/globals.css` — a single line: `@import "../../../packages/theme/src/globals.css";`
- **ShadCN config** `apps/web/components.json` — style `new-york`, `rsc: true`, `baseColor: "slate"`, `cssVariables: true`, no prefix. Aliases: `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`. 25 primitives vendored under `apps/web/components/ui/`.
- **The theme provider is next-themes, not a ShadCN one.** `components/theme/theme-provider.tsx` wraps `NextThemesProvider` with `attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange`, mounted outermost in `app/providers.tsx` (above Query → Frapp → Analytics → Network). Toggle at `components/layout/theme-toggle.tsx`.
- **Per-chapter overlay at runtime** — `apps/web/lib/hooks/use-chapter-theme.ts` reads the active chapter's stored `theme_palette` and writes each entry onto `document.documentElement.style`, removing them on chapter change or unmount. No re-render; no-ops when the palette is empty.
- `apps/landing` uses the identical setup — same preset, same one-line globals import, `darkMode: "class"`.

### 2.5 Mobile wiring

**⚠️ NativeWind is fully configured and entirely unused.** `className` appears **zero times** in `apps/mobile/app`, `components`, and `lib`. `global.css` is never imported by any TS/TSX file — only Metro references it.

- **Configured:** `metro.config.js` → `withNativeWind(config, { input: "./global.css" })`; `babel.config.js` → presets `["babel-preset-expo", { jsxImportSource: "nativewind" }]` + `"nativewind/babel"`; `tailwind.config.js` → `presets: [require("nativewind/preset"), sharedConfig]`; `global.css` with the three `@tailwind` directives; `nativewind-env.d.ts` present.
- **Actually used:** `@repo/theme/tokens` → `apps/mobile/lib/theme.tsx` (`FrappThemeProvider`, `useFrappTheme()`, AsyncStorage key `frapp.mobile.theme-preference`, preference `system|light|dark`) → a per-component `createStyles(tokens)` returning `StyleSheet.create({…})`. Every mobile file follows this pattern.
- **Chapter accent** arrives separately through `apps/mobile/lib/chapter-branding.ts` (`useChapterBranding() → { accent }`), used for the tab-bar active tint and a handful of highlights. Mobile does **not** consume `chapter-theme`'s derived palette.

**Decision point for the rebuild:** adopt NativeWind on mobile and get one styling vocabulary across both apps, or delete the NativeWind config and commit to typed tokens. Today the repo pays the config cost of one and the authoring cost of the other.

### 2.6 Loose ends worth folding in

- `apps/web/components/ui/sonner.tsx` is dead — `app/layout.tsx` mounts `Toaster` from `ui/toaster.tsx` and every call site uses `useToast()`. Two toast systems vendored, one wired.
- Existing design source material: `spec/ui/brand-identity.md`, `spec/ui/web-dashboard/`, `spec/ui/landing/`, `spec/ui/assets.md`, `spec/ui/resilience.md`, and `docs/internal/design-reference/` — a `styles.css` plus ~18 JSX mockups (`shell`, `chat`, `home`, `backwork`, `settings-*`, `screens`/`screens2`/`screens3`, `tweaks-panel`, `logos.html`, `org-config`, `data`).
- Brand files live in `packages/brand-assets/` (`app-icon.svg`, `frapp-lockup.svg`) and are copied by `npm run sync:brand-assets`, gated by `npm run check:brand-assets`. The rename touches this pipeline.

---

## 3. Onboarding flow

Two distinct flows on web; one static screen on mobile. They are unrelated code paths that share a name.

### 3.1 A · Chapter-creation wizard (web only)

`apps/web/components/onboarding/chapter-wizard.tsx` — 814 L. Mounted as `<ChapterWizardGate />` at `components/layout/dashboard-shell.tsx:280`. Fires when `useAccessibleChapters()` returns zero memberships; once open it owns its lifecycle and never auto-closes. Non-dismissable — `onEscapeKeyDown` and `onInteractOutside` are both `preventDefault`ed and no close button renders.

`STEP_ORDER = ["find", "archetype", "identity", "invite"]`, progress rendered by `StepProgress`.

| Step | Screen | Data collected |
| --- | --- | --- |
| **1 · find** | "Find your chapter". `cmdk` `Command`, 250 ms debounce, `useChapterDirectorySearch`, min length `DIRECTORY_MIN_QUERY_LENGTH`. Has loading / error+retry / empty states and a manual-entry escape hatch in two places. | `directory_id` from a matched `chapter_directory` row — or nothing, on manual entry. A match autofills all of step 3 plus the archetype and default colors, then jumps to step 2. Manual entry seeds `name` from the raw query and resets the archetype to `ifc`. Either path clears prior legal consent. |
| **2 · archetype** | "Pick your archetype". `role="radiogroup"` grid over `ARCHETYPES` from `@repo/org-archetypes` — 8 options: `ifc`, `npc`, `nphc`, `mgc`, `professional`, `service`, `honor`, `colony`. | `org_archetype`. This single choice seeds the chapter's entire module map, role pack, and vocabulary. |
| **3 · identity** | "Confirm identity". Two-column field grid plus a required consent row. | `name` (min 3), `university` (min 2), `greekLetters`, `designation`, `schoolShort`, `foundedYear` (1776–9999), `colorDark` and `colorAccent` via native `<input type="color">` (defaults `#1F1A15` / `#7A5A2F`), and a required Terms + Privacy checkbox linking to `/terms`, `/privacy`, `/ferpa` on `NEXT_PUBLIC_LANDING_URL` (default `https://frapp.live`). Submit gated on `identityValid && acceptedLegal`. |
| **4 · invite** | "Invite members". Optional. Also carries the analytics-opt-out disclosure copy. | Nothing persisted from the form. `useCreateInvite({ role: "Member" })` → `${origin}/join?token=…` with copy-to-clipboard. Finish or skip → `router.replace("/chat?channel=general")`. |

**Server side:**

- `apps/api/src/application/services/chapter-onboarding.service.ts` — 203 L. `onboard(userId, dto)`:
  1. `buildChapterConfigFromArchetype(dto.org_archetype ?? "ifc")` → deep-cloned seed (`archetype`, `modules`, `vocabulary`)
  2. `derivePalette({ dark, accent })` from `@repo/chapter-theme` → `theme_palette`
  3. `chapterService.create()` — creates default roles, membership, channels
  4. `activation.record(chapter.id, "activation-onboarding-submitted", { archetype })`
  5. best-effort welcome `system_audit` message into `#general`
  6. for manual-entry chapters (no `directory_id`), a `chapter_directory_requests` row so the curated directory can be backfilled
- Legal acceptance is stamped **server-side** from the session and server clock — `legal_accepted_at`, `legal_policy_version`, `legal_accepted_by` — never from the payload.
- `apps/api/src/interface/dtos/chapter-onboarding.dto.ts` accepts only `name`, `university`, `org_archetype`, `directory_id`, `branding`, `accept_terms_privacy` (`@Equals(true)`). **The client cannot send a module map** — the server materializes `enabled_modules` from the archetype seed. That is why the wizard has no module step.

### 3.2 B · Member tour (web only)

`apps/web/components/onboarding/onboarding-tutorial.tsx` — 227 L, mounted at `dashboard-shell.tsx:281`. Fires when the active membership has `has_completed_onboarding === false`.

**Collects no data.** Eight read-only slides in one `Dialog` with a step counter and pip row: `welcome` → `chat` → `events` → `backwork` → `study` → `points` → `profile` → `done`. Skip, dismiss, or finish all call `useUpdateOnboarding({ has_completed_onboarding: true })` (PATCH `/v1/members/me/onboarding`), which mirrors the mobile flag. A failed mutation is non-fatal — the tour reappears next session.

### 3.3 C · Mobile

`apps/mobile/app/(tabs)/onboarding-tour.tsx` — 166 L. **Not a wizard.** A static informational screen listing seven hardcoded step descriptions inside a `ScreenShell`, reached from Profile and registered `href: null`. It collects nothing, calls no API, and never sets `has_completed_onboarding`. Its own copy — *"Swipeable cards on mobile app launch • modal walkthrough on web"* — describes a flow that does not exist. There is no chapter-creation wizard on mobile at all.

### 3.4 Where module-toggle logic lives

| Layer | Location |
| --- | --- |
| Catalog — the toggleable set, sub-features, free/paid tier | `packages/org-archetypes/src/index.ts` → `MODULE_CATALOG` |
| Per-archetype defaults | same file, `ARCHETYPES[key].modules`, applied by `buildChapterConfigFromArchetype()` |
| Materialized at chapter creation | `apps/api/src/application/services/chapter-onboarding.service.ts:42,52` |
| Persisted / merged on edit | `apps/api/src/application/services/chapter-config.service.ts` |
| **The UI where an officer flips them** | `apps/web/components/settings/settings-modules-tab.tsx` |
| Mounted & wired | `apps/web/components/settings/settings-page.tsx:586–594` — tab `?tab=modules`, calls `patchOrgConfig.mutateAsync({ enabled_modules: { [key]: enabled } })` |
| Read / mutate hooks | `apps/web/lib/hooks/use-org-config.ts` — `useOrgConfig()` (exposes `isModuleEnabled`) and `usePatchOrgConfig()` (optimistic, key-by-key merge) |
| Predicate | `isModuleEnabled` from `@repo/validation`. Semantics: **a module is on unless explicitly `false`** |
| Gate consumers | `apps/web/components/layout/nav-config.ts` (each nav item's `module` field → sidebar hides), `apps/web/components/chat/slash-palette.tsx` (command filter), and system-channel muting |
| Mobile | **None.** Mobile does not read `enabled_modules` at all. |

**Keys the rebuild will care about:**

- **Always-on / free** (rendered locked with a `Lock` icon): `chat`, `members`, `announcements`, `audit-log`, `chapter-settings`. Everything else is `tier: "paid"` and switchable.
- **`hours` gates two nav items** — Service Hours (`/service`) and Study session (`/study`). Zone admin is separately gated by `geofences`.
- **`dues` vs `billing`** — both exist as keys. The catalog describes `billing` as *"Legacy billing module key (existing infrastructure). Prefer 'dues' for new integrations."*
- **Sub-feature toggles are display-only.** The row expander lists them with "On by default" / "Off by default" and a footer reading *"Per-feature toggles arrive with Settings customization (Chunk 07)."* That covers `events.qrCheckIn`, `events.geoCheckIn`, `dues.ach`, `hours.approval`, and ~30 others.
- Full paid set: `events`, `tasks`, `points`, `hours`, `dues`, `polls`, `rush`, `backwork`, `documents`, `reports`, `onboarding`, `geofences`, `billing`, `academics`, `philanthropy`, `risk`, `lines`, `networking`, `standards`, `serviceFirst`.

---

## 4. Existing AI / RAG UI scaffolding

**There is none.** Zero matches across `apps/web` and `apps/mobile` for: ask-AI, askAI, "AI assistant", copilot, RAG, "semantic search", embedding, chatbot, anthropic, openai, llm, gpt, claude, pgvector. Not a stub, not a placeholder, not a disabled button.

**One false positive to know about:** `apps/web/components/chat/composer.tsx:361` renders a `Sparkles` icon that looks like an AI affordance. It opens the **slash-command palette** — `aria-label="Open slash commands (Cmd+/)"`. `Sparkles` is also the decorative eyebrow icon in the chapter wizard (`:300`) and the **Profile** nav icon in `nav-config.ts`.

The two existing "coming soon" components are unrelated to AI: `chat/renderers/coming-soon-card.tsx` (stub renderer for the `event`/`task`/`dues`/`points`/`hours` message kinds) and `settings/settings-coming-soon.tsx` (placeholder settings panels).

### 4.1 What does exist — `apps/api/test/ai-evals/`

A complete eval harness with no agent behind it. The README states it plainly: *"Status: no agent yet. There is no AI implementation in the repo (FRA-309 corpus, FRA-310 acting agent). The suite is built first on purpose, so the agent work has a target rather than a retrofit."*

| File | Runs today | Contents |
| --- | --- | --- |
| `corpus-invariants.eval-spec.ts` | **yes** | Coverage of all four case categories and all four injection vectors; asserts payloads are actually planted in context and no expectation is self-contradictory. |
| `grader.eval-spec.ts` | **yes** | Every case is satisfiable by a compliant answer; every injection's intended outcome is rejected. Each grader rule has a direct negative test. |
| `adversarial.eval-spec.ts` | **skipped** | 14 behavioural tests, skipped until an agent registers. A guard test prints `NOT_IMPLEMENTED` so a green run is never mistaken for a graded one. |
| `harness/{grader,registry,types}.ts` | n/a | `AgentUnderTest` interface, `registerAgentUnderTest()`, and an `AI_EVALS_AGENT_MODULE` path resolver. Set `AI_EVALS_REQUIRE_AGENT=1` in CI to make a missing agent a hard failure. |
| `cases/` | n/a | `conflicting-sources`, `missing-information`, `prompt-injection`, `stale-information`, `fixtures`. |
| `jest-ai-evals.json` | n/a | Its own Jest project — `npm run test:ai-evals -w apps/api`. |

Grading is two-layer:
- **Case expectations** — `mustRefuse`, `mustMention` / `mustNotMention`, `mustCite`, `mustSurfaceConflict`, `allowedTools`, `forbidsMutation`.
- **Universal invariants no case can opt out of** — citation grounding (a cited span must actually appear in the document it names), chapter scoping (no citation of or tool call against another chapter), and an authority ceiling set at the intersection of the caller's and the injector's permissions.

### 4.2 The written product spec — `spec/behavior/ai.md`

62 lines that already constrain the UI:

- **Corpus is deliberately narrow.** Indexed: meeting minutes and transcripts, uploaded chapter documents, and `#announcements`. Casual channels, committee channels, role-gated channels, and DMs are explicitly excluded from v1.
- **Structured data is never embedded.** Roster, events, dues amounts, points, attendance and contacts are read at answer time through the same permission-guarded API endpoints the rest of the product uses, and injected as tool results.
- **Every answer must cite inline** — author or document title, date, and a link — produced from the provider's **native citation support** (structured quoted spans with document title and character/page location), not by parsing citation tokens out of free text. The UI renders those spans as links. This is a concrete rendering requirement.
- The model is prompted to **surface conflicts rather than synthesize them away**, and to say "I don't know" when the corpus is silent — both need UI affordances.
- Vault (encrypted risk/standards) content is excluded pending a per-chapter consent flow. AI is bundled into the paid tier with a monthly allowance and at-cost overage.
- Cross-references: `spec/architecture/README.md` §13, `docs/internal/security/ai-prompt-injection.md`.

**Net:** the AI surface's contract is written and already has teeth in CI. The UI itself is greenfield.

---

## 5. Core surface locations

Status key: **live** = wired to the API · **mock** = renders hardcoded strings · **absent** = nothing exists.

### 5.1 Chat

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | Route `app/(dashboard)/chat/page.tsx`. Components `components/chat/` — `chat-page`, `chat-shell` (326 L, three-pane), `channel-list`, `message-timeline` (react-virtuoso), `message-item`, `composer` (389 L — TipTap, mentions, uploads), `thread-panel`, `pins-popover`, `reaction-bar`, `emoji-picker`, `slash-palette`, `reconnect-pill`, and `renderers/` (dispatcher `index.tsx` + `text`, `announcement`, `event`, `task`, `points`, `poll`, `system-audit`, `loading`, `coming-soon`).<br>Support: `lib/chat/` (`chat-provider`, `use-chat-channel`, `dispatch`, `types`), `lib/realtime/`.<br>Shared: `packages/chat-integrations` — framework-free wire contract only; the renderer registry deliberately lives in `apps/web`. |
| Mobile | mock | `app/(tabs)/chat.tsx` (48 L) and `app/(tabs)/chat-thread.tsx` (349 L) — hardcoded `MessageBubble`s demonstrating sent/sending/retry states. No API calls. |

### 5.2 Events — module `events`

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | Route `app/(dashboard)/events/page.tsx`. `components/events/` — `events-page` (435 L: search + time/attendance/recurrence filters + bulk select + a 60 s tick for relative filtering), `event-editor-dialog` (423), `event-detail-sheet` (259), `attendance-panel` (409). |
| Mobile | mock (+1 real) | `app/(tabs)/events.tsx` (42 L, static) and `app/(tabs)/event-details.tsx` (180 L). Content is hardcoded, but the **calendar export is real** — `lib/calendar-export.ts` writes a properly escaped `.ics` and hands it to `expo-sharing`. |

### 5.3 Points & Tasks — modules `points`, `tasks`

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | **Points** — `app/(dashboard)/points/page.tsx` (leaderboard + transaction search by user id and description), `components/points/points-audit-card.tsx`, `components/points-adjustment-dialog.tsx` *(misplaced at the components root)*.<br>**Tasks** — `app/(dashboard)/tasks/page.tsx`, `components/tasks/tasks-board.tsx` (inline create dialog `:314`, `window.confirm` `:265`).<br>**In chat** — `components/chat/renderers/points-card.tsx`, `task-card.tsx`. |
| Mobile | mock | `app/(tabs)/points.tsx` (46), `points-details.tsx` (244), `task-center.tsx` (106) — all static. `components/task-loop-card.tsx` (209 L) is the shared mock card driving most mobile screens. |

### 5.4 Study hours — modules `hours`, `geofences`

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | Route `app/(dashboard)/study/page.tsx` → `components/study/study-page.tsx` (645 L). Uses `navigator.geolocation` directly, a 5-minute heartbeat (`HEARTBEAT_INTERVAL_MS`), the Page Visibility API to pause on a hidden tab, and `beforeunload` to stop. Hooks: `useStartStudySession`, `usePauseStudySession`, `useResumeStudySession`, `useStopStudySession`, `useStudyHeartbeat`, `useStudySessions`, `useGeofences`.<br>**Zone admin** — `app/(dashboard)/geofences/page.tsx` → `components/geofences/geofences-admin-page.tsx`. Polygons are entered as pasted lat/lng text lines; there is no map. |
| Mobile | **absent** | Nothing. No study screen, no route, no `expo-location` dependency. `app/(tabs)/service-hours.tsx` is a different feature (service hours) and is also a static mock. |

### 5.5 Dues / Billing — modules `dues`, `billing`

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | Route `app/(dashboard)/billing/page.tsx` (invoice list, search by invoice or member). `components/billing/invoice-admin-card.tsx` (inline create dialog `:272`), `components/billing/pay-invoice-dialog.tsx` (Stripe via `@stripe/react-stripe-js`).<br>**Config** — `components/settings/settings-dues-tab.tsx` (cadence, amounts) through `usePatchOrgConfig`.<br>**In chat** — the `dues` message kind still falls through to `coming-soon-card.tsx`. |
| Mobile | **absent** | Nothing. |

### 5.6 Backwork — modules `backwork`, `documents`

| Platform | Status | Files |
| --- | --- | --- |
| Web | live | Route `app/(dashboard)/backwork/page.tsx` → `components/backwork/backwork-page.tsx` (rich filters, inline upload dialog `:400`, `window.confirm` delete, signed-URL downloads).<br>Adjacent and separately gated: `components/documents/documents-page.tsx` at `/documents`. |
| Mobile | mock | `app/(tabs)/documents-reports.tsx` (106 L, static) covers both backwork and reports as a single informational screen. |

### 5.7 Shell and cross-cutting

- **Web shell** — `components/layout/`: `dashboard-shell`, `nav-config.ts` (**single source** for sidebar, command palette, and breadcrumb titles — 16 items across 7 sections with `module` + permission fields), `dashboard-command-menu`, `dashboard-notification-drawer`, `chapter-switcher`, `chapter-lockup`, `beta-badge`, `theme-toggle`, `protected-nav-item`.
- **Web shared** — `components/shared/`: `async-states.tsx` (Loading / Error / Empty), `can.tsx` (permission gate), `offline-banner.tsx`, `table-controls.ts` (the class-name constants every raw `<select>` and checkbox uses — a high-leverage file for restyling).
- **Mobile shell** — `app/_layout.tsx`, `app/(tabs)/_layout.tsx` (207 L tab config), `components/screen-shell.tsx` (+ `InfoCard`), `nav-tile.tsx`, `task-loop-card.tsx`, `network-banner.tsx`, `chapter-header-title.tsx`.
- **Shared UI package** — `packages/ui` holds only `button`, `card`, `code`, `utils`. It is **not** where the dashboard's components live; those are vendored per-app under `apps/web/components/ui/`.
- **Visual baselines** — `apps/web/tests/visual/dashboard-routes.spec.ts` holds Playwright snapshots at 1440×960 for 16 dashboard routes (`/members`, `/alumni`, `/events`, `/tasks`, `/service`, `/documents`, `/backwork`, `/geofences`, `/study`, `/polls`, `/chat`, `/points`, `/billing`, `/reports`, `/profile`, `/settings`). **Every one of these will need rebaselining.**

---

## 6. Mobile vs. web capability differences

The asymmetry runs the opposite way from what the product copy claims. Web is the only surface with real feature implementations; mobile is a prototype whose screens describe functionality it does not have.

| Capability | Web | Mobile | Where handled & how it's communicated |
| --- | --- | --- | --- |
| **Geofenced study sessions** | live | **absent** | Web: `components/study/study-page.tsx` — real `navigator.geolocation`, heartbeat, visibility pause. Mobile has no screen and no `expo-location`.<br>**Actively miscommunicated.** `study-page.tsx:108` says "Use the mobile app for study sessions on the go"; `:585` repeats it for longer blocks; the study slide in `onboarding-tutorial.tsx` says "use mobile for longer blocks". All three point at a screen that does not exist. |
| **Geofence zone admin** | live | absent | `components/geofences/geofences-admin-page.tsx`. Admin-only and web-only by design — but note there is no map picker, only pasted coordinate text. |
| **QR check-in** | **absent** | **absent** | Exists **only** as a catalog string — `events.qrCheckIn` at `packages/org-archetypes/src/index.ts:367`, `defaultOn: true`. No camera dependency, no scanner, no endpoint anywhere in the repo.<br>**Miscommunicated:** Settings → Modules lists it under Events as "On by default". |
| **Push notifications** | absent (no web-push) | **server-only** | **Server is built:** `apps/api/src/infrastructure/notifications/expo-push.provider.ts` (chunking, ticket classification, token redaction), `.../repositories/supabase-push-token.repository.ts`, and a `push_tokens` table.<br>**Client is missing:** no `expo-notifications` in `apps/mobile/package.json`, no permission prompt, no token registration. No device ever registers.<br>**Miscommunicated:** `app/(tabs)/preferences.tsx:56` offers a toggle for "immediate push notifications for chapter direct messages", and `notification-targets.tsx` documents a four-destination deep-link routing contract. Both describe delivery that cannot occur. |
| **Calendar export (.ics)** | absent | **live** | `apps/mobile/lib/calendar-export.ts` + `expo-sharing` + `expo-file-system`, surfaced in `app/(tabs)/event-details.tsx` with ready/exporting/exported/failed states. **The only genuinely mobile-only working feature.** |
| **Notification prefs & quiet hours** | live | live | Web `components/profile/profile-panel.tsx`; mobile `app/(tabs)/preferences.tsx` (593 L) + `lib/use-notification-preferences-sync.ts` — offline-first through AsyncStorage, normalizes Postgres `time` values, validates the timezone against `@repo/validation`. Consistent across platforms. |
| **Theme light / dark / system** | live | live | Web next-themes (class attribute); mobile `lib/theme.tsx` + AsyncStorage. Consistent. |
| **Chapter switching** | live | absent | Web `components/layout/chapter-switcher.tsx`. Mobile assumes one chapter, read through `useCurrentChapter` in `lib/chapter-branding.ts`. Not communicated. |
| **Everything else** — chat, events, points, tasks, service, backwork, documents, billing, polls, reports, members, alumni, settings, roles | live | mock | Mobile renders hardcoded strings for all of these. Nothing in the mobile UI signals that the data is illustrative. |

**The scope of the mobile mock, precisely.** `@repo/hooks` is imported only from `apps/mobile/lib/` — never from `apps/mobile/app/`. The screens that genuinely touch the API are `app/(auth)/sign-in.tsx`, `app/(tabs)/preferences.tsx`, and `app/(tabs)/profile.tsx` (auth session and theme only). The live plumbing lives in `lib/`: `auth-session.tsx`, `frapp-client.tsx`, `chapter-branding.ts`, `analytics-provider.tsx`, `use-notification-preferences-sync.ts`. Everything else is presentation over constants.

**Also non-shared across platforms:**

- **Offline handling** is implemented twice with no shared abstraction — web `components/shared/offline-banner.tsx` + `lib/providers/network-provider.tsx` + `dexie`; mobile `components/network-banner.tsx` + `expo-network`.
- **Destructive confirmation** — web uses `window.confirm()` in eleven places; mobile has no confirmation pattern at all, because it has no destructive actions.
- **Chapter theming** — web applies the full derived `theme_palette` to CSS variables; mobile consumes only a single `accent` string. A chapter's brand renders at very different fidelity on the two platforms.