# DataGen

DataGen is a full-stack TypeScript app (Next.js App Router) that generates synthetic datasets by making one chat-completion style inference call per record. It uses Ratio1 CStore for persistence and `@ratio1/cstore-auth-ts` for authentication.

## Quickstart

1) Install dependencies (Node 18+):
```bash
npm install
```
2) Set required environment variables (see below).
3) Run the dev server:
```bash
npm run dev
```

## Environment variables

- `EE_CHAINSTORE_API_HOST` / `EE_CHAINSTORE_API_PORT` (required) — Ratio1 CStore endpoint (fallback: `EE_CHAINSTORE_API_URL`).
- `EE_R1FS_API_HOST` / `EE_R1FS_API_PORT` (optional) — Ratio1 file store (fallback: `EE_R1FS_API_URL`, not used yet).
- `R1EN_CSTORE_AUTH_HKEY` — Hash key for auth (fallback: `EE_CSTORE_AUTH_HKEY`).
- `R1EN_CSTORE_AUTH_SECRET` — Pepper for password hashing (fallback: `EE_CSTORE_AUTH_SECRET`).
- `R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD` — Bootstrap admin password (fallback: `EE_CSTORE_AUTH_BOOTSTRAP_ADMIN_PW`).
- `DATAGEN_SESSION_SECRET` — Secret used to sign session cookies/JWTs.
- `DATAGEN_APP_HOST` / `DATAGEN_APP_PORT` — Public app host/port (fallback: `DATAGEN_APP_URL`, for future redirects/cookie scoping).
- `DATAGEN_INFERENCE_HOST` / `DATAGEN_INFERENCE_PORT` — Base inference gateway host/port (fallback: `DATAGEN_INFERENCE_BASE_URL`).
- `LOG_INFERENCE_REQUESTS` — When `true`, logs the outgoing inference request (Authorization header is redacted).
- `RETRY_INFERENCE_ON_FAILURE` — When `true`, reattempts one extra inference call on failure/parse errors.
- `NEXT_PUBLIC_SHOW_FAILURES` — When `true`, shows the failure count on the task cards in the UI.
- `DATAGEN_MAX_RECORDS_PER_JOB` — Max records per job (default 200).
- `DATAGEN_MOCK_CSTORE` — Set to `true` to use in-memory CStore/auth with mock users (`admin/admin`, `test_user/testtest`).
- `DATAGEN_MOCK_INFERENCE_API` — Set to `true` to use an in-memory inference stub that returns random JSON records.
- `DATAGEN_ACTIVE_POLL_SECONDS` — Poll interval (seconds) while tasks are active (default 2).
- `DATAGEN_IDLE_POLL_SECONDS` — Poll interval (seconds) when idle (default 10).

## Current API surface

- `POST /api/auth/login` — Authenticate via `cstore-auth-ts`; sets HttpOnly session cookie.
- `POST /api/auth/logout` — Clears the session.
- `GET /api/auth/me` — Returns the current session (401 if missing).
- `GET /api/metrics` — Auth-protected; returns persisted counters in CStore.

## Project layout (high level)

```
app/
  (auth)/login/page.tsx         # Username/password login
  (app)/page.tsx                # Dashboard shell with metrics summary
  api/
    auth/login|logout|me        # Auth routes (cookie-based)
    metrics/route.ts            # Auth-protected metrics endpoint
lib/
  auth/                         # Session helpers + guards
  datagen/                      # Constants, types, metrics helpers
  ratio1/                       # Edge SDK + CStoreAuth wiring
```

## Notes & roadmap

- Metrics are stored in CStore at `datagen:metrics` and survive restarts.
- All routes require auth (login sets a signed, HttpOnly cookie).
- Next steps: task creation/listing, inference loop (one request per record), CSV/JSON export, and richer dashboard UI with progress polling.
