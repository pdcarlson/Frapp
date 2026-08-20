Two issues were drafted in #1121 but never filed because GitHub MCP was down and raw `gh`/REST writes are forbidden. File these manually (or re-run once MCP is fixed) rather than losing them.

---

**Issue 1**
Title: Align mobile tutorial replay with spec (Profile "Replay Tutorial")
Labels: `triage`, `area:ux`, `P3`
Body: `spec/behavior/onboarding.md` says the tutorial can be revisited from Profile > "Replay Tutorial". Web has this in `apps/web/components/profile/profile-panel.tsx`. Mobile deleted `onboarding-tour` (#957) and `apps/mobile/app/(tabs)/profile.tsx` has no replay control. Do not silently rewrite the spec to match the deletion, and do not restore a tour without a product decision. Acceptance: either mobile Profile gains a replay control that re-runs s03 / clears `has_completed_onboarding` in a spec-legal way, or the spec is amended to say replay is web-only and mobile is first-run-only. **This needs Paul's call on which direction, not an agent decision.**

---

**Issue 2 (comment, not a new issue)**
Target: epic #937 ("Signet Phase 2 — mobile rebuild")
Action: append-only comment noting the epic body still says "Blocked by #958" after #958 closed via #1101. Do not rewrite the epic body from a possibly-truncated MCP read — just comment that the blocker is cleared.