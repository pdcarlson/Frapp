# GitHub Issues as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **GitHub Issues**
(`pdcarlson/Frapp`), per **ADR-16** and its GitHub-migration amendment (`spec/architecture/README.md`).
GitHub Issues is the source of truth for planning and work status. Linear is **retired** — the
decision record, viability probes, and the FRA-→#N migration mapping live in
[issue #680](https://github.com/pdcarlson/Frapp/issues/680).

> **Status: live** (migrated 2026-08-08). Every open Linear issue either already had a GitHub twin
> (the June import) or was recreated as a GitHub issue during the migration; open issues carry
> priority labels. The Linear workspace stays readable until the owner deletes it; no repo
> contract reads or writes it. (Caveat until the owner finishes the wind-down: the legacy
> scheduled Routines and the still-connected Linear GitHub integration can touch it — see
> [`ROUTINES.md`](ROUTINES.md#how-to-create-them-ui) step 8 and #680's checklist.)
>
> **Why the migration:** Linear's MCP write tools (`save_issue` etc.) required a manual permission
> approval in every Claude Code cloud session, and three config-level fixes (#667, #669, #676)
> failed to stop the prompts. The GitHub MCP server is pre-approved by the cloud harness
> (`mcp__github__*` in its `--allowed-tools`), so agents can file, label, and close issues
> unattended. Full evidence trail: #680.

---

## The model

```
GitHub Issues (canonical: planning, status, Triage intake)
   ▲ Claude Code (web) via the GitHub MCP — the path /next uses
   ▲ Claude Code Routines (scheduled: curator + triage + PR follow-ups) via the same GitHub MCP
     (a fourth, Docs Upkeep, writes docs rather than issues — it files nothing here except a
      proven human-only blocker; a fifth, Hygiene Scan, writes product code and files its
      follow-ups here under a per-run cap)
   ▲ PRs close work natively (Fixes #N on merge)
```

- **GitHub Issues is canonical** for what to work on and its status. There is **no fallback
  tracker** — if the GitHub MCP is down, `/next` and the routines stop rather than guessing.
- **All issues are opened on GitHub with the `triage` label.** Never in Linear (retired), never in
  a scratch file. Sole carve-out: **`routine-state`** infrastructure issues (e.g. the
  "PR Follow-ups — Human Action List" tracking issue) are not work and carry `routine-state`
  instead — `/next` and the routines skip them entirely.
- **Work is closed by the PR that does it** (`Fixes #N` in the PR **body** — native GitHub
  close-on-merge, one line per issue the PR closes; GitHub ignores closing keywords in the PR
  *title*, so the body is load-bearing). GitHub also honours `Fixes` **only on merge into the
  default branch** (#962) — that is issue-close
  semantics when the code still reaches `main` via a parent. Squash-merging a PR whose base is
  a feature branch is a **different, worse bug**: CI never runs (`pull_request.branches` is
  `[main]`) and the work never reaches `main` even though GitHub shows MERGED.
  Playbook: [`AGENT_INFRA.md`](AGENT_INFRA.md#ci-branch-filters-never-target-a-feature-branch)
  (incidents #1120, #1123–#1125). Agents may also close an issue directly when it's done,
  obsolete, or a duplicate — see the state table below.
- **Epics are parent issues with native sub-issues** (`sub_issue_write` /
  `issue_read get_sub_issues`). Linear Projects are retired; `project:<slug>` labels may be used
  ad hoc, sparingly, but are not a provisioned taxonomy.
- **Triage is the intake.** New work — human-filed, `/next` follow-ups, curator suggestions —
  is born with the `triage` label and is accepted into the Backlog (label removed, priority set)
  before `/next` will auto-start it. One carve-out: a `/next` run that fixes a defect it discovered
  on its own branch may file the issue and claim it in the same breath — record-keeping for work
  already underway, not auto-starting inbox work.

### How agents reach the tracker

| Actor | Reaches GitHub Issues via | Notes |
| --- | --- | --- |
| **Claude Code** (web, interactive) | **GitHub MCP** (`mcp__github__issue_write` / `issue_read` / `list_issues` / `search_issues` / `add_issue_comment` / `sub_issue_write`) | **The only sanctioned path for tracker work — reads and writes alike.** The MCP is auditable, and writes through it are lossless. Shell access to `api.github.com` is **route-dependent, not session-dependent** (corrected 2026-09-02; the 2026-08-08 observation of both a 403 and a success is explained by route, not by session): the proxied route 403s on every repo-scoped path, the direct one returns 200 from GitHub. **That direct route is never a substitute for the MCP.** If the MCP is unavailable, tracker work **stops and reports** — no `gh`, no REST, no scratch file. REST is sanctioned only *alongside* a working MCP: a verification read of an issue's raw `body` when you need to see what the MCP's read mangled, plus the provider-*settings* paths the MCP exposes no tool for. Never to create, edit, label, close or comment. Procedure and measurements: [The direct REST read](#the-direct-rest-read-ground-truth-for-a-raw-body). `gh` is not installed. No fallback tracker. |
| **Claude Code Routines** (scheduled) | The **same GitHub MCP** — routine sessions run in the same web environment | If the MCP is unavailable at fire time, the routine stops and reports (Docs Upkeep and Hygiene Scan excepted — they write a PR, not issues, and push the branch and report its name when the MCP is down). See [`ROUTINES.md`](ROUTINES.md). |
| **CI / scripts** | `GITHUB_TOKEN` / `GITHUB_PAT` — tracker writes inside GitHub Actions only | The PAT works in Actions and on laptops. Corrected 2026-09-02: it is not dead in a cloud sandbox either — it fails only on the proxied route (403 on repo-scoped paths) and works on the direct one. That is a read channel, not a licence to do tracker work outside the MCP. **Branch protection, from an agent session: run `npm run configure:branch-protection:verify` (read-only; exits 0) and nothing else.** Never the bare `npm run configure:branch-protection` — with no flags it is a **LIVE `PUT`** of the whole protection payload (`scripts/configure-branch-protection.mjs` prints `Mode: LIVE`). Never `npm run configure:branch-protection --dry-run` **without the `--` separator** — npm swallows the flag (reproduced on npm 10.9.7), the script sees zero args, and it **applies**. *Applying* stays a human step with an admin PAT — policy, not lack of capability. PAT policy: [`AGENT_INFRA.md`](AGENT_INFRA.md). |

---

## States (labels + native issue state)

GitHub has no workflow states, so the board states are a convention over labels and the native
open/closed + `state_reason` fields:

| State | Representation |
| --- | --- |
| **Triage** (intake) | open + **`triage`** label |
| **Backlog** (accepted, ready) | open, no state label. A priority label is the *expected* state (promotion requires setting one), but unprioritized Backlog issues exist (e.g. migrated ones) — `/next` ranks them last and the triage routine's grooming pass is what fixes them; never "fix" one by re-adding `triage` |
| **In Progress** | open + **`in-progress`** label — a projection of a live `AGENT-CLAIM` comment (the claim protocol in [`next.md`](../../../.claude/commands/next.md) is authoritative) |
| **In Review** | open + **`in-review`** label + a linked open PR |
| **Done** | closed as **`completed`** (usually by `Fixes #N` on merge) |
| **Canceled** | closed as **`not_planned`** |
| **Duplicate** | closed as **`duplicate`** with `duplicate_of` naming the canonical issue |

**Promotion out of Triage requires setting a priority label** — mirroring Linear's "require
explicit prioritization" rule. Remove `triage` and add exactly one `P1`–`P4` in the same update.

## Labels and priority (lean taxonomy)

- **Priority is a label:** **`P1`** (urgent — drop everything) · **`P2`** (high) · **`P3`**
  (medium) · **`P4`** (low). Exactly one per triaged issue; absent = unprioritized (ranked last,
  not startable out of Triage). Mapped 1:1 from Linear's Urgent/High/Medium/Low at migration.
- **`area:<x>`** groups by surface. The canonical roster is the one in
  [`ROUTINES.md` → Tracker access](ROUTINES.md#tracker-access-shared-by-all-routines), which routine
  self-maintenance keeps current. This file links to it rather than holding a second copy — the two
  lists had already drifted apart (#1077), which is what a duplicated enum does.
- **`suggestion`** is the routine-ownership marker (which issues the backlog routines own) — the
  hard boundary for destructive routine writes.
- **`stale`** marks an aging suggestion that can't be *proven* resolved — kept, left open.
- **`triage`**, **`in-progress`**, **`in-review`** are the state labels above.
- **`routine-state`** marks routine infrastructure issues (cross-run state stores, never work) —
  excluded from `/next` candidacy and from every routine's triage/grooming scope.
- **`scope:production`** marks work that only becomes relevant once a production environment
  exists. Added 2026-08-10 on the owner's decision to defer production and make staging the
  near-term goal. These issues are **parked by choice, not blocked and not stale**: routines must
  not mark them `stale`, must not raise their priority for age, and must not re-file duplicates of
  them. The production Render service being suspended and `frapp-web` having no production
  deployment are intentional states, not findings. Revisit when production becomes a goal; see #814
  for the decision record. **Caveat (2026-08-30):** this bullet's premise — that production does not
  yet exist — no longer holds. `frapp-prod` is live and `deploy-production.yml` deploys to it
  (`spec/architecture/README.md` ADR-20). Its provider-guardrail preflight briefly failed on the
  retired Vercel Git integration and blocked production deploys; #1579 inverted that assertion on
  2026-09-02 (canonical record: ADR-21 in `spec/architecture/README.md`, with its 2026-09-02
  amendment; the CI-driven Vercel deploy that replaces the integration is still #1578). The label's scope is the
  owner's to redefine, so nothing here changes on an agent's initiative; but do not read this
  bullet as evidence that a production-shaped risk is theoretical. Tracked in #1381.
- Legacy labels from the pre-Linear era (`bug`, `Improvement`, `release:*`) persist on old issues;
  `release:*` still drives version bumps ([`AGENT_INFRA.md`](AGENT_INFRA.md)). Don't extend the
  legacy set to new issues.
- Labels **auto-create on first use** (verified 2026-08-08: applying a nonexistent label via
  `issue_write` creates it), so there is no provisioning step — but stick to the rosters above and
  the linked `area:*` list; a typo'd label is a real label.

**Blocked-by has no native relation.** Express dependencies as a **`Blocked by #N`** line in the
issue body's meta block. `/next` §1.1 verifies blockers against the repo, not the tracker, before
honoring them; the triage routine adds/corrects the lines.

**`[human]` items are held by their title, not by `triage`.** The hold rule below keys on the
`[human]` prefix, but until 2026-08-16 the only thing that actually kept `/next` off them was the
`triage` label — so any routine or human that promoted one exposed it (#709 was already through).
`/next` §0.2 now reads the title directly; the label is a convenience. Match the **whole leading
bracket run**, case-insensitively: `[pr-followup][human] …` (#805, #806, #811–#813, #826) does not
begin with `[human]`. The `**Human action required — hold in triage` body opener is the third
recognised form, for items predating the prefix (#908, and #765/#689 which carry no bracket at
all).

**Epics ARE claimable, deliberately.** `/next` exists to always find an agent useful work, so its
candidacy filter stays permissive: it excludes only what an agent genuinely cannot do. A parent
issue is ordinary work — an agent picking up an epic and shipping a slice of it is a good outcome,
not a failure mode, and there is **no epic filter in §0.2**. Do not add one, and do not add an
`epic` label expecting it to gate anything.

**What is guarded is closing an epic, not claiming one.** The real hazard is a single-slice PR
carrying `Fixes #<epic>`: the merge closes the parent with its remaining slices unwritten, and
unlike a claim, a merge is not reversible. So the rule lives at PR-authoring time (`/next` Phase 4):

> `issue_read get` each issue the PR names. When `has_children: true` and any child is still open,
> write **`Part of #N`** instead of `Fixes #N`. `Fixes` is correct again once
> `sub_issues_summary` shows `completed >= total`, or when every open child is a member of the
> same PR.

Gate that on `has_children`, **not** `sub_issues_summary` alone — the summary is documented as
*optional* and is returned only when children exist (verified 2026-08-16: #426 carries both, #718
and #947 carry neither), so `total > completed` reads `undefined > undefined` → false when it is
missing and fails open into the irreversible case.

**Attach an epic's slices as native sub-issues when you file them.** That is what makes the Phase 4
guard able to see them at all. #718 and #720 are both `[Epic]` with `has_children: false` because
nobody ever attached their slices — a PR could close either with `Fixes` today and nothing would
notice. `Blocked by #N` lines remain worth adding on such an epic; §1.1 re-verifies them against
the repo, so they degrade honestly as slices land.

**Estimates** are an optional **`Estimate: <fibonacci>`** line in the body meta block (0,1,2,3,5,
8,13,21) — sizing context for `/next`'s batching caps, never a filter or gate.

## Agent briefs (depth / model / ultracode)

Unchanged from the Linear era. An issue's description may carry a machine-readable
**`### Agent brief`** section:

```markdown
### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<optional one line on where the depth should go>
```

- **`depth`** — how far past the literal ask to investigate. `skim`: genuinely mechanical;
  `standard`: well-bounded single-surface work; `deep`: load the subsystem, verify against spec
  **and** runtime, hunt adjacent defects, widen review. **Default is `deep`** — an absent brief or
  field means `deep`.
- **`model`** — suggested tier for the session that picks it up (`fable` for cross-cutting,
  architectural, security-sensitive, or subtle-correctness work). Advisory, read at spin-up.
- **`ultracode`** — whether multi-agent orchestration likely pays for itself.

**Who writes it:** the curator files every suggestion with a brief; the triage routine backfills
and corrects briefs on `suggestion`-owned issues only. Human-filed issues get a brief only from a
human; an absent brief reads as `depth:deep`. **Who reads it:** `/next` honors `depth` when
scaling verification and review (never skipping steps, never shrinking `/diff-review`).

## `/next` (the work-selection command)

[`.claude/commands/next.md`](../../../.claude/commands/next.md) is the canonical **procedure**:
pull the **Backlog** (open, non-`triage`, unclaimed) ranked by **priority label** (P1→P4; unlabeled
last), tie-break by lower issue number, drop anything with a live `Blocked by #N` (verified against
the repo), never auto-start `triage` items, and **stop if the GitHub MCP is unavailable**. It keeps
the tracker in sync (`in-progress` on claim, a comment trail, the PR link) and opens the PR with
`Fixes #N`.

It stays a **command**, not a skill: `/next` is the user-invocable work-selection entry point.
Skills are playbooks loaded when relevant. This section is policy. Where they disagree, **this
document wins** and `next.md` is the bug — fix the command, don't fork policy into it.

- **The claim is a comment; the label is a projection of it.** GitHub has no compare-and-swap —
  `issue_write` is last-write-wins. Issue comments are append-only and server-timestamped
  (`created_at`), so the `AGENT-CLAIM` / `AGENT-HEARTBEAT` / `AGENT-RELEASE` protocol carries over
  from the Linear era unchanged in design. One GitHub-specific delta: the MCP **cannot edit
  comments**, so leases renew by posting a fresh `AGENT-HEARTBEAT` comment (same `claim_id`);
  liveness is judged on the newest heartbeat's server timestamp.
- **Claim first, verify second.** Selection and claim happen before expensive verification.
- **Assignees tell you nothing.** The only evidence of live work is a live claim comment, a branch
  named in one, or a linked PR.
- **Leases and leaked claims:** 4-hour lease renewed per heartbeat; expired-lease takeover via
  `AGENT-RECLAIM`; an `in-progress` issue with no claim comment and no linked PR for 72h is
  swept back to Backlog (label removed) with an `AGENT-STALE-FLAG`.
- **Closing:** on merge, `Fixes #N` closes each named issue as `completed` natively — no tool call
  needed. Direct closes use
  `issue_write` with `state: closed` + the right `state_reason` (`completed` / `not_planned` /
  `duplicate` + `duplicate_of`).

## Filing an issue (agents)

Everything an agent files (follow-ups from `/next`, curator suggestions, PR-followup harvest):

- Born **open + `triage`** with a **priority label** proposed (the triage routine confirms),
  **`suggestion`** when routine-owned, exactly one **`area:<x>`**.
- Body: summary · meta block (`Blocked by #N` / `Estimate:` as applicable) · problem/context with
  exact `file:line` refs · acceptance criteria (objectively verifiable checkboxes) · an
  **Agent brief**.
- **`fp=` dedup markers are the routines' mechanism, per-namespace.** They are **visible lines,
  not HTML comments** — and they stay that way even though the read that forced the change has
  recovered, because the defect has flipped four times and a visible line costs nothing (see
  [Reading a body you intend to rewrite](#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity)).
  The curator embeds `` `agent-suggestion: v1 fp=<area>/<slug> file=<path>` ``; the PR Follow-ups
  harvester embeds `` `agent-suggestion: v1 fp=pr-followup/<slug> pr=#<N>` ``; human-action
  blockers (filed by *any* session, see below) embed
  `` `agent-suggestion: v1 fp=human/<slug> source=<...>` `` (namespaces partition lifecycle
  ownership — PR Follow-ups owns both `pr-followup/` and `human/`). The `fp=` grammar is unchanged,
  so existing dedup queries keep working, and **legacy comment-form markers remain valid** — they
  are stored, merely unreadable, so a missing marker means "unknown", never "absent". Ad-hoc
  filings (`/next` follow-ups, review deferrals) need no marker.
- **Search before filing** (`search_issues`, open **and** closed) — refresh a near-match instead
  of duplicating it. This applies to every filing path, marker or not.
- **Human-action blockers (owner mandate 2026-08-12):** when an agent has *proven* a step needs
  the human (environment config, missing credential/account, dashboard-only step, purchase — and
  no better-provisioned agent session could do it either), it must file the blocker — title
  **`[human] <imperative action>`**, labels `triage` + `suggestion` + one `area:<x>` + a
  priority, body opening with `**Human action required — hold in triage; not for /next.**`, plus
  the attempt, the failure output as proof, the exact steps for the human, and an
  `fp=human/<slug>` marker. These stay in Triage (the hold exception — never promoted, never
  started by `/next`); the PR Follow-ups routine owns the `fp=human/` namespace — it lists every
  open item on the weekly Human Action List and closes them on proof (which is why `suggestion`
  is mandatory). Dedup for any filing path must also search `[human]` titles so a held blocker
  doesn't get a promotable twin. Full playbook:
  [`.claude/skills/file-follow-up/SKILL.md`](../../../.claude/skills/file-follow-up/SKILL.md).
- **Sourcing a body rewrite from an MCP read is permitted while the fidelity table is green and
  current** — all three read paths were measured faithful 2026-09-05, and a rewrite you authored
  yourself was always safe. Re-run the probe before a bulk pass. See
  [Reading a body you intend to rewrite](#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity)
  below; it is the canonical statement of that rule and the routines defer to it.

### Clearing human-action items (the owner's side)

Filing and publishing are only half the loop: a `[human]` item is done when the owner acts, and
until then everything queued behind it waits. [`/needs-me`](../../../.claude/skills/needs-me/SKILL.md)
is the consumer of that output — it sweeps the Human Action List, open `fp=human/` and `[human]`
`fp=pr-followup/` issues, the `triage` inbox, and open PRs, ranks the candidates by what clearing
each one releases, and walks **exactly one** to done, closing it on proof.

It is a reader, not a routine: it files nothing (the one exception being a newly proven
blocker, per the hard rule above), asks before closing anything outside the `suggestion` label's
[ownership boundary](#ownership-boundary-organize-broadly-destroy-narrowly), and never rewrites
the Human Action List — that body is rebuilt from live issue state by the PR Follow-ups routine on
every run, so a hand-edit there is both overwritten and capable of destroying its state marker.

## Reading a body you intend to rewrite (MCP read fidelity)

**Every GitHub MCP read path returns an issue body faithfully — measured 2026-09-05.** All three
vectors that used to corrupt a read are clear on all three paths. **This has now flipped four
times, so the measurement, not the prose, is what you trust**: re-run [the probe](#re-verifying-this-the-probe)
before any bulk rewrite, and treat a stale date on this table as "unknown", not "fine".

| Read path | HTML comments (`fp=` markers) | HTML/JSX tags | `'` `"` `&` `>` | Safe to re-body from? |
| --- | --- | --- | --- | --- |
| `issue_read method:get` | ✅ intact | ✅ intact | ✅ literal | **Yes**, as of 2026-09-05 |
| `list_issues fields:["body"]` | ✅ intact | ✅ intact | ✅ literal | **Yes**, as of 2026-09-05 |
| `search_issues fields:["number","title","body"]` | ✅ intact | ✅ intact | ✅ literal | **Yes**, as of 2026-09-05 |
| direct REST `body` (ground truth) | ✅ intact | ✅ intact | ✅ literal | **Yes**, always |

Measured by round-tripping fixture **#1736**, which was written for this purpose and carries all
three vectors including the historical discriminator (five `<Tabs.Screen …/>` lines inside a
` ```tsx ` fence). Every path returned it byte-identical to the raw REST body. **Vector 2 is the one
that matters** — it is the only vector whose failure is unrecoverable, and the only one an earlier
round cleared by accident: the 2026-08-11 pass passed while a `tsx` fence was still being eaten,
because it checked HTML comments alone.

The three vectors, kept here because a future regression will present as one of them:

1. **HTML comments** — an `<!-- agent-suggestion: v1 fp=… -->` marker. When this vector fails the
   marker vanishes from both the read *and* the search index, so the curator re-files the issue as
   net-new. Markers stay **visible lines** regardless of this table (see below) — that is deliberate
   insurance against the next flip, not a workaround for the last one.
2. **Unrecognised tags**, including JSX *inside fenced code blocks*. Unrecoverable by convention: a
   dropped marker can be reconstructed from `fp=<area>/<slug>`, a dropped code snippet cannot.
3. **`'`, `"`, `&`, `>` entity-escaped** — inside code fences the quoted JSON, SQL and shell stop
   being copy-pasteable. This vector alone *is* mechanically reversible.

The tag sanitizer, when active, is **allowlist-based, not blanket** — `<br>` survives while
`<Tabs.Screen …/>` does not. That is why the defect reads as intermittent, and why `<br>` is a
control rather than a signal in #1736.

**The write side has never been the problem.** `issue_write` stores what it is given; content
written years ago is still byte-present. Every round of this has been a read-side defect.

### The damage a lossy read already did

While vector 3 was live, a rewrite that round-tripped a body through a read **baked the escaped form
into storage**. That damage does not heal when the read recovers — it is now the stored text.

Nine bodies were found damaged by a corpus scan on 2026-09-05 (529 issues updated since 2026-08-19,
read raw over REST): **#357** (repaired), and **#714 #1034 #1146 #1150 #1164 #1204 #1381 #1521**
(identified, repair tracked in **#1737**). #1381 is the worst — the owner's own quoted words carry
`&#39;`/`&#34;`, and escaped `&gt;` has broken its blockquotes.

Re-run the scan with the recipe in [The direct REST read](#the-direct-rest-read-ground-truth-for-a-raw-body).
Three hits are **legitimate and expected**: #1736 (the fixture stores escapes on purpose), #1725,
and #357's repair note — each quotes an escape sequence as documentation rather than suffering one.

**The other read surfaces are clear too.** **Issue comments** (`issue_read get_comments`) were
re-measured 2026-09-05 against [#1736's comment control](https://github.com/pdcarlson/Frapp/issues/1736#issuecomment-5552915853),
which carries the same three vectors: all intact. **PR bodies** (`pull_request_read get`) return
vector 3 literally in the same session. When the sanitizer *is* active it runs on all of these, so a
regression will show up here as well as in issue bodies — re-check a comment, not only a body.

### The operative rule

**A body rewrite sourced from an MCP read is permitted while the table above is green and current.**
That is a conditional permission, not a standing one — this defect has flipped four times, so:

- **Confirm before a bulk pass.** One issue is a judgement call; a sweep over dozens is not. Re-run
  [the probe](#re-verifying-this-the-probe) against #1736 first and say in your write-up that you
  did. A green table dated weeks ago is evidence about a past MCP version, not this one.
- **Prefer a comment when the edit is additive.** `add_issue_comment` is lossless in both directions
  and needs no probe. Rewrite a body when the body is *wrong*, not to append news to it — that
  preference is about keeping issues readable, and it survives whatever the read is doing.
- **Author-your-own-text is always safe.** A body you composed this run never round-trips through a
  read, so it needs no probe and no escape hatch. This is unchanged.
- **Use the raw REST body when the stakes are high** — a `[human]` item, an epic, anything long or
  quote-heavy. [The direct REST read](#the-direct-rest-read-ground-truth-for-a-raw-body) is ground
  truth by construction rather than by measurement, so it is correct even mid-regression. That call
  is a verification read, **not** a tracker path: it does not license tracker work over REST, and it
  is not an MCP fallback (if the MCP is down, stop and report).
- **If the probe is red, fall back to the old rule:** never source a rewrite from a read; append a
  comment instead; and if you must rewrite, take the body from REST, confirm it holds **no HTML
  comment and no tags anywhere including inside code fences**, and un-escape vector 3
  (`&#39;`→`'`, `&#34;`→`"`, `&amp;`→`&`, `&gt;`→`>`) before writing back. Deleted content cannot be
  un-deleted; only escaping is reversible — which is exactly how the nine damaged bodies above
  happened, and why they were recoverable.

### The `fp=` marker is a visible line, not an HTML comment

**This contract does not relax when the read recovers.** It was forced by a sanitizer that ate HTML
comments out of both the read *and* the search index — one root cause, two symptoms — and that
sanitizer is currently off. The contract stays anyway, because it has flipped four times and a
visible line costs nothing while a re-filed duplicate costs a human's attention:

```markdown
`agent-suggestion: v1 fp=<area>/<slug> file=<primary-path>`
```

The `fp=` grammar is unchanged, so every existing dedup query keeps working. **Legacy
`<!-- agent-suggestion … -->` and `<!-- cursor-suggestion … -->` comment markers are still valid
and still stored**, and as of 2026-09-05 they are readable again — but treat a missing marker as
"unknown", never as "absent", and never re-file on that basis alone. That rule is unchanged too: it
protects against reading a stale fidelity table as if it were a fresh measurement.

### Lookup still works — dedup is broken once, not twice

`search_issues` is a **semantic** matcher, but it resolves `fp=` fingerprints exactly. Verified
2026-08-20:

| Probe | Result |
| --- | --- |
| `fp=docs/search-issues-marker-roundtrip-regression` | 1 hit (#1086) — precise true positive |
| `fp=drop-theme-brand-aliases` | 1 hit (#917) — precise true positive |
| `fp=zzz/this-fingerprint-does-not-exist-anywhere-qqxz` | **0 hits** — correct true negative, no semantic noise |
| `repo:pdcarlson/Frapp is:issue "fp=…"` | 1 hit — qualifier syntax is tolerated, not poisoning |

So the dedup *step* needs no redesign. A historical `"agent-suggestion"` search returning 0 is the
comment-stripping defect showing up in the index, **not** evidence of a broken matcher — do not
re-derive that conclusion.

**But confirm the hit before acting on it.** The matcher is semantic, so how cleanly a fingerprint
resolves depends on how distinctive its slug is. A distinctive one returns exactly its issue
(`fp=drop-theme-brand-aliases` → #917, alone). A **generic** one also pulls in topical near-matches:
`fp=docs/backfill-missing-dedup-markers` returns **4** issues — #697 (the real holder, ranked first)
plus #1086, #857 and #800, none of which contain that string. They simply happen to be *about*
dedup markers.

That matters because the dedup rule is *"if found → skip"*, and skipping on a topical near-match
files nothing where something new belonged — a **false skip**, which is silent and worse than a
duplicate. So the rule is:

> **A hit counts only if the returned body actually contains the literal `fp=` string.** Check the
> top result's body for it; if it isn't there, keep reading down the results, and treat "no body
> contains it" as *not found*.

This check is only possible because markers are now **visible lines** — the same change that fixed
the read also made the lookup self-verifying. Prefer distinctive slugs when minting new
fingerprints; two or three specific words beat a generic phrase.

**It is index-backed, so it lags writes.** A just-created or just-edited issue can be missing from
`search_issues` for a short window. Never treat an empty result on a fresh issue as "no marker";
allow a retry before concluding a write failed.

### Re-verifying this (the probe)

**The probe runs against fixture #1736, and against nothing else.** That issue exists only to be
read: it carries all three vectors including the discriminator, its body states its own expected
values, and it is labelled `routine-state` so no routine treats it as work. **Do not edit it** —
its body *is* the expectation, so an edit silently invalidates every future run.

This replaced keying the probe on #357 and #697, which were real issues whose bodies nobody
guaranteed would hold still. #357's ` ```tsx ` fence was later rewritten away, and the probe
silently stopped being runnable — a rotted probe that still *looked* like a control (#1725).

| Step | Call | Faithful-read expectation | Observed 2026-09-05 |
| --- | --- | --- | --- |
| 1 | `issue_read` `method:"get"` on **#1736** | All three vectors intact — HTML comment, five `<Tabs.Screen …/>` lines inside the `tsx` fence, literal `'` `"` `&` `>` | ✅ all three |
| 2 | `list_issues` `state:OPEN labels:["routine-state"] fields:["number","title","body"]` | Same, for #1736's entry | ✅ all three |
| 3 | `search_issues` `"MCP read-fidelity probe control fixture"`, `fields:["number","title","body"]` | Same | ✅ all three |
| 4 | [The direct REST read](#the-direct-rest-read-ground-truth-for-a-raw-body) of #1736 | Ground truth — steps 1-3 must agree with it | ✅ byte-identical to all three |
| 5 | `issue_read get_comments` on #1736 | The comment control carries the same three vectors | ✅ all three |
| 6 | `search_issues` a real `fp=` and a fabricated one | 1 precise hit / 0 hits | ✅ both correct — lookup healthy |

**State which vectors and which paths a re-verification covered.** A check naming only HTML comments
is what let the 2026-08-11 round pass while a `tsx` fence was still being eaten — vector 2 is the
one that decides the answer, because it is the only vector whose failure destroys content
irrecoverably. Steps 1-3 disagreeing with step 4 means the read is lossy; steps 1-3 *agreeing* with
step 4 means it is faithful, whatever this document's table says.

**Known gap in this fixture, stated so it is not mistaken for a pass.** The probe measures what a
read *returns*; it does **not** measure whether the search **index** matches text that exists only
inside an HTML comment. #1736 cannot answer that — every comment-borne string in it also appears as
visible text (in the answer key, or quoted in a code span), which is what makes the fixture readable
but also makes it non-discriminating for this one question. That matters only for pre-2026-08-20
comment-form `fp=` markers; every marker written since is a visible line, which the index indexes.
Adding a discriminator would mean a string that appears **only** inside a comment — worth doing if
the legacy-marker audit in #697 is ever run.

### The direct REST read (ground truth for a raw body)

**`api.github.com` REST is reachable out of band, and it is the better ground-truth read.**
Corrected 2026-09-02: reachability is **route-dependent, not session-dependent**. Requests that
honour `HTTPS_PROXY` — `curl` as configured in the sandbox — get `403 "GitHub access is not enabled
for this session"` on every repo-scoped path, with or without a `GITHUB_PAT` header; that 403 is
the agent proxy's GitHub-credential layer answering, not GitHub. Node's built-in `fetch` does not
read `HTTPS_PROXY`, so it goes direct and returns **200 from GitHub itself** (`server: github.com`,
`x-github-request-id`); `curl --noproxy '*'` behaves the same.

**Scope, before the recipe.** This is a **verification read** and nothing more. It is not a tracker
path and not an MCP fallback: **if the GitHub MCP is unavailable, tracker work stops and reports —
no `gh`, no REST, no scratch file.** REST is never a substitute for the MCP on tracker work, read
*or* write. Its two sanctioned uses both assume a working MCP: reading an issue's raw text to see
what the MCP's read mangled, and the provider-*settings* paths the MCP exposes no tool for (branch
protection, environments, rulesets, repo visibility, vulnerability alerts). Never to create, edit,
label or close an issue or PR, and never to post a comment — those go through `mcp__github__*` or
they do not happen. `gh` is not installed.

**The read.** `GET /repos/pdcarlson/Frapp/issues/<n>` over the direct route, with `GITHUB_PAT` as a
bearer token, returns the raw `body` field — the string GitHub stores, before the MCP's sanitizer
touches it:

```bash
node -e '
const res = await fetch("https://api.github.com/repos/pdcarlson/Frapp/issues/697", {
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_PAT}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "frapp-agent",
  },
});
const issue = await res.json();
console.log(issue.body);
'
```

Send the PAT: unauthenticated, the route is anonymous-rate-limited and fails outright on any
authenticated path. Do **not** set `NODE_USE_ENV_PROXY=1` for these reads — that puts node back on
the 403 route. A 403 *without* the "GitHub access is not enabled for this session" body is GitHub's
own (rate limit or scope), not the proxy's; neither 403 is a reason to regenerate the PAT with
broader scopes.

**Measured 2026-09-02 on this exact endpoint.** `GET /repos/pdcarlson/Frapp/issues/697` returns
`403` with the proxy's "GitHub access is not enabled for this session" body over proxied `curl`,
and `200` (`server: github.com`) over both node `fetch` and `curl --noproxy '*'` — and the returned
`body` contained the literal `<!-- cursor-suggestion … -->` marker that every MCP read path was
stripping at the time. The same round of measurements covered the repo, branch-protection,
environments, rulesets and vulnerability-alerts paths.

**Why this and not `WebFetch`.** `WebFetch` reads the *rendered* page, where an HTML comment is
markup rather than text — so it can witness one that happens to be quoted inside a code span, but
it can never prove a comment's **absence**. REST returns the raw `body`, which is exactly what "did
the HTML comment survive?" asks. It is also ground truth *by construction* rather than by
measurement, so it stays correct mid-regression, which is why step 4 of the probe is the one every
other step is judged against. Don't read a `WebFetch` miss as a dropped marker.

**Scanning the corpus for baked-in escapes** uses the same call in a loop — page
`GET /repos/pdcarlson/Frapp/issues?state=all&since=<ISO>&per_page=100`, skip entries carrying
`pull_request`, and flag any `body` containing `&amp;` `&#39;` `&#34;` `&gt;` `&lt;` `&quot;`. Judge
each hit by its context: a body may quote an escape sequence deliberately (#1736, #1725 and #357's
repair note all do). That scan is what found the nine damaged bodies recorded above.

### The write side is faithful

`issue_write` stores what it is given; the 2026-08-14 fixture (#888, closed), the 2026-08-20
ground-truth reads, and the 2026-09-05 round-trip through **#1736** all establish it independently —
content written long ago is still byte-present on GitHub today. **The write side has never been the
defect in any of the four rounds.**

With the read half green again (2026-09-05), a backfill sourced from a read is safe — subject to the
operative rule's one condition: re-run the probe first and say that you did. What is *not* safe is
assuming that, since a body a read returned once looked right, a bulk pass will. Nine bodies carry
baked-in escapes precisely because a rewrite trusted a read without checking.

### Marker-count guard (so the next regression surfaces in one run)

This defect went ~6 days unnoticed because nothing watched it. **Every routine run starts by
counting marker visibility** and reports the number:

1. **The control.** `search_issues` for `fp=docs/search-issues-marker-roundtrip-regression`
   (#1086 — this section's own control, a visible-line marker). It must return exactly #1086.
2. **The negative control.** `search_issues` for a fingerprint you know does not exist. It must
   return zero — a non-zero result means the matcher has gone fuzzy and dedup will start throwing
   false "already filed" skips.
3. If either control fails, the read or index path has regressed again: **stop, do no body writes,
   and report it** rather than filing around it.
4. **The trend.** Count visible `agent-suggestion` markers and report the number. Note that this
   count legitimately started near zero on 2026-08-20 — pre-existing markers are comment-form and
   therefore invisible — so it should *climb* as issues are touched. A **fall** is the signal; a
   low absolute number is not.

Cheap — two calls — and it fails closed, which is the behavior that made the 2026-08-20 triage run
correctly refuse every body edit instead of silently corrupting bodies.

## Ownership boundary (organize broadly, destroy narrowly)

Unchanged in substance from the Linear era. The backlog routines split writes into two classes:

- **Destructive writes** — close, mark-duplicate, re-body (including adding an Agent brief) — are
  allowed **only** on issues carrying the **`suggestion`** label, confirmed by a pre-write label
  read (`issue_read get_labels`), else SKIP. Human-filed work is never closed or re-bodied by a
  routine.
- **Organizational writes** — priority labels, `area:*`, `Blocked by #N` lines, promoting
  Triage → Backlog — are the triage routine's job **on any `triage` item**, whoever filed it.
  **Exception:** human-action holds (`[human]`/`[pr-followup][human]` titles or the
  `**Human action required — hold in triage` body opener) are never promoted — they get
  priority/estimate only and stay in Triage (see "Filing an issue" above). A
  **human-set priority is never overwritten**; routines correct obviously-wrong priorities only on
  `suggestion`-owned issues. Epics and planning structure are read-only to routines.

## No platform caps

GitHub Issues has no active-issue cap, so the Linear Free-tier 250-active accounting is gone. The
backlog stays lean **by choice**: the curator's conservative net-new budget and the triage
routine's grooming are quality goals (so `/next` ranks real work first), not cap avoidance.

## Migration record (2026-08-08)

- All 206 open GitHub issues predating the migration were 1:1 title-matched twins of open Linear
  issues (the June import + the GitHub→Linear sync). The 60 open Linear-born issues without twins
  were recreated as GitHub issues with their Linear bodies and a provenance footer; the FRA-→#N
  mapping table lives in **#680**.
- Twin bodies were **not** rewritten from Linear — a body edited by the curator in Linear may be
  newer than its GitHub twin. An absent Agent brief reads as `depth:deep`; the triage routine
  backfills briefs on `suggestion`-owned issues over time.
- Owner wind-down checklist (also in #680): disconnect Linear's GitHub integration **before any
  Linear-side cleanup** (close-sync could otherwise close real GitHub issues), then remove the
  Linear connector from claude.ai, then archive/delete the workspace at leisure.

## Sources

- GitHub sub-issues: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>
- Closing issues via PR keywords (`Fixes #N`): <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
