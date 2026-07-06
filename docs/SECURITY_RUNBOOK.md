# Security Runbook — Omnipresence Engine

## INTEGRATION_ENCRYPTION_KEY rotation

Integration credentials (OAuth tokens, API keys stored per-project) are encrypted at rest with AES-256-GCM via `src/lib/security/credential-vault.ts`. Rotation must never brick existing rows: decrypt tries multiple key material sources in order.

### Prerequisites

- Staging Supabase project with a copy of production `project_integrations` rows (or a single test row).
- Maintenance window (~15 minutes) if re-encrypting production at scale.
- New 32+ character random secret generated offline (e.g. `openssl rand -base64 48`).

### Dual-key decrypt order (today)

1. `INTEGRATION_ENCRYPTION_KEY` (primary)
2. `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` (optional — set during rotation window)
3. `SUPABASE_SERVICE_ROLE_KEY` (legacy/dev fallback only — **not** a production rotation target)

### Rotation procedure (dry-run on staging first)

1. **Snapshot** — export `project_integrations` (`id`, `provider`, `credentials_encrypted`) from staging.
2. **Set previous key** — on staging, set:
   ```bash
   INTEGRATION_ENCRYPTION_KEY_PREVIOUS=<current production key>
   INTEGRATION_ENCRYPTION_KEY=<new key>
   ```
3. **Verify read path** — call any route that decrypts credentials (e.g. connector health) against rows encrypted with the *old* key. Decrypt must succeed via `INTEGRATION_ENCRYPTION_KEY_PREVIOUS`.
4. **Re-encrypt job** — run a one-off script/service-role job:
   - `SELECT id, credentials_encrypted FROM project_integrations WHERE credentials_encrypted IS NOT NULL`
   - For each row: `decryptCredentials(blob)` → `encryptCredentials(plain)` (uses new primary key)
   - `UPDATE project_integrations SET credentials_encrypted = $new WHERE id = $id`
5. **Verify write path** — create a fresh integration; confirm only the new key can decrypt it when `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` is unset.
6. **Production** — repeat steps 2–5 in production during the window.
7. **Cleanup** — remove `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` from Vercel/Railway env after all rows re-encrypted and spot-checks pass.

### Rollback

If re-encrypt fails mid-batch:

- Restore `INTEGRATION_ENCRYPTION_KEY` to the **old** value.
- Keep `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` unset.
- Restore DB snapshot if any row was partially updated with corrupt blobs.

### Acceptance checklist

- [ ] Staging dry-run completed with at least one legacy + one new row.
- [ ] No `Decrypt failed` errors in logs during connector/oauth flows.
- [ ] `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` removed after migration.
- [ ] `.env.example` documents both env vars.

### Never do

- Rotate by only changing `INTEGRATION_ENCRYPTION_KEY` without re-encrypting rows (permanent data loss).
- Use `SUPABASE_SERVICE_ROLE_KEY` as the rotation previous key in production.
