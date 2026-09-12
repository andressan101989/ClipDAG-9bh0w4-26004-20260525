# Nelyon AI Handoff Bridge v1

This is the machine-to-machine asset transport used by a future ChatGPT connector and by Codex tooling. It uses the existing private Cloudflare R2 authority; it does not use Supabase Storage, product `media_assets`, database tables, or RPCs.

## Storage contract

All keys are server-derived beneath `internal/ai-handoff/v1/`:

```text
internal/ai-handoff/v1/_index/{handoff_id}.json
internal/ai-handoff/v1/{project}/{type}/{handoff_id}/_init.json
internal/ai-handoff/v1/{project}/{type}/{handoff_id}/{filename}
internal/ai-handoff/v1/{project}/{type}/{handoff_id}/manifest.json
```

The internal locator makes lookup by globally unique `handoff_id` possible without a database or bucket listing. `_init.json`, the locator, assets, and the final manifest are created conditionally with overwrite protection. `manifest.json` is written only after every asset's size, content type, and SHA-256 upload metadata match the initialized contract.

## HTTP contract

The Edge Function base is `https://{project-ref}.supabase.co/functions/v1/ai-handoff`.

- `POST /v1/handoffs/init` — requires `Authorization: Bearer {AI_HANDOFF_WRITE_TOKEN}`. Accepts the v1 initialization body and returns five-minute conditional PUT URLs. Clients must send every returned upload header.
- `POST /v1/handoffs/commit` — requires the WRITE token and `{ "handoff_id": "..." }`.
- `GET /v1/handoffs/{handoff_id}` — requires the READ token or the exact `cap` query parameter generated for that handoff. Returns the immutable manifest and five-minute GET URLs.
- `POST /v1/handoffs/{handoff_id}/link` — requires the WRITE token. Accepts `{ "expires_in_seconds": 3600 }`; the minimum is 60 seconds and maximum is 86,400 seconds.
- `POST /v1/handoffs/{handoff_id}/purge` — requires the WRITE token and an empty JSON body. It is denied unless both `type` and `status` are `temporary`.

The function is deployed with `verify_jwt = false` because it rejects every protected operation using its own constant-time machine-token or HMAC capability checks. User JWTs grant no bridge access.

## Validation and limits

Projects match `^[a-z0-9][a-z0-9-]{0,63}$`; handoff IDs match `^[a-z0-9][a-z0-9._-]{0,127}$`. Filenames are ASCII basenames of at most 180 characters, with no slash, backslash, `..`, control characters, or reserved bridge filename. MIME and extension must agree.

Allowed MIME types are PNG, JPEG, WebP, SVG, PDF, ZIP, JSON, and plain text. Each asset is limited to 50,000,000 bytes; a handoff is limited to 250,000,000 declared bytes and 100 assets.

## CLI

Upload and commit using environment variables so tokens are not placed on the command line:

```powershell
$env:AI_HANDOFF_ENDPOINT='https://PROJECT.supabase.co/functions/v1/ai-handoff'
$env:AI_HANDOFF_WRITE_TOKEN='...'
node scripts/ai-handoff/upload.mjs --handoff-id nelyon-brand-v1 --project nelyon --type branding --status approved --file C:\assets\nelyon-logo-horizontal.png
```

Fetch through a capability URL and verify every SHA-256 before finalizing local files:

```powershell
$env:AI_HANDOFF_CAPABILITY_URL='...'
node scripts/ai-handoff/fetch.mjs --output C:\safe-output\nelyon-brand-v1
```

Temporary test handoffs can be purged with `node scripts/ai-handoff/upload.mjs --purge {handoff_id}` while the endpoint and WRITE token remain in the environment.
