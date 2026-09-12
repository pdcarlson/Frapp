# Web greenfield

> **Governing spec for the web UI rebuild** tracked by
> [#2140](https://github.com/pdcarlson/Frapp/issues/2140). This directory is the committed home of
> the Claude Design web framework. While the epic is open, this directory outranks
> [`../web-dashboard/`](../web-dashboard/README.md) on anything visual or structural that the two
> disagree about.

The goal the framework exists to serve: the web surface should read **dense, consumer-dark, and
FITFO**. More content space, less generated chrome. Every rule below is downstream of that.

---

## 1. Trust order

Highest wins. This is the whole point of the directory, so it is stated first.

| Rank | Source | Why it ranks here |
| ---- | ------ | ----------------- |
| 1 | [`reference/`](reference/README.md) in this directory | The committed Claude Design framework HTML and packs. Committed HTML beats written docs, the same rule [`../README.md`](../README.md) already applies to the Canvas boards. |
| 2 | The rest of this directory | The written lane record: tokens, deletions, open locks. |
| 3 | [`../mobile/`](../mobile/README.md) | The shipped Signet consumer surface. Where the web framework is silent, mobile is the precedent, because the two are meant to read as one product. |
| 4 | [`../design-system/`](../design-system/README.md), [`../brand-identity.md`](../brand-identity.md), [`../assets.md`](../assets.md) | Tokens, components, accent engine, brand. Still canonical for everything the framework does not overrule. |
| 5 | [`../web-dashboard/`](../web-dashboard/README.md) | **Distrust while #2140 is open.** See below. |

### Why `web-dashboard/` is distrusted, and what that does not mean

`web-dashboard/` documents the surface **as #920 built it**. The greenfield is deliberately
replacing much of that, so on any point of visual or structural conflict the framework wins and the
`web-dashboard/` text is stale by construction, not by accident.

Three things this does **not** license:

- **It is not deleted, and it is not wrong about behavior.** Its navigation map, permission and
  module gating semantics, routing and redirect rules, and data contracts are still the truth, and
  most of them are owned by [`../../behavior/`](../../behavior/README.md) anyway. Distrust the
  *chrome*, not the *contracts*.
- **It is not a licence to skip reading it.** A lane that changes a surface still has to know what
  that surface currently does before replacing it.
- **Drift is not filed against it during the epic.** A gap between `web-dashboard/` prose and
  greenfield code is expected while lanes land. When #2140 closes, the surviving truth folds back
  into `web-dashboard/` and this directory is archived or retired in that same change.

### Precedence that still binds

[`../../behavior/`](../../behavior/README.md) outranks everything in this directory. This tree
governs presentation. It never changes what the product does.

---

## 2. Brand locks

Binding for every lane, and none of them negotiable inside #2140.

**This table is a routing table, not a second copy of the brand.** Every row except the last is owned
elsewhere, and a second copy that is correct today is still a defect
([`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md)), so the
values live at the link and not here. Follow it before building anything that turns on a specific
hex or an exact wording. Links carry heading anchors on purpose: a bare `§2` in prose is checked by
nothing, while an anchor is verified by the `link-check` job.

One row deliberately breaks that rule and says so in place.

| Lock | What a lane needs to know | Owned by |
| ---- | ------------------------- | -------- |
| Emblem | Locked emblem B is the shipping mark, and how it may be *described in copy* is constrained by that section's opening rule — read it before writing any product or marketing string about the mark. (The separate "Banned logo vocabulary" list under it governs future mark **exploration**, not copy, and does not answer this question.) | [`brand-identity.md` § 2 The mark](../brand-identity.md#2-the-mark) |
| Mark colors | Fixed gold on a fixed charcoal field. Do not sample them from a screenshot and do not restyle them piecemeal | [`assets.md` § 1 Status](../assets.md#1-status-locked-emblem-b), [`brand-identity.md` § 2](../brand-identity.md#2-the-mark) |
| Mark never retints | The mark and logo **MUST NOT** take the chapter accent, ever. Chapter theming recolors product UI; the brand itself does not move. **This is a restatement**, kept because it is the lock a greenfield lane is most likely to break by accident, wiring the mark to `--primary` with everything else. If the rule is ever narrowed at its owner, this copy has to be narrowed with it | [`brand-identity.md` § 2](../brand-identity.md#2-the-mark) |
| No Frapp chrome | No customer-facing "Frapp" string or wordmark, and no legacy bone/bronze/Geist visual on this surface. Code identifiers, `@repo/*` packages and `frapp.live` domains stay as they are. Three owners, not one: the naming rule, the Geist rejection, and the bone/bronze freeze each live in a different section | naming [§ 1](../brand-identity.md#1-identity) · Geist [§ 3](../brand-identity.md#3-decisions-recorded-as-of-this-doc) · bone/bronze [§ 5](../brand-identity.md#5-what-still-ships-legacy) |
| No em dashes | **New with this epic**, and the only row here without a prior home. Product copy on the web greenfield does not use em dashes. See the scope note below | this document, until it moves |

### Scope note on "no em dashes"

This lock is about **product copy on the web greenfield surface**: UI strings, empty states, error
text, labels, and anything else a member reads in the app. It is a de-slop rule, not a
typographical purge.

It deliberately does **not** reach two places:

- **Already-approved microcopy in [`../design-system/writing.md`](../design-system/writing.md) §7.**
  Several approved strings contain em dashes, including the shipped connection-state copy
  (`You're offline, messages send when you reconnect.` renders today with an em dash). Those strings
  are approved and shipped on more than one surface. Rewriting them is a writing.md change with its
  own review, not a side effect of a token PR. A greenfield lane that touches one of those strings
  should rewrite it and update writing.md §7 in the same change.
- **Repository prose.** Specs, ADRs, code comments, and commit messages are unaffected. The existing
  `spec/` tree uses em dashes throughout by house style.

No CI check enforces this lock today. It is a review rule.

---

## 3. Map to the #2140 lanes

| Lane | Issue | Owns | Status |
| ---- | ----- | ---- | ------ |
| 1 | [#2143](https://github.com/pdcarlson/Frapp/issues/2143) | Spec lock, foundation tokens, chapter accent | This directory plus [`tokens.md`](tokens.md) |
| 2 | [#2141](https://github.com/pdcarlson/Frapp/issues/2141) | Shell: sidebar, top bar, kill the command palette, scrollbars | Consumes the tokens from lane 1 |
| 3 | [#2142](https://github.com/pdcarlson/Frapp/issues/2142) | Chat: channels, kill the Details rail, bottom composer | Landed, with four board items deliberately left — see below. Adds the **full-bleed route contract** |
| 4 | [#2144](https://github.com/pdcarlson/Frapp/issues/2144) | Resources, Backwork, Documents | Landed. Flattens both routes onto the shell, deletes their narration and wrapper cards, and takes the upload dialogs to board `1j`. The board draws **no** Documents or Backwork page body, so the list grammar is derived — see [`deletion-checklist.md`](deletion-checklist.md) §8 |
| 5 | [#2146](https://github.com/pdcarlson/Frapp/issues/2146) | Directory, Finance, Admin | **Directory and Finance landed; Admin still open.** The issue says "can split PRs" and this lane took it, one PR per third. **Directory:** `/members` (actives + alumni) is flush on the shell, its three-plus-N wrapper cards, its table, its checkbox column and its card-grid view are gone, and its empty states are split three ways — the board draws **no** Directory page body, so the grammar is derived exactly as lane 4's was, in [`deletion-checklist.md`](deletion-checklist.md) §9. **Finance:** `/billing` is flush on the shell with plan status on the page, `4d`'s plan panel and plan matrix, `4b`'s PRO chip and the past-due banner — the board *does* draw this one, so §10 records the two places it describes a product this codebase does not have, and the merge of the route's two duplicate invoice lists that flattening forced |
| 6 | [#2145](https://github.com/pdcarlson/Frapp/issues/2145) | Chat cold load and performance | |
| 7 | [#2147](https://github.com/pdcarlson/Frapp/issues/2147) | Chapter accent, 404 and error polish | |

[`deletion-checklist.md`](deletion-checklist.md) is the shared acceptance list across lanes 2 to 7.

### What lane 3 left on the board, and why

Recorded here because "landed" above would otherwise read as "`1b` and `1t` are done", and they are
not. None of these is an oversight; each would have taken the lane outside the greenfield's scope,
which [`deletion-checklist.md`](deletion-checklist.md) defines as chrome rather than capability.

| Board item | Why not in lane 3 |
| ---------- | ----------------- |
| `1b` pin 5, the channels column's `+` | There is no create-channel surface anywhere in `apps/web` for it to open. Adding one is a new capability, not a restyle |
| `1b` pin 6, presence dots on DMs | No presence data reaches the channel list. Same reason |
| `1b` pin 11, member count in the channel header | `ChatChannel` carries `member_ids` for DMs only, so there is no count for a public channel. The chapter roster size would be wrong for `PRIVATE` and `ROLE_GATED`, and a wrong number is worse than none |
| `1t`, ops-setup nudge → locked-row sheet | The replacement is the nav's locked-module explainer (`1h`), which is lane 2's surface and was not built. Deleting the nudge first removes an officer-facing prompt with nothing in its place |

One deletion in `1t` that lane 3 **declined** rather than deferred: the board's `⋯` inventory
(`1b` pin 11) omits Search, on the reading that the top bar's find field covers messages. Lane 3 kept
message search inside the `⋯` instead, per `1t`'s own wording ("Search, Pins, Bookmarks, Notification
level buttons → one ⋯ menu merged"), because deleting it outright would move a capability between
lanes. See [`deletion-checklist.md`](deletion-checklist.md) §3 for the one thing the find bar does
not cover today.

### The full-bleed route contract, added by lane 3

Worth knowing before lanes 4, 5 and 7 lay out a route, because it is the one place the shell now
treats routes differently.

`DashboardShell`'s `<main>` insets every route (`px-4 py-4 sm:px-6`) and owns its scroll
(`overflow-y-auto`). Chat cannot live inside that: the board draws it as three flush columns at 100vh
with the channels column hugging the nav's right border and the composer pinned to the bottom of the
viewport (`1b`), and an inset, scrolling `<main>` contradicts all three.

So `components/layout/full-bleed-routes.ts` lists the routes that are handed the frame instead:
`<main>` keeps its landmark, its `#main-content` id and its skip-link target, and drops its padding
and its scroll. `/chat` is the only entry today.

Two consequences a later lane should not rediscover:

- **A full-bleed route owns its own padding**, including for states that are not the main layout. The
  no-chapter empty state in `chat-shell.tsx` carries its own inset for exactly this reason; without
  it, a centred card renders hard against the nav border.
- **It is a route list, not a prop or a context.** The shell is a client component that already knows
  the pathname at first paint. A prop would have to be threaded from a server layout; a context would
  only be readable after an effect, which is one frame of padded chat before it snaps flush.

**Execution rule from the epic:** stacked PRs, one lane per PR, never one mega-PR. The
[cutover rule](../../../.claude/skills/signet-cutover/SKILL.md) still binds inside each lane: a
lane that replaces a surface deletes what it replaced in the same PR.

### Naming

The epic names the commit target `spec/ui/web-shell/`. This directory is `web-greenfield/` because
the work covers more than the shell. If the `web-shell/` name is preferred, rename the directory and
the epic together in one change rather than letting two names circulate.

---

## 4. Non-goals

Out of scope for every lane in #2140. Work in these areas does not belong in a greenfield PR, and a
greenfield PR is not blocked on any of them.

- **Signed-URL upload API** ([#2129](https://github.com/pdcarlson/Frapp/issues/2129)) and any
  backwork upload wire-format work.
- **Apple / Sign in with Apple**, the Apple developer console, and
  [#2120](https://github.com/pdcarlson/Frapp/issues/2120). That stays a human track and MUST NOT be
  blocked on this epic.
- **Stripe secrets in Infisical**, and billing provider configuration generally.
- **Deployment**: Vercel and Render configuration, environment promotion, release mechanics.
- **Restore flows and the USPTO search**, including anything that would reopen the mark or commission
  the brand artwork that search still blocks. The mark is locked; see §2 above and
  [`brand-identity.md` § 2](../brand-identity.md#2-the-mark), which records what that search blocks.
  It does **not** record a commissioning status for the shipping emblem — if a lane needs to know
  whether the committed master may be re-cut, [`assets.md` § 1](../assets.md#1-status-locked-emblem-b)
  is the constraint, and the answer is no.

---

## 5. Contents

| File | Owns |
| ---- | ---- |
| [`tokens.md`](tokens.md) | What lane 1 landed in the theme package, and the open locks that are still unresolved |
| [`deletion-checklist.md`](deletion-checklist.md) | The acceptance checklist of chrome the greenfield removes |
| [`reference/`](reference/README.md) | Staging area for the Claude Design framework HTML and packs |
