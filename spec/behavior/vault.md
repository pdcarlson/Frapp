# Vault

The vault is **encrypted private storage** for high-sensitivity chapter content — risk management discussions, standards board records, legal correspondence, anything where loss-of-confidentiality is itself the harm. Vault content lives outside the regular chapter-docs and chat surfaces.

## Scope

- Risk management board minutes and incident records.
- Standards board records and member-conduct investigations.
- Legal correspondence and counsel-protected content.
- Any document a chapter explicitly designates as vault-tier when uploading.

The vault is **not** a general "private folder." Regular chapter documents (bylaws, policies, agendas) live in [Chapter Documents](chapter-docs.md); private channels live in [Chat](chat/README.md). The vault is reserved for content where the legal / reputational cost of leakage is high.

## Access

- Access is scoped to elevated roles (risk chair, standards chair, president). Each chapter configures which roles can read vault content; no member role with vault read access can be auto-assigned via invite.
- Every read is logged: `(user_id, document_id, accessed_at, action)`. The log is visible to the chapter president. **Retention:** vault access logs are retained for at least the chapter's standard [data retention](data-retention.md) window and automatically extended when a legal hold is asserted by the chapter president or by Frapp counsel. Retention enforcement is auditable via the same break-glass audit trail as recovery operations; the chapter president is responsible for asserting holds.
- Vault uploads require a chapter-elevated role; no public/role-gated upload paths.

## Encryption at rest

- Vault content is encrypted with a per-chapter key. The key is held in a managed KMS / HSM, not derived from chapter passwords (which we don't store) or stored alongside the encrypted blobs.
- Storage path: `chapters/{chapter_id}/vault/{document_id}/{filename}`. Even with direct Storage access, the blob is unreadable without the chapter's key.

## Recovery — HSM break-glass

If a chapter loses all members with vault access (account deletion, transfer-of-leadership gap, lost device), Frapp holds a **break-glass recovery key** in a hardware security module. Recovery requires:

1. A written request from the chapter's current president (or, if no president, escalation to the chapter's national/regional organization).
2. Identity verification through the same channel as the chapter's account-recovery process.
3. A 7-day waiting period during which the chapter is notified via every contact method on file.
4. HSM-mediated key release; the recovery operation is logged with operator, request reference, and timestamp.

## Transparency log

Every break-glass recovery is recorded in a public quarterly transparency report:
- Date of recovery
- Anonymized chapter identifier (e.g. "Chapter A at University X")
- Request reason category (account loss, leadership transfer, legal compulsion, etc.)
- Frapp operator on record

Frapp does not perform recovery for any other reason — there is no "ops debugging" path, no support-can-look path, no Frapp-internal access to vault content outside this audited workflow.

## AI exclusion

Vault content is not part of the [AI corpus](ai.md). Surfacing vault content via AI would require an explicit per-chapter consent flow and is deferred to v2+.

## Search indexing

Vault documents are **excluded from global search** ([`search.md`](search.md)). Search results never reference vault content — not titles, not snippets, not metadata. Vault retrieval goes through the vault surface only, where elevated-role access checks and step-up authentication fire.

## Step-up authentication

Reading or uploading vault content requires **step-up authentication** beyond the standard session. Default policy:

- Re-prompt for the user's primary auth factor — or, if MFA is enrolled on the account, an MFA challenge — before granting vault access.
- The elevated session is bound to the vault surface and expires after 15 minutes of vault-surface inactivity; switching to a non-vault surface ends the elevated session immediately.
- Step-up is enforced server-side at the vault API boundary, not in the client. A request to read or write vault content with only a standard session returns `401 Unauthorized` (`vault.stepup.required`).

## Subscription cancellation and key lifecycle

When a chapter's subscription status moves to `canceled` (see [`data-retention.md`](data-retention.md) and [`product/onboarding.md`](../product/onboarding.md)):

- Vault content is preserved in **read-only mode** along with the rest of the chapter's data — writes are blocked, reads through the elevated/step-up flow continue to work.
- The per-chapter KMS/HSM key is **retained** for the chapter's full retention window and destroyed only when the chapter's data is purged (inactivity cleanup at 2 years, or explicit deletion request).
- **Recovery is not blocked by cancellation.** The standard HSM break-glass workflow above still applies; a vault export bundle (encrypted blob + key wrap) can be requested through the same multi-party authorization process and is delivered to the chapter's last verified president.
- **Re-activation** restores write access without re-keying — the same per-chapter key resumes use.

## Architecture cross-references

Vault key management (HSM provisioning, audit log shape, recovery operator workflow) is specified in [`spec/architecture.md`](../architecture.md) under "Vault key management."
