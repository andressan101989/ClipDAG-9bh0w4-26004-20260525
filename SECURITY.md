# ClipDAG — Security & Credentials Guide

## Environment Variables

All sensitive credentials are managed via environment variables.
**Never hardcode API keys, secrets, or tokens in source files.**

### Required Environment Variables

| Variable | Description | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | OnSpace Cloud / Supabase project URL | Dashboard → Settings → API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Dashboard → Settings → API |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID | https://cloud.walletconnect.com |
| `EXPO_PUBLIC_DEEPAR_LICENSE_IOS` | DeepAR iOS license key | https://developer.deepar.ai |
| `EXPO_PUBLIC_DEEPAR_LICENSE_ANDROID` | DeepAR Android license key | https://developer.deepar.ai |

### EAS Build Secrets (server-side only, never in .env)

These are set as EAS secrets and injected only at build time:

| Secret | Description |
|---|---|
| `DEEPAR_API_KEY_IOS` | DeepAR iOS API key for native plugin |
| `DEEPAR_API_KEY_ANDROID` | DeepAR Android API key for native plugin |
| `TREASURY_WALLET_ADDRESS` | Platform deposit wallet address |
| `TREASURY_PRIVATE_KEY` | Platform withdrawal signing key |

Set EAS secrets:
```bash
eas secret:create --scope project --name DEEPAR_API_KEY_IOS --value <key>
eas secret:create --scope project --name DEEPAR_API_KEY_ANDROID --value <key>
```

## Git Safety

- `.env` is listed in `.gitignore` and must never be committed.
- `.env.example` is the only env file committed — it contains no real values.
- Run `git ls-files .env` to verify `.env` is not tracked.
- Run `git check-ignore -v .env` to verify the ignore rule is active.

## Credential Rotation

If you suspect any credential was exposed in Git history:

1. **Supabase keys**: Dashboard → Settings → API → Regenerate
2. **WalletConnect**: https://cloud.walletconnect.com → Regenerate
3. **DeepAR keys**: https://developer.deepar.ai → Regenerate
4. **Treasury private key**: Generate new wallet, migrate funds, update EAS secret

## Audit Log

### 2026-05-26 — Security hardening round

**Found and fixed:**
- `services/walletConnect.ts`: WalletConnect Project ID was hardcoded → migrated to `process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `components/feature/WalletConnectProvider.native.tsx`: Same WalletConnect Project ID hardcoded → migrated to env var
- `services/deeparService.ts`: DeepAR API keys for iOS and Android were hardcoded → migrated to `process.env.EXPO_PUBLIC_DEEPAR_LICENSE_IOS` / `EXPO_PUBLIC_DEEPAR_LICENSE_ANDROID`
- `plugins/withDeepARiOS.js`: DeepAR API keys had hardcoded fallback values → removed fallbacks, now fails with warning if env vars absent

**Acceptable (not secrets):**
- `services/walletConfig.ts`: Treasury deposit addresses are public wallet addresses, not private keys — OK to be in source
- `services/bdagService.ts`: Public RPC URLs and explorer URLs — OK to be in source
- `services/blockdagService.ts`: Public chain config (chainId, RPC URL, explorer) — OK to be in source

**Action required:**
- Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` in your `.env`
- Set `EXPO_PUBLIC_DEEPAR_LICENSE_IOS` and `EXPO_PUBLIC_DEEPAR_LICENSE_ANDROID` in your `.env`
- Set `DEEPAR_API_KEY_IOS` and `DEEPAR_API_KEY_ANDROID` as EAS secrets
- Rotate the WalletConnect Project ID if it was previously exposed in Git history
- Rotate the DeepAR API keys if they were previously exposed in Git history
