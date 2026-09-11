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

**This table names the locks; it does not restate their values.** Every row below except the last is
already owned by another document, and the values live there only — a second copy that is correct
today is still a defect ([`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md)).
Follow the link before building anything that depends on a specific hex or an exact wording.

| Lock | What a lane needs to know | Owned by |
| ---- | ------------------------- | -------- |
| Emblem | Locked emblem B is the shipping mark, and the vocabulary for describing it is closed. Read the banned list there before writing any copy about it | [`../brand-identity.md`](../brand-identity.md) §2 |
| Mark colors | Fixed gold on a fixed charcoal field. Do not sample them from a screenshot and do not restyle them piecemeal | [`../assets.md`](../assets.md) §1, [`../brand-identity.md`](../brand-identity.md) §2 |
| Mark never retints | The mark and logo **MUST NOT** take the chapter accent, ever. Chapter theming recolors product UI; the brand itself does not move. Restated in full because it is the lock a greenfield lane is most likely to break by accident, wiring the mark to `--primary` along with everything else | [`../brand-identity.md`](../brand-identity.md) §2 |
| No Frapp chrome | No customer-facing "Frapp" string, wordmark, or legacy bone/bronze/Geist visual on this surface. Code identifiers, `@repo/*` packages and `frapp.live` domains stay as they are | [`../brand-identity.md`](../brand-identity.md) §1 |
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
| 3 | [#2142](https://github.com/pdcarlson/Frapp/issues/2142) | Chat: channels, kill the Details rail, bottom composer | |
| 4 | [#2144](https://github.com/pdcarlson/Frapp/issues/2144) | Resources, Backwork, Documents | |
| 5 | [#2146](https://github.com/pdcarlson/Frapp/issues/2146) | Directory, Finance, Admin | |
| 6 | [#2145](https://github.com/pdcarlson/Frapp/issues/2145) | Chat cold load and performance | |
| 7 | [#2147](https://github.com/pdcarlson/Frapp/issues/2147) | Chapter accent, 404 and error polish | |

[`deletion-checklist.md`](deletion-checklist.md) is the shared acceptance list across lanes 2 to 7.

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
- **Restore flows and the USPTO search**, including anything that would reopen the mark or
  commission the brand artwork that search still blocks. The mark is locked; see §2 and
  [`../brand-identity.md`](../brand-identity.md) §2, which owns what is and is not commissioned.

---

## 5. Contents

| File | Owns |
| ---- | ---- |
| [`tokens.md`](tokens.md) | What lane 1 landed in the theme package, and the open locks that are still unresolved |
| [`deletion-checklist.md`](deletion-checklist.md) | The acceptance checklist of chrome the greenfield removes |
| [`reference/`](reference/README.md) | Staging area for the Claude Design framework HTML and packs |
