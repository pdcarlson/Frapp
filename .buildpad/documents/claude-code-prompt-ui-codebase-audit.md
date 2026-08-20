Paste this into Claude Code in the Frapp/Signet repo. Read-only — no changes yet.

---

I'm starting the UI/UX rebuild phase for this app (currently branded Frapp, rebranding to Signet). Before I make any changes, I need a grounded inventory of the current UI code. Please read the code and produce a structured report — do not modify anything yet.

Cover:

1. **Modals/dialogs** — list every modal/dialog component in `apps/web` and `apps/mobile`, with file path and what it does. For the event-creation modal specifically, describe its current steps/fields/flow in detail (this one is flagged as the worst offender).

2. **Current theming** — where are colors/design tokens defined today, in both web and mobile? Is there any `packages/theme` package already, or are we starting from scratch? Confirm the actual tech in use: Tailwind config version, shadcn theme provider setup, NativeWind config and version.

3. **Onboarding flow** — list every screen/step in the onboarding wizard (web and mobile), referencing `chapter-onboarding.service.ts` and any related UI files. For each step, note what data it collects. Identify where module-toggle logic lives (i.e., where a chapter turns features like study hours or dues on/off).

4. **Existing AI/RAG UI scaffolding** — check `apps/api/test/ai-evals` and search both apps for any existing "ask AI," chat-with-AI, or search UI stubs, even placeholders. If none exist, say so explicitly.

5. **Core surface locations** — for each of chat, events, points/tasks, study hours, dues, backwork: list the top-level directories/files implementing it in both web and mobile, so I know where reskinning work will happen.

6. **Mobile vs. web capability differences** — note any features that only work on one platform today (e.g., geofencing, QR scanning, push notifications) and where that's currently handled or communicated in the UI, if at all.

Return this as a single structured report I can bring back to plan the rebuild.