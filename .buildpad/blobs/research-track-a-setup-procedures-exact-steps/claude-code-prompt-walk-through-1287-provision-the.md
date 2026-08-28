Context: PR #1289 built a nightly offsite backup + restore + rehearsal, proven to work — but it needs a real S3-compatible bucket and credentials to actually write anywhere. Right now the workflow correctly fails on purpose because #1287 (provisioning the bucket + secrets) hasn't happened. I need you to verify exactly what's required and walk me through it — don't guess at generic S3 setup, read our actual workflow first.

1. **Read `.github/workflows/db-backup.yml` and issue #1287 precisely.** Tell me: the exact secret names the workflow expects, whether they're GitHub Actions secrets or Infisical values (these may be different things — confirm which), and any assumptions about bucket structure/naming/region the script makes.

2. **Recommend a specific provider, don't make me research this myself.** Given the script uses `--endpoint-url` (S3-compatible), which of Cloudflare R2 / Backblaze B2 / AWS S3 is the cheapest/simplest fit for a solo founder's nightly Postgres dumps at our current scale? Give a real recommendation, not a list of options.

3. **Give me the exact click-path** for whichever provider you recommend: creating the bucket, generating the access key + secret key, and what permissions/scope to grant the key (least-privilege — this key should only be able to write to this one bucket, not full account access).

4. **Tell me exactly what to paste where** — which GitHub secret name gets which value, and confirm whether this needs to happen at the repo level or somewhere more specific (environment secrets, etc.).

5. **After I've done the above, verify it actually works — don't just check the workflow went green.** Trigger the backup workflow manually (`workflow_dispatch`), confirm a real object landed in the bucket (not just that the job didn't error), and confirm the read-back verification step in the workflow actually read back what was written rather than passing vacuously.

6. **Tell me plainly what's still not covered.** I know #1290 (storage objects / files) is a separate gap blocked on this same prerequisite — confirm whether it's now unblocked, and whether it needs a second round of work or was already wired to reuse this bucket.

Don't do anything requiring my account credentials yourself — this is a walkthrough for me to execute, with you verifying before and after.