# Current build state

Cutover status update (Aug 19, per Claude Code audit against live repo/GitHub): mobile is now code-complete against spec except one screen pair (join/first-run wizard, #958). QR check-in, study-hours/geofencing, and push registration — all previously listed as gaps — are now built. Zero mock data remains in apps/mobile. Chapter-creation wizard still has no mobile path (the one genuine remaining hole; web has it, API is complete).

Engineering is ~1 slice from done. Calendar is gated entirely on human provisioning, not code — critical path: **#805 (enable custom_access_token_hook in staging+prod)**. Without it, no production token carries active_chapter_id, so the app cannot render a single row of chapter data. This is the single highest-priority open item. Also open: #938 (EAS dev build, gates all push testing), #1033 (EVENT_CHECK_IN_TOKEN_SECRET, QR returns 503 without it), #806/#1064 (Stripe publishable key), #919 (P1 — deployed DB schema drifted from migrations, will bite device testing).

Renamed to Signet; brand/design/logo direction decided — see phase 01 blobs. Full grounded UI audit in phase 02 blobs.