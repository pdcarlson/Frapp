# Incident Response: API Down

## Detection signals

- Uptime monitor fails `/health`
- Render service marked unhealthy
- Elevated 5xx alerts

## Triage steps

1. Confirm outage scope (`staging` vs `production`).
2. Check Render deploy/activity timeline.
3. Hit `/health` directly and inspect response body.
4. Inspect Render logs for startup/env errors.
5. Inspect Sentry for first error spike and root exception.

## Common root causes

- missing env vars after deploy
- migration/schema mismatch
- upstream Supabase outage/network issue
- crash loop from new runtime code path

## Recovery checklist

- [ ] Roll back Render deploy if latest release caused outage
- [ ] Validate required env vars are present
- [ ] Verify DB connectivity from API
- [ ] Re-run post-deploy smoke checks
- [ ] Confirm uptime monitor is green for 10+ minutes

## Communication

- announce status page/internal channel updates every 15 minutes
- include mitigation ETA and current customer impact
